/**
 * chat-panel.ts — 主 UI:装配 dsh 原生 UI(上游 shell 本地产物)。
 *
 * 双模式:
 * - 活动栏侧边栏(WebviewView):点击图标直显原生 UI(主入口)
 * - 编辑器面板(WebviewPanel):deepseekHarness.open 命令(可选)
 *
 * UI = dsh 上游 React 组件(与浏览器版一致),资源全本地(dist/web/dsh-plugins),
 * CSP 无 remote origin。fetch-dsh-ui.mjs 从 3080 抓取产物(boot 图 + assets + 插件)。
 */
import * as vscode from 'vscode';
import { readFileSync } from 'node:fs';

import type { WebviewRequest } from './bridge.js';
import type { ExtensionMessage } from './bridge.js';

export interface ChatPanelHost {
  open: () => Promise<void>;
  post: (message: ExtensionMessage) => void;
  reload: (baseUrl: string) => void;
}

interface ChatPanelOptions {
  extensionUri: vscode.Uri;
  getBaseUrl: () => string;
}

export class ChatPanel implements ChatPanelHost, vscode.WebviewViewProvider {
  static readonly viewType = 'deepseekHarness.chat';

  private readonly extensionUri: vscode.Uri;
  private readonly getBaseUrl: () => string;
  private panel: vscode.WebviewPanel | undefined;
  private view: vscode.WebviewView | undefined;
  /** 可变 handler(extension.ts 接线,解决构造顺序) */
  onRequest: (message: WebviewRequest) => Promise<unknown> = async () => undefined;

  constructor(options: ChatPanelOptions) {
    this.extensionUri = options.extensionUri;
    this.getBaseUrl = options.getBaseUrl;
  }

  /** WebviewViewProvider:活动栏点击 → 侧边栏直显原生 UI */
  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    const { webview } = webviewView;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist', 'web', 'dsh-plugins'),
        vscode.Uri.joinPath(this.extensionUri, 'dist', 'web'),
      ],
    };
    this.attach(webview);
    // view 销毁后失效,防止 post 到已销毁 webview
    webviewView.onDidDispose(() => {
      if (this.view === webviewView) this.view = undefined;
    });
  }

  /** 编辑器面板(可选入口) */
  async open(): Promise<void> {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      `${ChatPanel.viewType}.panel`,
      'DeepSeek Harness',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'dist', 'web', 'dsh-plugins'),
          vscode.Uri.joinPath(this.extensionUri, 'dist', 'web'),
        ],
      },
    );
    this.panel = panel;
    panel.onDidDispose(() => {
      this.panel = undefined;
    });
    this.attach(panel.webview);
  }

  /** 实例地址变化(切换 baseUrl)时重载 shell */
  reload(_baseUrl: string): void {
    const webview = this.view?.webview ?? this.panel?.webview;
    if (webview) webview.html = this.buildHtml(webview);
  }

  post(message: ExtensionMessage): void {
    void this.view?.webview.postMessage(message);
    void this.panel?.webview.postMessage(message);
  }

  private attach(webview: vscode.Webview): void {
    webview.html = this.buildHtml(webview);
    webview.onDidReceiveMessage((request: WebviewRequest) => {
      // 调试通道:webview 内 error/unhandledrejection 转发
      if (request.type === 'debug') {
        console.log(`[dsh-webview:${request.kind}]`, request.message);
        return;
      }
      void Promise.resolve(this.onRequest(request)).catch((error) => {
        this.post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      });
    });
  }

  private buildHtml(webview: vscode.Webview): string {
    const asUri = (rel: string): vscode.Uri =>
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'web', 'dsh-plugins', ...rel.split('/'));
    const nonce = crypto.randomUUID().replace(/-/g, '');
    const csp = webview.cspSource;
    const toWebview = (uri: vscode.Uri): string => webview.asWebviewUri(uri).toString();
    // boot 脚本内联(CSP nonce 允许),消除外部 script 加载的不确定;debugBridge 随之生效
    const bootJs = readFileSync(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'web', 'dsh-plugins', 'boot.js').fsPath,
      'utf8',
    ).replace(/<\/script>/gi, '<\\/script>');
    return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src 'nonce-${nonce}' ${csp}; img-src ${csp} data: blob:; font-src ${csp} data:; connect-src http://127.0.0.1:3080 ws://127.0.0.1:3080; worker-src ${csp} blob:;" />
    <link rel="stylesheet" href="${toWebview(asUri('assets/vendor-CjyC-hUb.css'))}" />
    <link rel="stylesheet" href="${toWebview(asUri('assets/index-CSGf6Qzd.css'))}" />
  </head>
  <body style="margin:0;padding:0;height:100vh;overflow:hidden">
    <div id="root" style="height:100vh"></div>
    <script nonce="${nonce}">${bootJs}</script>
    <script type="module" nonce="${nonce}" src="${toWebview(asUri('assets/index-Dqw48FrP.js'))}"></script>
  </body>
</html>`;
  }
}
