/**
 * review.ts — deepseekHarness.review:查看 agent 改动(快照 diff 视图,方案 a),支持一键回滚。
 * Phase 1 实现:QuickPick 选择改动文件 → diff 编辑器(before vs 当前)→ 可回滚。
 */
import * as vscode from 'vscode';
import type { AppContext } from './context.js';
import { displayPath, type SnapshotChange } from '../vscode/workspace.js';

export function registerReview(ctx: AppContext): vscode.Disposable {
  return vscode.commands.registerCommand('deepseekHarness.review', async () => {
    const changes = ctx.watcher.listChanges();
    if (changes.length === 0) {
      void vscode.window.showInformationMessage('DeepSeek Harness:暂无可审查的改动');
      return;
    }
    const roots = vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [];
    const pick = await vscode.window.showQuickPick(
      changes.map((c) => ({
        label: displayPath(c.path, roots),
        description: `±${c.before.split('\n').length}/${c.after.split('\n').length} 行`,
        change: c,
      })),
      { title: 'DeepSeek Harness — agent 改动审查' },
    );
    if (!pick) return;
    await showDiff(pick.change, roots);
    const rollback = await vscode.window.showInformationMessage(
      `回滚 ${displayPath(pick.change.path, roots)}?`,
      { modal: false },
      '回滚',
    );
    if (rollback === '回滚') {
      await ctx.watcher.rollback(pick.change);
      void vscode.window.showInformationMessage('已回滚(可在编辑器 Undo 撤销回滚)');
    }
  });
}

async function showDiff(change: SnapshotChange, roots: string[]): Promise<void> {
  const beforeUri = vscode.Uri.parse(`untitled:dsh-before:${displayPath(change.path, roots)}`);
  await vscode.workspace.openTextDocument(beforeUri); // 必须先打开文档,WorkspaceEdit 才能作用其上
  const edit = new vscode.WorkspaceEdit();
  edit.insert(beforeUri, new vscode.Position(0, 0), change.before);
  await vscode.workspace.applyEdit(edit);
  const currentUri = vscode.Uri.file(change.path);
  await vscode.commands.executeCommand('vscode.diff', beforeUri, currentUri, 'before → 当前');
}
