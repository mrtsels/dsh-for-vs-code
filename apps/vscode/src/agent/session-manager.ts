/**
 * session-manager.ts — 会话列表 + 每会话 append-only 事件缓冲(TASK §2.1 D3、§0.5.3)。
 * 铁律:只从 runtime 的 mux 帧追加事件,不自建消息模型;重连 = 重开流 + 重取历史
 * (events.d.ts:since 在 v1 未实现)。
 * 接线:外部把 runtime.onMuxFrame 转发到 handleMuxFrame(解决构造顺序依赖)。
 */
import type { HarnessRuntime } from './runtime.js';
import type { MuxFrame, SessionEvent, SessionSummary } from './wire.js';

interface SessionState {
  events: SessionEvent[];
  lastSeq: number;
  running: boolean;
  title?: string;
}

export class SessionManager {
  private readonly sessions = new Map<string, SessionState>();
  private readonly onEvents?: (sessionId: string, events: SessionEvent[]) => void;

  constructor(
    private readonly runtime: HarnessRuntime,
    options?: { onEvents?: (sessionId: string, events: SessionEvent[]) => void },
  ) {
    this.onEvents = options?.onEvents;
  }

  /** 把 runtime 的 mux 帧喂进来(构造时:new HarnessRuntime({...});随后 runtime.onMuxFrame = (f) => sm.handleMuxFrame(f)) */
  handleMuxFrame(frame: MuxFrame): void {
    // P1-4:协议边界窄化(WS 帧不可信):session/event 缺 sessionId/event/seq 直接丢弃,不外抛
    if (frame.type === 'session/event') {
      if (
        typeof frame.sessionId !== 'string' ||
        frame.event === null ||
        typeof frame.event !== 'object' ||
        typeof frame.event.seq !== 'number'
      ) {
        return;
      }
    } else if (frame.type === 'session/subscribed') {
      if (typeof frame.sessionId !== 'string' || typeof frame.lastSeq !== 'number') return;
    }
    switch (frame.type) {
      case 'session/event': {
        const state = this.ensure(frame.sessionId);
        state.events.push(frame.event);
        state.lastSeq = frame.event.seq;
        if (frame.event.type === 'turn/start') state.running = true;
        else if (frame.event.type === 'turn/end') state.running = false;
        if (frame.event.type === 'session/title' && typeof frame.event.data.title === 'string') {
          state.title = frame.event.data.title;
        }
        this.onEvents?.(frame.sessionId, [frame.event]);
        break;
      }
      case 'session/subscribed': {
        this.ensure(frame.sessionId).lastSeq = frame.lastSeq;
        break;
      }
      default:
        break; // queue/jobs/projection/approval/question 等 Phase 3 消费
    }
  }

  async list(): Promise<SessionSummary[]> {
    const result = await this.runtime.request<{ items: SessionSummary[] }>('session.list', {});
    if (!result.ok) throw new Error(`session.list failed: ${result.error.code}: ${result.error.message}`);
    return result.value.items;
  }

  async create(cwd?: string): Promise<string> {
    const result = await this.runtime.request<{ sessionId: string }>('session.create', cwd ? { cwd } : {});
    if (!result.ok) throw new Error(`session.create failed: ${result.error.code}: ${result.error.message}`);
    const sessionId = result.value.sessionId;
    this.ensure(sessionId);
    return sessionId;
  }

  /** 重连/首次打开时,用持久化历史重建缓冲(历史是权威日志,mux 是增量) */
  async seedHistory(sessionId: string, maxMessages = 50): Promise<void> {
    const result = await this.runtime.request<{ events: Array<{ event: SessionEvent }> }>('session.history', {
      sessionId,
      maxMessages,
    });
    if (!result.ok) return; // 历史不可得时不阻塞 UI(空会话日志也合法)
    const state = this.ensure(sessionId);
    const events = result.value.events.map((e) => e.event).sort((a, b) => a.seq - b.seq);
    state.events = events;
    if (events.length > 0) state.lastSeq = events[events.length - 1]!.seq;
    this.onEvents?.(sessionId, state.events);
  }

  snapshot(sessionId: string): SessionEvent[] {
    return this.sessions.get(sessionId)?.events ?? [];
  }

  title(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.title;
  }

  isRunning(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.running ?? false;
  }

  trackedSessionIds(): string[] {
    return [...this.sessions.keys()];
  }

  private ensure(sessionId: string): SessionState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = { events: [], lastSeq: -1, running: false };
      this.sessions.set(sessionId, state);
    }
    return state;
  }
}
