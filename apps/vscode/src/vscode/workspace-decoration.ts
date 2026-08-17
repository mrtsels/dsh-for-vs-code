/**
 * workspace-decoration.ts — 编辑器内改动可视化(P1-1,112GT WorkspaceChangeDecorationProvider 模式)。
 *
 * 变化文件打开在激活编辑器时,用 diffEditor 主题色装饰 added/removed 行
 * + overviewRuler;回滚/接受后变化消失,装饰自动清除。
 */

import * as vscode from 'vscode';
import type { SnapshotChange } from './workspace.js';
import { diffLines } from './diff-lines.js';

export class WorkspaceChangeDecorationProvider implements vscode.Disposable {
  private readonly addedDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
    overviewRulerColor: new vscode.ThemeColor('diffEditorOverview.insertedForeground'),
  });
  private readonly removedDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('diffEditor.removedLineBackground'),
    overviewRulerColor: new vscode.ThemeColor('diffEditorOverview.removedForeground'),
  });
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly getChanges: () => SnapshotChange[]) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.refreshActive()),
    );
  }

  /** watcher 变化/回滚/接受后调用:激活编辑器若属变化文件则应用装饰,否则清空 */
  refreshActive(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const path = editor.document.uri.fsPath;
    const change = this.getChanges().find((c) => c.path === path);
    if (!change) {
      editor.setDecorations(this.addedDecoration, []);
      editor.setDecorations(this.removedDecoration, []);
      return;
    }
    const { added, removed } = diffLines(change.before, change.after);
    editor.setDecorations(
      this.addedDecoration,
      added.map((l) => new vscode.Range(l, 0, l, Number.MAX_SAFE_INTEGER)),
    );
    editor.setDecorations(
      this.removedDecoration,
      removed.map((l) => new vscode.Range(l, 0, l, Number.MAX_SAFE_INTEGER)),
    );
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.addedDecoration.dispose();
    this.removedDecoration.dispose();
  }
}
