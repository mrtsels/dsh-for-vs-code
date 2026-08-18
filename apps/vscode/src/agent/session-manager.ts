/**
 * session-manager.ts — 会话列表 + 每会话 append-only 事件缓冲(TASK §2.1 D3、§0.5.3)。
 * 铁律:只从 runtime 的 mux 帧追加事件,不自建消息模型;重连 = 重开流 + 重取历史
 * (events.d.ts:since 在 v1 未实现)。
 * 接线:外部把 runtime.onMuxFrame 转发到 handleMuxFrame(解决构造顺序依赖)。
 */
import type { HarnessRuntime } from './runtime.js';
import type {
  GoalView,
  JobView,
  MuxFrame,
  SessionEvent,
  SessionHistoryResponse,
  SessionSummary,
  SkillEntry,
  SubagentEntry,
} from './wire.js';

interface SessionState {
  events: SessionEvent[];
  lastSeq: number;
  running: boolean;
  title?: string;
  jobs: JobView[];
  projections: Map<string, { value: unknown; seq: number }>;
}

export class SessionManager {
  private readonly sessions = new Map<string, SessionState>();
  private readonly onEvents?: (sessionId: string, events: SessionEvent[]) => void;
  /** P3-4/P3-7:meta 帧(jobs/projection)到达通知(不并入事件流,事件日志仍是权威) */
  private readonly onMeta?: (sessionId: string, meta: { jobs?: JobView[]; projection?: { key: string; value: unknown; seq: number } }) => void;

  constructor(
    private readonly runtime: HarnessRuntime,
    options?: {
      onEvents?: (sessionId: string, events: SessionEvent[]) => void;
      onMeta?: (sessionId: string, meta: { jobs?: JobView[]; projection?: { key: string; value: unknown; seq: number } }) => void;
    },
  ) {
    this.onEvents = options?.onEvents;
    this.onMeta = options?.onMeta;
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
        // wire.ts 已 re-export 上游 SessionEvent,frame.event 与 state.events 同型;
        // 保留 as 断言以防御 MuxFrame discriminated union 可能的窄化边界差异
        const localEvent = frame.event as SessionEvent;
        const state = this.ensure(frame.sessionId);
        state.events.push(localEvent);
        state.lastSeq = localEvent.seq;
        if (localEvent.type === 'turn/start') state.running = true;
        else if (localEvent.type === 'turn/end') state.running = false;
        // session/title 不是合法 wire event — 标题从 session/projection 帧和
        // seedHistory projections.values.title 获取(handleMuxFrame projection 分支 + L137)
        this.onEvents?.(frame.sessionId, [localEvent]);
        break;
      }
      case 'session/subscribed': {
        this.ensure(frame.sessionId).lastSeq = frame.lastSeq;
        break;
      }
      case 'session/jobs': {
        // P3-4:jobs 全量快照推送,直接替换
        const state = this.ensure(frame.sessionId);
        state.jobs = frame.jobs as JobView[];
        this.onMeta?.(frame.sessionId, { jobs: state.jobs });
        break;
      }
      case 'session/projection': {
        // P3-7:投影值 higher-seq-wins(协议文档:客户端按 watermark 保留最新)
        const state = this.ensure(frame.sessionId);
        const prev = state.projections.get(frame.key);
        if (prev === undefined || frame.seq > prev.seq) {
          state.projections.set(frame.key, { value: frame.value, seq: frame.seq });
          if (frame.key === 'title' && typeof frame.value === 'string') state.title = frame.value;
          // P2-E:仅在值被应用时通知(被 higher-seq-wins 拒绝的旧帧不打扰 UI)
          this.onMeta?.(frame.sessionId, { projection: { key: frame.key, value: frame.value, seq: frame.seq } });
        }
        break;
      }
      default:
        break; // queue/approval/question 等消费方按需处理
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

  /** 重连/首次打开时,用持久化历史重建缓冲(历史是权威日志,mux 是增量);同时消费 projections 块(P3-7) */
  async seedHistory(sessionId: string, maxMessages = 50): Promise<void> {
    const result = await this.runtime.request<SessionHistoryResponse>('session.history', {
      sessionId,
      maxMessages,
    });
    if (!result.ok) return; // 历史不可得时不阻塞 UI(空会话日志也合法)
    const state = this.ensure(sessionId);
    const events = result.value.events.map((e) => e.event).sort((a, b) => a.seq - b.seq);
    state.events = events as unknown as SessionEvent[];
    if (events.length > 0) state.lastSeq = events[events.length - 1]!.seq;
    // projections 块:goal/title/sessionStats 等权威基线(history 恢复;live 靠 projection 帧增量)
    // P1-B:history 是 asOfSeq 的快照,若 live 帧已带更高 seq 则不覆盖(与 handleMuxFrame 统一 higher-seq-wins)
    const projections = result.value.projections;
    if (projections) {
      for (const [key, value] of Object.entries(projections.values)) {
        const prev = state.projections.get(key);
        if (prev === undefined || projections.asOfSeq > prev.seq) {
          state.projections.set(key, { value, seq: projections.asOfSeq });
          if (key === 'title' && typeof value === 'string') state.title = value;
        }
      }
    }
    this.onEvents?.(sessionId, state.events);
  }

  snapshot(sessionId: string): SessionEvent[] {
    return this.sessions.get(sessionId)?.events ?? [];
  }

  /** P3-4:该会话当前后台任务视图(推送帧缓存,空则 []) */
  jobs(sessionId: string): JobView[] {
    return this.sessions.get(sessionId)?.jobs ?? [];
  }

  /** P3-7:该会话 goal 投影(来自 history projections 或 live projection 帧) */
  goal(sessionId: string): GoalView | undefined {
    const value = this.sessions.get(sessionId)?.projections.get('goal')?.value;
    return isGoalView(value) ? value : undefined;
  }

  /** P3-5:fork 会话(协议支持,atSeq 可选) */
  async fork(sessionId: string, atSeq?: number): Promise<string> {
    const result = await this.runtime.request<{ sessionId: string }>('session.fork', atSeq === undefined ? { sessionId } : { sessionId, atSeq });
    if (!result.ok) throw new Error(`session.fork failed: ${result.error.code}: ${result.error.message}`);
    const child = result.value.sessionId;
    this.ensure(child);
    return child;
  }

  /** P3-2:skill 目录(只读;启用/停用由 agent 配置管理,无 wire API → gaps.md) */
  async listSkills(sessionId: string): Promise<SkillEntry[]> {
    const result = await this.runtime.request<{ skills: SkillEntry[] }>('skill.list', { sessionId });
    if (!result.ok) throw new Error(`skill.list failed: ${result.error.code}: ${result.error.message}`);
    return result.value.skills;
  }

  /** P3-3:子代理目录 */
  async listSubagents(parentSessionId: string): Promise<SubagentEntry[]> {
    const result = await this.runtime.request<{ entries: SubagentEntry[] }>('subagent.list', { parentSessionId });
    if (!result.ok) throw new Error(`subagent.list failed: ${result.error.code}: ${result.error.message}`);
    return result.value.entries;
  }

  /** P3-3:打断可续子代理(仅 continuable;one-shot 无 interrupt → gaps 记录) */
  async interruptSubagent(parentSessionId: string, childSessionId: string): Promise<void> {
    const result = await this.runtime.request<{ accepted: true }>('subagent.interrupt', {
      parentSessionId,
      childSessionId,
      mode: 'continuable',
    });
    if (!result.ok) throw new Error(`subagent.interrupt failed: ${result.error.code}: ${result.error.message}`);
  }

  /** P3-7:创建 goal(per-session 单例,已存在 active goal 时服务端拒绝) */
  async goalCreate(sessionId: string, objective: string): Promise<{ id: string; revision: number }> {
    const result = await this.runtime.request<{ ref: { id: string; revision: number } }>('goal.create', { sessionId, objective });
    if (!result.ok) throw new Error(`goal.create failed: ${result.error.code}: ${result.error.message}`);
    return result.value.ref;
  }

  /** P3-7:goal 控制(pause/resume/complete/clear),CAS 带 ref */
  async goalControl(
    sessionId: string,
    ref: { id: string; revision: number },
    action: 'pause' | 'resume' | 'complete' | 'clear',
  ): Promise<void> {
    const result = await this.runtime.request<{ cleared?: true }>(`goal.${action}`, { sessionId, ref });
    if (!result.ok) throw new Error(`goal.${action} failed: ${result.error.code}: ${result.error.message}`);
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
      state = { events: [], lastSeq: -1, running: false, jobs: [], projections: new Map() };
      this.sessions.set(sessionId, state);
    }
    return state;
  }
}

/** goal 投影窄校验(来自 wire,不信任形状;失败返回 undefined 而非抛错) */
function isGoalView(value: unknown): value is GoalView {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const g = v.goal as Record<string, unknown> | undefined;
  return (
    typeof g === 'object' && g !== null &&
    typeof g.id === 'string' && typeof g.revision === 'number' &&
    typeof g.objective === 'string' && typeof g.phase === 'string'
  );
}
