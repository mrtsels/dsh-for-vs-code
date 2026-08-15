/**
 * ask.ts — deepseekHarness.ask:读取选中文本(有则携带)→ 打开面板并提问。
 */
import * as vscode from 'vscode';
import type { AppContext } from './context.js';
import { ensureConnected, ensureSession } from './context.js';

export function registerAsk(ctx: AppContext): vscode.Disposable {
  return vscode.commands.registerCommand('deepseekHarness.ask', async () => {
    const editor = vscode.window.activeTextEditor;
    const selection =
      editor === undefined || editor.selection.isEmpty
        ? undefined
        : editor.document.getText(editor.selection);
    const text =
      selection !== undefined
        ? `请处理以下选中内容:\n\n${selection}`
        : await vscode.window.showInputBox({ prompt: 'Ask DeepSeek Harness', placeHolder: '输入问题…' });
    if (text === undefined || text.trim() === '') return;
    void ctx.panel.open();
    try {
      await ensureConnected(ctx);
      const sessionId = await ensureSession(ctx);
      ctx.activeSessionId.value = sessionId;
      await ctx.sessions.seedHistory(sessionId, 50);
      await ctx.controller.ask(sessionId, text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.logger.error(`ask failed: ${message}`);
      ctx.panel.post({ type: 'error', message });
    }
  });
}
