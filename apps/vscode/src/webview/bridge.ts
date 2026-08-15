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
  | { type: 'session:create' };

/** 连接/运行状态(与 AgentController 状态机对齐) */
export type ConnectionState = 'idle' | 'running' | 'error' | 'disconnected';

/** extension → webview */
export type ExtensionMessage =
  | { type: 'event'; sessionId: string; events: SessionEvent[] }
  | { type: 'session:list'; items: SessionSummary[] }
  | { type: 'state'; state: ConnectionState; host?: { cwd: string; model: string } }
  | { type: 'error'; message: string };

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
    default:
      throw new Error(`bridge: unknown message type: ${String(msg.type)}`);
  }
}
