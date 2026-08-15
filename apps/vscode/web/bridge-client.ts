/**
 * bridge-client.ts — webview 侧消息桥:post(请求) / onMessage(接收)。
 */
import type { ExtensionMessage, WebviewRequest } from '../src/webview/bridge.js';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

let api: ReturnType<typeof acquireVsCodeApi> | undefined;
try {
  api = acquireVsCodeApi();
} catch {
  // 非 webview 环境(如浏览器直接打开 index.html 调试)时退化为 console
}

export function post(request: WebviewRequest): void {
  if (api) api.postMessage(request);
  // 非 webview 环境(浏览器直接打开调试):静默,不写 console
}

/** 扩展→webview 消息类型白名单(P2-4):与 bridge.ts 的 ExtensionMessage 保持对称 */
const KNOWN_TYPES = new Set([
  'state', 'session:list', 'session:forked', 'event', 'error', 'terminal:output',
  'diagnostics', 'changes', 'meta:jobs', 'meta:skills', 'meta:subagents', 'meta:goals',
]);

/** 关键负载的轻量结构校验(防坏帧污染 UI;渲染层本无 HTML 注入面,这里防形状错误) */
function isValidMessage(data: unknown): data is ExtensionMessage {
  if (typeof data !== 'object' || data === null) return false;
  const msg = data as Record<string, unknown>;
  if (typeof msg.type !== 'string' || !KNOWN_TYPES.has(msg.type)) return false;
  switch (msg.type) {
    case 'event':
      return typeof msg.sessionId === 'string' && Array.isArray(msg.events);
    case 'session:list':
      return Array.isArray(msg.items);
    case 'changes':
      return Array.isArray(msg.items);
    default:
      return true;
  }
}

export function onMessage(handler: (message: ExtensionMessage) => void): () => void {
  const listener = (event: MessageEvent<ExtensionMessage>): void => {
    const data = event.data;
    if (isValidMessage(data)) handler(data);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
