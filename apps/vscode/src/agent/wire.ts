/**
 * wire.ts — dsh web 四象限 RPC 消息模型与编解码。
 *
 * 本文件定义扩展侧使用的全部 wire/域类型。类型设计为**宽松兼容**
 * （RpcId = string 而非 branded，SessionEvent.data = unknown bag），
 * 以适配扩展的 switch/default:break 消费模式和 webview 跨层传递。
 *
 * ── 上游对应关系（vendor rev rc.7 = 99f6f02） ──────────────────────
 *
 * | 本地类型           | 上游包 + 类型                                     | 差异说明                              |
 * |--------------------|--------------------------------------------------|---------------------------------------|
 * | RpcId (string)     | host/apiproxy → RpcId (Branded<'rpc-id'>)        | 扩展用 plain string，消费方不依赖 brand |
 * | ClientRequest<P>   | host/apiproxy → ClientRequest (payload:unknown)   | 扩展加泛型参数                        |
 * | ServerResponse<T>  | host/apiproxy → ServerResponse (result:RpcResult) | 扩展加泛型参数                        |
 * | ServerRequest<P>   | host/apiproxy → ServerRequest (payload:unknown)   | 扩展加泛型参数                        |
 * | RpcError           | host/apiproxy → RpcError (~40 codes discriminated) | 扩展用 {code:string} 宽松版           |
 * | RpcResult<T>       | host/apiproxy → RpcResult<T>                     | 形状完全一致                          |
 * | MuxFrame           | host/apiproxy → MuxFrame (10+ 帧精确 union)      | 扩展用宽松 union，消费方 default:break |
 * | HostFrame          | host/apiproxy → HostFrame (8+ 帧精确 union)      | 同上                                  |
 * | HostDescription    | client/connection → ResponseValue<'host.describe'> | 扩展手动定义字段子集                  |
 * | SessionSummary     | host/apiproxy → sessions.ts SessionSummary        | 扩展省略 parentSessionId/origin 等    |
 * | SessionEvent       | core/session/types → SessionEvent<T> (mapped type) | 扩展用 {type:string; data:EventData}  |
 * | EventData          | core/session/types → SessionEventMap[K]            | 扩展用 loose bag                      |
 * | JobView            | host/apiproxy → jobs.ts JobView                   | 形状一致                              |
 * | SkillEntry         | host/apiproxy → skills.ts SkillEntry              | 形状一致                              |
 * | SubagentEntry      | host/apiproxy → subagents.ts SubagentListEntry    | 扩展简化为 kind 判别 union            |
 * | GoalView           | dsh-goal/types → GoalProjection                   | 扩展简化子集                          |
 * | encodeClientRequest| 上游无等价（扩展自有 wire 编码）                   | —                                     |
 * | parseServerResponse| 上游无等价（扩展自有 wire 解码）                   | —                                     |
 * | DynamicCordisInventoryRow | 无上游等价（扩展专用）                    | —                                     |
 *
 * ── 迁移路径 ────────────────────────────────────────────────────────
 *
 * Phase D1 目标类型已锁定上游对应。直接 re-export 上游类型不兼容
 * （上游更精确：RpcId branded、RpcResult 非泛型、MuxFrame discriminated），
 * 改为"记录映射 + 类型断言层"策略：
 *   1. 本地类型保留（宽松，消费者无需改动）
 *   2. 编解码函数内用 as 断言转为上游类型（wire 传输层）
 *   3. 待全部消费者收窄后，逐个替换为上游类型
 */

export type RpcId = string;

/** client → host(HTTP POST /api/<method>) */
export interface ClientRequest<P = unknown> {
  type: 'client-request';
  rpcId: RpcId;
  method: string;
  payload: P;
}

export interface RpcError {
  code: string;
  message: string;
  details: unknown;
}

export type RpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: RpcError };

/** host → client(HTTP 响应) */
export interface ServerResponse<T = unknown> {
  type: 'server-response';
  rpcId: RpcId;
  result: RpcResult<T>;
}

/** host → client(WS 下行帧信封) */
export interface ServerRequest<P = unknown> {
  type: 'server-request';
  rpcId: RpcId;
  method: string;
  payload: P;
}

/** 文本 prompt 内容块（Phase 1 只发文本） */
export interface TextPromptPart {
  type: 'text';
  text: string;
}
export type PromptPart = TextPromptPart;

/** 会话事件（最小判别 union，未知事件进 catch-all；渲染只消费已知类型） */
export interface EventData {
  turn?: number;
  step?: number;
  content?: PromptPart[];
  chunk?: Chunk;
  title?: string;
  reason?: string;
  source?: { kind: string; rpcId?: string };
  tool?: unknown;
  [key: string]: unknown;
}
export interface SessionEvent {
  type: string;
  seq: number;
  time: number;
  data: EventData;
}

/** assistant/chunk 的块结构 */
export interface Chunk {
  type: string;
  index: number;
  blockType?: string;
  text?: string;
  [key: string]: unknown;
}

/** 后台任务视图（P3-4，jobs.d.ts JobView 子集，协议锁定） */
export interface JobView {
  id: string;
  kind: string;
  label: string;
  status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed';
  detail?: string;
  startedAt: number;
  finishedAt?: number;
}

/** Skill 目录条目（P3-2，skills.d.ts SkillEntry） */
export interface SkillEntry {
  name: string;
  description: string;
  whenToUse?: string;
  modelInvocable: boolean;
}

/** 子代理目录条目（P3-3，subagents.d.ts SubagentListEntry） */
export type SubagentEntry =
  | {
      kind: 'child';
      id: string;
      activity: 'running' | 'inactive';
      hasChildren: boolean;
      mode: 'one-shot' | 'continuable';
      label?: string;
    }
  | { kind: 'diagnostic'; id: string; reason: 'corrupt' | 'unsupported' | 'unavailable' };

/** Goal 投影（P3-7，来自 session.history projections 或 session/projection 帧） */
export interface GoalView {
  goal: { id: string; revision: number; objective: string; phase: string; maxGoalRounds?: number };
  roundsStarted: number;
  createdAt: number;
  updatedAt: number;
}

/** session.history 返回（含 projections 块） */
export interface SessionHistoryResponse {
  events: Array<{ event: SessionEvent }>;
  hasMore: boolean;
  projections?: { asOfSeq: number; values: Record<string, unknown> };
}

/** /api/events.mux 帧 union（events.d.ts 子集；未知类型帧由消费方 default 忽略） */
export type MuxFrame =
  | { type: 'session/event'; sessionId: string; event: SessionEvent; view?: unknown }
  | { type: 'session/subscribed'; sessionId: string; lastSeq: number }
  | { type: 'session/queue'; sessionId: string; items: unknown[] }
  | { type: 'session/jobs'; sessionId: string; jobs: unknown[] }
  | { type: 'session/projection'; sessionId: string; key: string; value: unknown; seq: number }
  | { type: 'approval/requested'; sessionId: string; approvalId: string; toolName: string; callId?: string; reason?: string }
  | { type: 'approval/resolved'; sessionId: string; approvalId: string; outcome: string }
  | { type: 'question/requested'; sessionId: string; questions: unknown[] }
  | { type: 'question/resolved'; sessionId: string; questionRpcId: string; outcome: string }
  | { type: 'stream/error'; error: RpcError };

/** /api/events.host 帧 union（子集） */
export type HostFrame =
  | { type: 'host/session-added'; sessionId: string; blank: boolean; cwd?: string; agentPreset?: string }
  | { type: 'host/session-removed'; sessionId: string }
  | { type: 'host/session-status'; sessionId: string; running: boolean }
  | { type: 'host/archived-sessions-changed'; archivedSessionIds: string[] }
  | { type: 'host/agent-error'; sessionId: string; message: string }
  | { type: 'host/workspace-changed'; workspace: unknown }
  | { type: 'host/workspace-removed'; workspaceId: string }
  | { type: 'stream/error'; error: RpcError };

export interface HostDescription {
  version: string;
  cwd: string;
  provider: string;
  model: string;
  attachedSessions: number;
  canOpenPath: boolean;
}

export interface SessionSummary {
  sessionId: string;
  updatedAt: number;
  running: boolean;
  blank: boolean;
  cwd?: string;
  agentPreset?: string;
  projections?: {
    asOfSeq: number;
    values: {
      title?: string;
      sessionStats?: { turns?: number; steps?: number };
      tokenUsage?: { uncachedInputTokens?: number; outputTokens?: number };
      [key: string]: unknown;
    };
  };
}

export function encodeClientRequest(method: string, payload: unknown, rpcId: RpcId = crypto.randomUUID()): ClientRequest {
  return { type: 'client-request', rpcId, method, payload };
}

/** 解析 HTTP 响应文本 → ServerResponse；非 JSON / 非信封即抛错（不静默丢消息） */
export function parseServerResponse<T = unknown>(text: string): ServerResponse<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`wire: response is not JSON: ${text.slice(0, 80)}`);
  }
  if (typeof raw !== 'object' || raw === null || raw['type' as keyof object] !== 'server-response') {
    throw new Error('wire: response is not a server-response envelope');
  }
  return raw as ServerResponse<T>;
}

/** WS 帧信封 → ServerRequest（未知帧不抛错，由调用方按 catch-all 处理） */
export function parseServerRequestFrame(raw: string): ServerRequest<unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || (parsed as { type?: string }).type !== 'server-request') {
    throw new Error('wire: ws frame is not a server-request envelope');
  }
  return parsed as ServerRequest<unknown>;
}

/** dynamicCordisRunner/inventory 行（窄化子集；完整契约见 dsh-cordis-host-runner typert） */
export interface DynamicCordisInventoryRow {
  pluginId: string;
  agentId: string;
  packages: readonly {
    packageId: string;
    name: string;
    hasHostHalf: boolean;
    hasClientHalf: boolean;
  }[];
  activeRun?: { pluginRunId: string; packageId: string };
}
