/**
 * agent.ts — deepseekHarness.open:打开 Chat 面板。
 */
import * as vscode from 'vscode';
import type { AppContext } from './context.js';

export function registerAgent(ctx: AppContext): vscode.Disposable {
  return vscode.commands.registerCommand('deepseekHarness.open', () => {
    void ctx.panel.open();
  });
}
