/**
 * wire.ts — dsh web 四象限 RPC 消息模型与编解码。
 * 契约来源:dsh-host-apiproxy rpc.schema / sessions / events(rc.6),TASK §0.3。
 * 本文件零依赖、可被 webview 与 extension host 共用。
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

/** 文本 prompt 内容块(Phase 1 只发文本) */
export interface TextPromptPart {
  type: 'text';
  text: string;
}
export type PromptPart = TextPromptPart;

/** 会话事件(最小判别 union,未知事件进 catch-all;渲染只消费已知类型) */
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

/** /api/events.mux 帧 union(events.d.ts 子集;未知类型帧由消费方 default 忽略) */
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

/** /api/events.host 帧 union(子集) */
export type HostFrame =
  | { type: 'host/session-added'; sessionId: string; blank: boolean; cwd?: string; agentPreset?: string }
  | { type: 'host/session-removed'; sessionId: string }
  | { type: 'host/session-status'; sessionId: string; running: boolean }
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

/** 解析 HTTP 响应文本 → ServerResponse;非 JSON / 非信封即抛错(不静默丢消息) */
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

/** WS 帧信封 → payload(未知帧不抛错,由调用方按 catch-all 处理) */
export function parseServerRequestFrame(raw: string): ServerRequest<unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || (parsed as { type?: string }).type !== 'server-request') {
    throw new Error('wire: ws frame is not a server-request envelope');
  }
  return parsed as ServerRequest<unknown>;
}
