/**
 * bridge.ts — webview ↔ extension host 消息协议(类型化 union + 入参白名单结构校验)。
 * 纯模块,零 vscode 依赖,webview 与 extension host 共用。
 * 校验失败显式抛错,绝不静默放行未知载荷(TASK §0.5、P1-7)。
 */
import type { SessionEvent, SessionSummary } from '../agent/wire.js';

/** webview → extension */
export type WebviewRequest =
  | { type: 'ready' }
  | { type: 'ask'; text: string }
  | { type: 'stop' }
  | { type: 'session:list' }
  | { type: 'session:open'; sessionId: string }
  | { type: 'session:create' }
  | { type: 'terminal:run'; command: string }
  | { type: 'changes:list' }
  | { type: 'changes:rollback'; path: string }
  | { type: 'changes:accept'; path: string };

/** 连接/运行状态(与 AgentController 状态机对齐) */
export type ConnectionState = 'idle' | 'running' | 'error' | 'disconnected';

/** extension → webview */
export type ExtensionMessage =
  | { type: 'event'; sessionId: string; events: SessionEvent[] }
  | { type: 'session:list'; items: SessionSummary[] }
  | { type: 'state'; state: ConnectionState; host?: { cwd: string; model: string } }
  | { type: 'error'; message: string }
  | { type: 'terminal:output'; text: string }
  | { type: 'diagnostics'; errors: number; warnings: number }
  | { type: 'changes'; items: ChangeItem[] };

/** 改动条目(方案 a 快照 diff,供审批面板) */
export interface ChangeItem {
  path: string;
  diff: string;
  at: number;
}

/** 白名单结构校验:返回归一化后的请求;非法输入抛错 */
export function validateWebviewRequest(raw: unknown): WebviewRequest {
  if (typeof raw !== 'object' || raw === null) throw new Error('bridge: message is not an object');
  const msg = raw as Record<string, unknown>;
  switch (msg.type) {
    case 'ready':
      return { type: 'ready' };
    case 'ask':
      if (typeof msg.text !== 'string' || msg.text.length === 0 || msg.text.length > 100_000) {
        throw new Error('bridge: ask.text must be a non-empty string <= 100k chars');
      }
      return { type: 'ask', text: msg.text };
    case 'stop':
      return { type: 'stop' };
    case 'session:list':
      return { type: 'session:list' };
    case 'session:open':
      if (typeof msg.sessionId !== 'string' || !msg.sessionId.startsWith('session-')) {
        throw new Error('bridge: session:open.sessionId must be a session id');
      }
      return { type: 'session:open', sessionId: msg.sessionId };
    case 'session:create':
      return { type: 'session:create' };
    case 'terminal:run':
      if (typeof msg.command !== 'string' || msg.command.trim().length === 0 || msg.command.length > 2_000) {
        throw new Error('bridge: terminal:run.command must be a non-empty string <= 2k chars');
      }
      return { type: 'terminal:run', command: msg.command };
    case 'changes:list':
      return { type: 'changes:list' };
    case 'changes:rollback':
      if (typeof msg.path !== 'string' || msg.path.length === 0 || msg.path.length > 1_000) {
        throw new Error('bridge: changes:rollback.path must be a string');
      }
      return { type: 'changes:rollback', path: msg.path };
    case 'changes:accept':
      if (typeof msg.path !== 'string' || msg.path.length === 0 || msg.path.length > 1_000) {
        throw new Error('bridge: changes:accept.path must be a string');
      }
      return { type: 'changes:accept', path: msg.path };
    default:
      throw new Error(`bridge: unknown message type: ${String(msg.type)}`);
  }
}
