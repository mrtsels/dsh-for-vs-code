import * as vscode from 'vscode';
import { nonce } from './util/nonce.js';

let currentPanel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('deepseekHarness.open', () => openPanel(context)),
    vscode.commands.registerCommand('deepseekHarness.ask', async () => {
      const editor = vscode.window.activeTextEditor;
      const selection =
        editor === undefined || editor.selection.isEmpty
          ? undefined
          : editor.document.getText(editor.selection);
      await openPanel(context);
      if (selection) {
        vscode.window.showInformationMessage(
          `已捕获选区(${selection.length} 字符),Phase 1 接入对话后自动带上。`,
        );
      }
    }),
    vscode.window.registerTreeDataProvider('deepseekHarness.chat', placeholderTree),
  );
}

export function deactivate(): void {
  // context.subscriptions 自动 dispose;无其他常驻资源
}

function openPanel(context: vscode.ExtensionContext): void {
  if (currentPanel) {
    currentPanel.reveal();
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    'deepseekHarness.chat',
    'DeepSeek Harness',
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'web')],
    },
  );
  currentPanel = panel;
  panel.onDidDispose(() => {
    currentPanel = undefined;
  });
  panel.webview.html = webviewHtml(panel.webview, context);
}

function webviewHtml(webview: vscode.Webview, context: vscode.ExtensionContext): string {
  const indexUri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'dist', 'web', 'index.js'),
  );
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce()}'; img-src 'self' data:" />
  <title>DeepSeek Harness</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce()}" src="${indexUri}"></script>
</body>
</html>`;
  return html;
}

const placeholderTree: vscode.TreeDataProvider<{ label: string }> = {
  getTreeItem(element) {
    return { label: element.label, collapsibleState: vscode.TreeItemCollapsibleState.None };
  },
  getChildren() {
    return Promise.resolve([{ label: 'dsh web: 未连接(Phase 1)' }]);
  },
};
