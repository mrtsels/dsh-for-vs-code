/**
 * changes-panel.ts — 改动审批面板(P2-7/P2-8):展示 agent 改动 diff,支持一键回滚。
 * 与 ChatPanel 同构:加载 dist/web/changes.html,单点 nonce,CSP 无 inline script。
 */
import * as vscode from 'vscode';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DisposableSet } from '../util/dispose.js';
import { nonce } from '../util/nonce.js';
import type { ChangeItem, ExtensionMessage, WebviewRequest } from './bridge.js';

interface Options {
  extensionUri: vscode.Uri;
}

export class ChangesPanel {
  static readonly viewType = 'deepseekHarness.changes';
  private readonly disposables = new DisposableSet();
  private panel: vscode.WebviewPanel | undefined;
  private readonly html: string;
  private readonly options: Options;
  /** 请求回调:构造后由 extension 接线(解决构造顺序依赖) */
  onRequest: (request: WebviewRequest) => void = () => {};

  constructor(options: Options) {
    this.options = options;
    const htmlPath = resolve(options.extensionUri.fsPath, 'dist', 'web', 'changes.html');
    this.html = readFileSync(htmlPath, 'utf8');
  }

  open(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      ChangesPanel.viewType,
      'DeepSeek Harness — 改动审查',
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
          request = validateChangesRequest(raw);
        } catch (error) {
          void vscode.window.showWarningMessage(`DeepSeek Harness:${error instanceof Error ? error.message : '非法消息'}`);
          return;
        }
        this.onRequest(request);
      }),
    );
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
      vscode.Uri.joinPath(this.options.extensionUri, 'dist', 'web', 'changes.js'),
    );
    return this.html
      .replaceAll('__NONCE__', n)
      .replace('src="./changes.js"', `src="${scriptUri}"`);
  }
}

/** changes 面板只接受 changes 域请求(白名单收口) */
function validateChangesRequest(raw: unknown): WebviewRequest {
  if (typeof raw !== 'object' || raw === null) throw new Error('bridge: message is not an object');
  const msg = raw as Record<string, unknown>;
  switch (msg.type) {
    case 'changes:list':
      return { type: 'changes:list' };
    case 'changes:rollback':
      if (typeof msg.path !== 'string' || msg.path.length === 0 || msg.path.length > 1_000) {
        throw new Error('changes:rollback.path 非法');
      }
      return { type: 'changes:rollback', path: msg.path };
    case 'changes:accept':
      if (typeof msg.path !== 'string' || msg.path.length === 0 || msg.path.length > 1_000) {
        throw new Error('changes:accept.path 非法');
      }
      return { type: 'changes:accept', path: msg.path };
    default:
      throw new Error(`changes panel: 未知消息 ${String(msg.type)}`);
  }
}

/** 把 SnapshotChange 转为面板可渲染条目 */
export function toChangeItems(changes: { path: string; before: string; after: string; at: number }[]): ChangeItem[] {
  return changes.map((c) => ({ path: c.path, diff: buildDiffText(c), at: c.at }));
}

function buildDiffText(c: { path: string; before: string; after: string }): string {
  const a = c.before.split('\n');
  const b = c.after.split('\n');
  const out = [`--- a/${shortPath(c.path)}`, `+++ b/${shortPath(c.path)}`];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
    } else if (a[i + 1] === b[j]) {
      out.push(`- ${a[i]}`);
      i += 1;
    } else if (a[i] === b[j + 1]) {
      out.push(`+ ${b[j]}`);
      j += 1;
    } else {
      out.push(`- ${a[i]}`);
      out.push(`+ ${b[j]}`);
      i += 1;
      j += 1;
    }
  }
  while (i < a.length) out.push(`- ${a[i++]}`);
  while (j < b.length) out.push(`+ ${b[j++]}`);
  return out.join('\n');
}

function shortPath(p: string): string {
  const parts = p.split('/');
  return parts.slice(-2).join('/');
}
