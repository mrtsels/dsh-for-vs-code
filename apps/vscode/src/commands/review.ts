/**
 * review.ts — deepseekHarness.review:打开 agent 改动审查面板(P2-7/P2-8)。
 */
import * as vscode from 'vscode';
import type { AppContext } from './context.js';

export function registerReview(ctx: AppContext): vscode.Disposable {
  return vscode.commands.registerCommand('deepseekHarness.review', () => {
    ctx.changesPanel.open();
  });
}
