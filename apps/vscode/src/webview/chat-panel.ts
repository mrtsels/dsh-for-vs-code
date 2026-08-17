/**
 * chat-panel.ts — 主 UI:装配 dsh 原生 UI(上游 shell 源码构建产物)。
 *
 * 双模式:
 * - 活动栏侧边栏(WebviewView):点击图标直显原生 UI(主入口)
 * - 编辑器面板(WebviewPanel):deepseekHarness.open 命令(可选)
 *
 * UI = dsh 上游 React 组件(与浏览器版一致),资源全本地(dist/web/dsh-shell,
 * 由 build-web-shell.mjs 从 vendor 源码构建装配),CSP 无 remote origin。
 * index.html 与 boot.js 为构建产物;此处只注入 CSP/base href/__DSH_WEB_URL__。
 */
import * as vscode from 'vscode';
import { readFileSync } from 'node:fs';

import type { WebviewRequest } from './bridge.js';
import type { ExtensionMessage } from './bridge.js';
import { Logger } from '../util/logger.js';

export interface ChatPanelHost {
  open: () => Promise<void>;
  post: (message: ExtensionMessage) => void;
  reload: (baseUrl: string) => void;
}

interface ChatPanelOptions {
  extensionUri: vscode.Uri;
  getBaseUrl: () => string;
  /** webview 直连 3080 会被 Origin 栅栏 403;扩展侧代理地址由 extension.ts 注入 */
  getProxyBase: () => string;
}

export class ChatPanel implements ChatPanelHost, vscode.WebviewViewProvider {
  static readonly viewType = 'deepseekHarness.chat';

  private readonly extensionUri: vscode.Uri;
  private readonly getBaseUrl: () => string;
  private readonly getProxyBase: () => string;
  /** webview 调试消息(错误横幅/CSP 探针)落输出通道,不弹 UI */
  private readonly log = new Logger('dsh-webview');
  private panel: vscode.WebviewPanel | undefined;
  private view: vscode.WebviewView | undefined;
  /** 可变 handler(extension.ts 接线,解决构造顺序) */
  onRequest: (message: WebviewRequest) => Promise<unknown> = async () => undefined;

  constructor(options: ChatPanelOptions) {
    this.extensionUri = options.extensionUri;
    this.getBaseUrl = options.getBaseUrl;
    this.getProxyBase = options.getProxyBase;
  }

  /** WebviewViewProvider:活动栏点击 → 侧边栏直显原生 UI */
  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    const { webview } = webviewView;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist', 'web', 'dsh-shell'),
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
          vscode.Uri.joinPath(this.extensionUri, 'dist', 'web', 'dsh-shell'),
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