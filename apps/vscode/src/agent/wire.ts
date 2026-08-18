/**
 * wire.ts — dsh web 四象限 RPC 消息模型与编解码。
 *
 * 迁移策略（D→C）：protocol boundary 类型逐步 re-export 上游，
 * application domain 类型保留本地。见 docs/dedup-plan.md Phase M2-M6。
 *
 * 当前已 re-export 上游：SkillEntry, MuxFrame, HostFrame, SessionEvent, SessionEventMap, TurnEndReason
 * 本地类型保留：RpcId, RpcError, RpcResult, ClientRequest, ServerResponse, TextPromptPart, PromptPart, ...
 *
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

// ─── 上游 re-export ──────────────────────────────────────────────

export type { SkillEntry } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { SessionEvent, SessionEventMap, SessionEventType, TurnEndReason } from '@deepseek-ai/dsh-session/types'
export type { SessionEvent, SessionEventMap, SessionEventType, TurnEndReason }
import { createRpcId } from './wire-adapters.js'
export { createRpcId } from './wire-adapters.js'


// ─── 本地类型（待 M3-M5 逐步迁移） ────────────────────────────────

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

// SessionEvent / EventData / Chunk 已从上游 re-export（见顶部 import）
// 上游 SessionEvent 是精确 mapped type：data 类型随 event.type 自动推导
// 例如 event.type === 'turn/end' 时 event.data.reason: TurnEndReason

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

// SkillEntry 已从上游 re-export（见顶部 import）

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

/** /api/events.mux 帧 union（re-export 上游精确 discriminated union） */
export type { MuxFrame, HostFrame } from '@deepseek-ai/dsh-host-apiproxy/api'

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

export function encodeClientRequest(method: string, payload: unknown, rpcId: RpcId = createRpcId()): ClientRequest {
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
