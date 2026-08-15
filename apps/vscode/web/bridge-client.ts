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

export function onMessage(handler: (message: ExtensionMessage) => void): () => void {
  const listener = (event: MessageEvent<ExtensionMessage>): void => {
    const data = event.data;
    if (typeof data === 'object' && data !== null && 'type' in data) handler(data);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
