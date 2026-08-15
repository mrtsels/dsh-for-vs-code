/**
 * chat-view.ts — 活动栏侧边栏视图:WebviewViewProvider 装配 dsh 原生 UI。
 *
 * P5-4 装配方式(本地产物):fetch-dsh-ui.mjs 从 3080 抓取上游 shell 产物
 * (assets/index+vendor js/css + 38 个插件 client.js + boot 图)到 dist/web/dsh-plugins/;
 * 本 provider 在 webview 里注入 boot.js + 加载本地 assets —— 与浏览器版同一套
 * 上游 React 组件与布局,但全部资源本地加载(无 remote origin,符合 CSP 红线)。
 * 后续 Phase 6 改为自建定制 boot 图(插件子集)。
 */
import * as vscode from 'vscode';

import type { WebviewRequest } from './bridge.js';
import type { ExtensionMessage } from './bridge.js';

export interface ChatPanelHost {
  open: () => Promise<void>;
  post: (message: ExtensionMessage) => void;
  reload: (baseUrl: string) => void;
}

interface ChatViewProviderOptions {
  extensionUri: vscode.Uri;
  getBaseUrl: () => string;
}

export class ChatViewProvider implements vscode.WebviewViewProvider, ChatPanelHost {
  static readonly viewType = 'deepseekHarness.chat';

  private readonly extensionUri: vscode.Uri;
  private readonly getBaseUrl: () => string;
  private view: vscode.WebviewView | undefined;
  /** 可变 handler(extension.ts 接线,解决构造顺序) */
  onRequest: (message: WebviewRequest) => Promise<unknown> = async () => undefined;

  constructor(options: ChatViewProviderOptions) {
    this.extensionUri = options.extensionUri;
    this.getBaseUrl = options.getBaseUrl;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    const { webview } = webviewView;
    webview.options = {
      // 仅放行 dsh shell 产物目录 + changes 面板资源
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist', 'web', 'dsh-plugins'),
        vscode.Uri.joinPath(this.extensionUri, 'dist', 'web'),
      ],
      enableScripts: true,
    };
    webview.html = this.buildHtml();
    webview.onDidReceiveMessage((request: WebviewRequest) => {
      void Promise.resolve(this.onRequest(request)).catch((error) => {
        this.post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      });
    });
  }

  /** 从 3080 拉取/重建本地产物后调用,重载 shell */
  reload(_baseUrl: string): void {
    if (this.view) this.view.webview.html = this.buildHtml();
  }

  async open(): Promise<void> {
    await vscode.commands.executeCommand(`${ChatViewProvider.viewType}.focus`);
  }

  post(message: ExtensionMessage): void {
    void this.view?.webview.postMessage(message);
  }

  private buildHtml(): string {
    const asUri = (rel: string): vscode.Uri =>
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'web', 'dsh-plugins', ...rel.split('/'));
    const nonce = crypto.randomUUID().replace(/-/g, '');
    const bootJs = asUri('boot.js');
    const indexJs = asUri('assets/index-Dqw48FrP.js');
    const vendorJs = asUri('assets/vendor-Cjbwl5VI.js');
    const vendorCss = asUri('assets/vendor-CjyC-hUb.css');
    const indexCss = asUri('assets/index-CSGf6Qzd.css');
    return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webviewCsp(this.view?.webview)} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webviewCsp(this.view?.webview)} data:; font-src ${webviewCsp(this.view?.webview)} data:; connect-src http://127.0.0.1:3080 ws://127.0.0.1:3080;" />
    <link rel="stylesheet" href="${webviewAsUri(this.view?.webview, vendorCss)}" />
    <link rel="stylesheet" href="${webviewAsUri(this.view?.webview, indexCss)}" />
  </head>
  <body style="margin:0;padding:0;height:100vh;overflow:hidden">
    <div id="root" style="height:100vh"></div>
    <script nonce="${nonce}" src="${webviewAsUri(this.view?.webview, bootJs)}"></script>
    <link rel="modulepreload" nonce="${nonce}" href="${webviewAsUri(this.view?.webview, vendorJs)}" />
    <script type="module" nonce="${nonce}" src="${webviewAsUri(this.view?.webview, indexJs)}"></script>
  </body>
</html>`;
  }
}

function webviewCsp(w: vscode.Webview | undefined): string {
  return w?.cspSource ?? 'https://*.vscode-cdn.net';
}

function webviewAsUri(w: vscode.Webview | undefined, uri: vscode.Uri): string {
  return (w ?? { asWebviewUri: (u: vscode.Uri) => u }).asWebviewUri(uri).toString();
}
