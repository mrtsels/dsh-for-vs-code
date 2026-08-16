/**
 * chat-panel.ts — 主 UI:编辑器 WebviewPanel 装配 dsh 原生 UI(上游 shell 本地产物)。
 *
 * 工程范式对齐社区实践(Mingxi2077/dsh-vscode):主 UI 用 createWebviewPanel(宽面板,
 * 完整容纳 dsh 宽屏布局),活动栏为状态视图;UI 本身 = dsh 原生组件(不自研)。
 *
 * 装配:fetch-dsh-ui.mjs 从 3080 抓取上游 shell 产物(assets/vendor/css + 插件 client.js
 * + boot 图)到 dist/web/dsh-plugins/;本 panel 注入 boot.js + 加载 assets —— 与浏览器版
 * 同一套上游 React 组件与布局,资源全本地加载(CSP 无 remote origin)。
 */
import * as vscode from 'vscode';

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

export class ChatPanel implements ChatPanelHost {
  static readonly viewType = 'deepseekHarness.chatPanel';

  private readonly extensionUri: vscode.Uri;
  private readonly getBaseUrl: () => string;
  private panel: vscode.WebviewPanel | undefined;
  /** 可变 handler(extension.ts 接线,解决构造顺序) */
  onRequest: (message: WebviewRequest) => Promise<unknown> = async () => undefined;

  constructor(options: ChatPanelOptions) {
    this.extensionUri = options.extensionUri;
    this.getBaseUrl = options.getBaseUrl;
  }

  async open(): Promise<void> {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      ChatPanel.viewType,
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
    panel.webview.html = this.buildHtml(panel.webview);
    panel.webview.onDidReceiveMessage((request: WebviewRequest) => {
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

  /** 实例地址变化(切换 baseUrl)时重载 shell */
  reload(_baseUrl: string): void {
    if (this.panel) this.panel.webview.html = this.buildHtml(this.panel.webview);
  }

  post(message: ExtensionMessage): void {
    void this.panel?.webview.postMessage(message);
  }

  private buildHtml(webview: vscode.Webview): string {
    const asUri = (rel: string): vscode.Uri =>
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'web', 'dsh-plugins', ...rel.split('/'));
    const nonce = crypto.randomUUID().replace(/-/g, '');
    // webview 自身源(module import/css/img 均来自它);cspSource 随 webview 唯一
    const csp = webview.cspSource;
    const toWebview = (uri: vscode.Uri): string => webview.asWebviewUri(uri).toString();
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
    <script nonce="${nonce}" src="${toWebview(asUri('boot.js'))}"></script>
    <link rel="modulepreload" nonce="${nonce}" href="${toWebview(asUri('assets/vendor-Cjbwl5VI.js'))}" />
    <script type="module" nonce="${nonce}" src="${toWebview(asUri('assets/index-Dqw48FrP.js'))}"></script>
  </body>
</html>`;
  }
}
