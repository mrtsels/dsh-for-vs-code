/**
 * panel.ts — ChatPanel 生命周期:open/reveal/dispose、加载 dist/web/index.html(CSP nonce 注入)、
 * 消息桥接(onDidReceiveMessage → validateWebviewRequest → 回调)。全量 disposer 清理。
 */
import * as vscode from 'vscode';
import { readFileSync } from 'node:fs';
import { nonce } from '../util/nonce.js';
import { DisposableSet } from '../util/dispose.js';
import { validateWebviewRequest, type ExtensionMessage, type WebviewRequest } from './bridge.js';

export interface ChatPanelOptions {
  extensionUri: vscode.Uri;
  onRequest: (request: WebviewRequest) => void;
}

export class ChatPanel {
  static readonly viewType = 'deepseekHarness.chat';
  private readonly disposables = new DisposableSet();
  private panel?: vscode.WebviewPanel;
  private readonly html: string;

  constructor(private readonly options: ChatPanelOptions) {
    const indexPath = vscode.Uri.joinPath(options.extensionUri, 'dist', 'web', 'index.html');
    this.html = readFileSync(indexPath.fsPath, 'utf8');
  }

  open(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      ChatPanel.viewType,
      'DeepSeek Harness',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.options.extensionUri, 'dist', 'web')],
      },
    );
    this.panel = panel;
    panel.webview.html = this.renderHtml(panel.webview);
    this.disposables.add(
      panel.onDidDispose(() => {
        this.panel = undefined;
        this.disposables.dispose();
      }),
    );
    this.disposables.add(
      panel.webview.onDidReceiveMessage((raw: unknown) => {
        let request: WebviewRequest;
        try {
          request = validateWebviewRequest(raw);
        } catch (error) {
          void vscode.window.showWarningMessage(`DeepSeek Harness:${error instanceof Error ? error.message : '非法消息'}`);
          return;
        }
        this.options.onRequest(request);
      }),
    );
  }

  reveal(): void {
    this.panel?.reveal();
  }

  post(message: ExtensionMessage): void {
    this.panel?.webview.postMessage(message);
  }

  dispose(): void {
    this.disposables.dispose();
    this.panel?.dispose();
    this.panel = undefined;
  }

  private renderHtml(webview: vscode.Webview): string {
    const n = nonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.options.extensionUri, 'dist', 'web', 'index.js'),
    );
    return this.html
      .replaceAll('__NONCE__', n)
      .replace('src="./index.js"', `src="${scriptUri}"`);
  }
}
