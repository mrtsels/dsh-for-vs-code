/**
 * runtime.ts — 薄桥:只做传输,不缓存状态、不含业务逻辑(TASK §2.1 D1)。
 * 语义对齐上游 ConnectionController:就绪 = host.describe 成功 + 双 WS 打开;
 * 任一 WS 断开 → 整代失效 → 指数退避重连(500ms 起,×2,上限 10s,带抖动)。
 * 零 vscode 依赖,可在 node 下直接单测。
 */
import {
  encodeClientRequest,
  parseServerRequestFrame,
  parseServerResponse,
  type HostDescription,
  type HostFrame,
  type MuxFrame,
  type RpcResult,
} from './wire.js';

export type RuntimeState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface RuntimeStatus {
  state: RuntimeState;
  attempt: number;
  error?: string;
}

export interface HarnessRuntimeOptions {
  /** 形如 http://127.0.0.1:3080 */
  baseUrl: string;
  onMuxFrame?: (frame: MuxFrame) => void;
  onHostFrame?: (frame: HostFrame) => void;
  onStatus?: (status: RuntimeStatus) => void;
  backoffBaseMs?: number;
  backoffFactor?: number;
  backoffMaxMs?: number;
  streamOpenTimeoutMs?: number;
}

const DEFAULTS = { backoffBaseMs: 500, backoffFactor: 2, backoffMaxMs: 10_000, streamOpenTimeoutMs: 3_000 };

export class HarnessRuntime {
  private readonly opts: Omit<Required<HarnessRuntimeOptions>, 'onMuxFrame' | 'onHostFrame' | 'onStatus'>;
  /** 可赋值回调:解决 runtime 与 session-manager 的构造顺序依赖 */
  onMuxFrame?: (frame: MuxFrame) => void;
  onHostFrame?: (frame: HostFrame) => void;
  onStatus?: (status: RuntimeStatus) => void;
  private mux?: WebSocket;
  private hostWs?: WebSocket;
  private generation = 0;
  private attempt = 0;
  private state: RuntimeState = 'idle';
  private disposed = false;
  private started = false;
  private readyResolvers: Array<(d: HostDescription) => void> = [];
  private lastDescription?: HostDescription;

  constructor(options: HarnessRuntimeOptions) {
    const { onMuxFrame, onHostFrame, onStatus, ...rest } = options;
    this.opts = { ...DEFAULTS, ...rest };
    this.onMuxFrame = onMuxFrame;
    this.onHostFrame = onHostFrame;
    this.onStatus = onStatus;
  }

  get currentState(): RuntimeState {
    return this.state;
  }

  get description(): HostDescription | undefined {
    return this.lastDescription;
  }

  /** 开始连接循环;返回首个就绪的 host.describe。失败不 reject,持续重连(状态走 onStatus)。 */
  async connect(): Promise<HostDescription> {
    if (this.disposed) throw new Error('runtime disposed');
    if (!this.started) {
      this.started = true;
      void this.loop();
    }
    if (this.lastDescription) return this.lastDescription;
    return new Promise((resolve) => this.readyResolvers.push(resolve));
  }

  /** HTTP unary:POST /api/<method>,返回 result 槽;传输失败抛错。 */
  async request<T>(method: string, payload: unknown): Promise<RpcResult<T>> {
    if (this.disposed) throw new Error('runtime disposed');
    const res = await fetch(`${this.opts.baseUrl}/api/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(encodeClientRequest(method, payload)),
    });
    if (res.status !== 200) {
      const text = await res.text().catch(() => '');
      throw new Error(`wire: ${method} -> HTTP ${res.status} ${text.slice(0, 120)}`);
    }
    return parseServerResponse<T>(await res.text()).result;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1; // 使当前代失效
    this.emitStatus('disconnected', this.attempt);
    this.mux?.close();
    this.hostWs?.close();
    this.mux = undefined;
    this.hostWs = undefined;
  }

  private backoffDelay(): number {
    const { backoffBaseMs, backoffFactor, backoffMaxMs } = this.opts;
    const cap = Math.min(backoffMaxMs, backoffBaseMs * backoffFactor ** Math.max(0, this.attempt - 1));
    return cap / 2 + Math.random() * (cap / 2);
  }

  private emitStatus(state: RuntimeState, attempt: number, error?: string): void {
    this.state = state;
    this.onStatus?.({ state, attempt, error });
  }

  private async loop(): Promise<void> {
    while (!this.disposed) {
      const gen = ++this.generation;
      this.emitStatus(this.attempt === 0 ? 'connecting' : 'reconnecting', this.attempt);
      let sockets: [WebSocket, WebSocket] | undefined;
      try {
        sockets = await this.openSockets();
        // 双 WS 已打开(openSockets 已等待),握手只差 host.describe;不设超时,否则会误杀整代
        const descriptionResult = await this.request<HostDescription>('host.describe', {});
        if (this.disposed || gen !== this.generation) return;
        if (!descriptionResult.ok) {
          throw new Error(`host.describe failed: ${descriptionResult.error.code}: ${descriptionResult.error.message}`);
        }
        this.mux = sockets[0];
        this.hostWs = sockets[1];
        this.attempt = 0;
        this.lastDescription = descriptionResult.value;
        this.emitStatus('connected', 0);
        for (const resolve of this.readyResolvers.splice(0)) resolve(descriptionResult.value);
        this.pump(this.mux, 'mux', gen);
        this.pump(this.hostWs, 'host', gen);
        // 代失效 = 任一 socket 关闭/错误;dispose 也会 close → 这里返回
        await new Promise<void>((resolve) => {
          const done = (): void => resolve();
          sockets![0].onclose = done;
          sockets![0].onerror = done;
          sockets![1].onclose = done;
          sockets![1].onerror = done;
        });
        if (this.disposed || gen !== this.generation) return;
      } catch (error) {
        sockets?.forEach((s) => s.close());
        if (this.disposed || gen !== this.generation) return;
        this.emitStatus('reconnecting', this.attempt, error instanceof Error ? error.message : String(error));
      }
      if (this.disposed) return;
      await new Promise((r) => setTimeout(r, this.backoffDelay()));
      this.attempt += 1;
    }
  }

  private openSockets(): Promise<[WebSocket, WebSocket]> {
    const open = (url: string): Promise<WebSocket> =>
      new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        ws.onopen = () => resolve(ws);
        ws.onerror = () => reject(new Error(`ws open failed: ${url}`));
      });
    const base = this.opts.baseUrl.replace(/^http/, 'ws');
    return Promise.all([
      open(`${base}/api/events.mux`),
      open(`${base}/api/events.host`),
    ]);
  }

  private pump(ws: WebSocket, kind: 'mux' | 'host', gen: number): void {
    ws.onmessage = (event: MessageEvent<string>) => {
      if (this.disposed || gen !== this.generation) return;
      let payload: Record<string, unknown>;
      try {
        payload = parseServerRequestFrame(String(event.data)).payload as Record<string, unknown>;
      } catch {
        const error = { code: 'bad-frame', message: 'undecodable ws frame', details: {} };
        if (kind === 'mux') this.onMuxFrame?.({ type: 'stream/error', error });
        else this.onHostFrame?.({ type: 'stream/error', error });
        return;
      }
      if (kind === 'mux') this.onMuxFrame?.(payload as MuxFrame);
      else this.onHostFrame?.(payload as HostFrame);
    };
    // onclose/onerror 由 loop 的 generation 等待接管
  }
}
