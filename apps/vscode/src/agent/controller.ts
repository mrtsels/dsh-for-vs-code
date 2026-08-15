/**
 * controller.ts — AgentController:start(提问)/stop(取消)、状态机、事件路由(TASK §2.1 D4)。
 * 状态机:idle / running / error / disconnected(全局,来自 runtime.onStatus 与活动会话的 turn 事件)。
 * 零 vscode 依赖。
 */
import type { HarnessRuntime } from './runtime.js';
import type { SessionManager } from './session-manager.js';
import type { MuxFrame } from './wire.js';

export type ControllerState = 'idle' | 'running' | 'error' | 'disconnected';

export class AgentController {
  private state: ControllerState = 'idle';
  private activeSessionId?: string;
  private readonly onState?: (state: ControllerState) => void;
  private stopStatus?: () => void;

  constructor(
    private readonly runtime: HarnessRuntime,
    private readonly sessions: SessionManager,
    options?: { onState?: (state: ControllerState) => void },
  ) {
    this.onState = options?.onState;
    // P1-1 修复:多播订阅,不再覆盖 runtime.onStatus(extension 也订阅)
    this.stopStatus = runtime.subscribeStatus((status) => {
      if (status.state === 'connected') {
        if (this.activeSessionId && this.sessions.isRunning(this.activeSessionId)) this.setState('running');
        else this.setState('idle');
      } else if (status.state === 'reconnecting' || status.state === 'connecting') {
        this.setState('disconnected');
      } else {
        this.setState('disconnected');
      }
    });
  }

  dispose(): void {
    this.stopStatus?.();
  }

  /** 让 controller 感知活动会话(UI 打开某个会话时调用) */
  setActiveSession(sessionId: string | undefined): void {
    this.activeSessionId = sessionId;
  }

  /** 处理 mux 帧:驱动状态机(活动会话的 turn 事件) */
  handleMuxFrame(frame: MuxFrame): void {
    // P1-4:非法帧(无 event)直接忽略,不抛
    if (frame.type !== 'session/event' || frame.sessionId !== this.activeSessionId || !frame.event) return;
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

/** host 帧 → 会话列表变化(Phase 1 只刷新列表;列表刷新由 extension 的 onHostFrame 处理) */
