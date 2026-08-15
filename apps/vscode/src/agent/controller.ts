/**
 * controller.ts — AgentController:start(提问)/stop(取消)、状态机、事件路由(TASK §2.1 D4)。
 * 状态机:idle / running / error / disconnected(全局,来自 runtime.onStatus 与活动会话的 turn 事件)。
 * 零 vscode 依赖。
 */
import type { HarnessRuntime } from './runtime.js';
import type { SessionManager } from './session-manager.js';
import type { HostFrame, MuxFrame } from './wire.js';

export type ControllerState = 'idle' | 'running' | 'error' | 'disconnected';

export class AgentController {
  private state: ControllerState = 'idle';
  private activeSessionId?: string;
  private readonly onState?: (state: ControllerState) => void;

  constructor(
    private readonly runtime: HarnessRuntime,
    private readonly sessions: SessionManager,
    options?: { onState?: (state: ControllerState) => void },
  ) {
    this.onState = options?.onState;
    runtime.onStatus = (status) => {
      if (status.state === 'connected') {
        if (this.activeSessionId && this.sessions.isRunning(this.activeSessionId)) this.setState('running');
        else this.setState('idle');
      } else if (status.state === 'reconnecting' || status.state === 'connecting') {
        this.setState('disconnected');
      } else {
        this.setState('disconnected');
      }
    };
  }

  /** 让 controller 感知活动会话(UI 打开某个会话时调用) */
  setActiveSession(sessionId: string | undefined): void {
    this.activeSessionId = sessionId;
  }

  /** 处理 mux 帧:驱动状态机(活动会话的 turn 事件) */
  handleMuxFrame(frame: MuxFrame): void {
    if (frame.type !== 'session/event' || frame.sessionId !== this.activeSessionId) return;
    if (frame.event.type === 'turn/start') this.setState('running');
    else if (frame.event.type === 'turn/end') this.setState('idle');
    else if (frame.event.type === 'host/agent-error') this.setState('error');
  }

  async ask(sessionId: string, text: string): Promise<void> {
    this.activeSessionId = sessionId;
    const result = await this.runtime.request<{ accepted: true }>('session.prompt', {
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text }],
    });
    if (!result.ok) {
      this.setState('error');
      throw new Error(`session.prompt failed: ${result.error.code}: ${result.error.message}`);
    }
  }

  async stop(sessionId: string): Promise<void> {
    const result = await this.runtime.request<{ accepted: true }>('session.cancel', { sessionId });
    if (!result.ok) {
      this.setState('error');
      throw new Error(`session.cancel failed: ${result.error.code}: ${result.error.message}`);
    }
  }

  get currentState(): ControllerState {
    return this.state;
  }

  private setState(state: ControllerState): void {
    if (this.state === state) return;
    this.state = state;
    this.onState?.(state);
  }
}

/** host 帧 → 会话列表变化(Phase 1 只刷新列表) */
export function handleHostFrame(frame: HostFrame): void {
  // host/session-added / removed / status / agent-error:由上层(extension)按需处理
  void frame;
}
