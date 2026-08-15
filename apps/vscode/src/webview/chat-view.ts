/**
 * chat-view.ts — 活动栏侧边栏视图:WebviewViewProvider 直接渲染 dsh 原生 UI。
 *
 * 布局与交互对齐 codex/claude code 扩展:点击活动栏图标,侧边栏直接显示
 * dsh 浏览器版界面(iframe 内嵌 127.0.0.1:3080 的 boot 页 = 上游原生 React 组件
 * 装配出的完整 UI,逐像素一致),而不是弹编辑器面板/节点列表。
 *
 * 扩展仅提供壳:面板生命周期、消息桥(转发给 host)、连接状态。
 * iframe 内 UI 的一切状态/事件由 dsh 实例自身管理(会话/模型/工具/审批),
 * 扩展不复制 UI 状态。
 */
import * as vscode from 'vscode';
import { nonce } from '../util/nonce.js';
import { validateWebviewRequest, type ExtensionMessage, type WebviewRequest } from './bridge.js';

/** 内嵌页:仅 iframe + CSP(frame-src 白名单仅实例地址,由配置注入) */
function buildHtml(baseUrl: string): string {
  const n = nonce();
  const origin = new URL(baseUrl).origin;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'unsafe-inline'; frame-src ${origin}; script-src 'nonce-${n}';" />
</head>
<body style="margin:0;height:100vh;overflow:hidden">
<iframe id="dsh-ui" src="${origin}/" style="width:100%;height:100%;border:none"
  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"></iframe>
</body>
</html>`;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'deepseekHarness.chat';

  private view: vscode.WebviewView | undefined;

  /** 请求回调:由 extension 接线(与 ChatPanel 同契约,失败由调用点转 UI error) */
  onRequest: (request: WebviewRequest) => void | Promise<void> = () => {};

  constructor(private readonly getBaseUrl: () => string) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    const baseUrl = this.getBaseUrl();
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = buildHtml(baseUrl);

    webviewView.webview.onDidReceiveMessage(
      (raw: unknown) => {
        let request: WebviewRequest;
        try {
          request = validateWebviewRequest(raw);
        } catch (error) {
          void vscode.window.showWarningMessage(
            `DeepSeek Harness:${error instanceof Error ? error.message : '非法消息'}`,
          );
          return;
        }
        // 与 ChatPanel 一致:async 失败必须转 UI error,防 webview 锁死
        void Promise.resolve(this.onRequest(request)).catch((error) => {
          this.post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
        });
      },
    );
  }

  /** 聚焦侧边栏视图(命令 deepseekHarness.open 与活动栏点击都走这里) */
  async reveal(): Promise<void> {
    await vscode.commands.executeCommand('deepseekHarness.chat.focus');
  }

  post(message: ExtensionMessage): void {
    void this.view?.webview.postMessage(message);
  }

  /** 实例地址变化(切换 baseUrl)时重载 iframe */
  reload(baseUrl: string): void {
    if (this.view) {
      this.view.webview.html = buildHtml(baseUrl);
    }
  }
}
