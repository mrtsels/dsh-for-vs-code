/**
 * native.ts — P4-2/P4-3:VS Code 原生入口。
 * - Code Actions:解释选中代码 / 修复诊断(走与 webview 相同的 ask 路径,上下文注入)
 * - 编辑器右键菜单命令:Ask dsh to fix(活动文件诊断)
 * 不做双模型:入口只是触发,模型/loop 仍是 dsh 实例。
 */
import * as vscode from 'vscode';
import type { AppContext } from './context.js';
import { collectEditorContext } from '../vscode/editor.js';
import { formatEditorContext } from '../agent/context.js';

/** 打开 chat 面板并把问题注入活动会话(与 webview ask 同路径) */
async function askViaPanel(ctx: AppContext, question: string): Promise<void> {
  await ctx.runtime.connect();
  let sessionId = ctx.activeSessionId.value;
  if (!sessionId) {
    sessionId = await ctx.sessions.create();
    ctx.activeSessionId.value = sessionId;
  }
  ctx.controller.setActiveSession(sessionId);
  await ctx.sessions.seedHistory(sessionId);

  const editorCtx = collectEditorContext(
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
  );
  const block = formatEditorContext(editorCtx);
  const finalText = block === '' ? question : `${block}\n\n${question}`;
  await ctx.controller.ask(sessionId, finalText);

  ctx.panel.open();
}

export function registerCodeActions(_ctx: AppContext): vscode.Disposable {
  return vscode.languages.registerCodeActionsProvider(
    '*',
    {
      provideCodeActions(document, range, context): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];
        const selected = document.getText(range).trim();
        if (selected !== '') {
          const explain = new vscode.CodeAction('dsh: 解释选中代码', vscode.CodeActionKind.QuickFix);
          explain.command = {
            command: 'deepseekHarness.explainSelection',
            title: 'dsh: 解释选中代码',
            arguments: [selected],
          };
          actions.push(explain);
        }
        const diag = context.diagnostics.find((d) => d.range.intersection(range));
        if (diag) {
          const fix = new vscode.CodeAction('dsh: 修复此问题', vscode.CodeActionKind.QuickFix);
          fix.command = {
            command: 'deepseekHarness.fixDiagnostic',
            title: 'dsh: 修复此问题',
            arguments: [
              {
                file: document.uri.fsPath,
                line: diag.range.start.line + 1,
                message: diag.message.split('\n')[0] ?? '',
              },
            ],
          };
          actions.push(fix);
        }
        return actions;
      },
    },
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
  );
}

export function registerNativeCommands(ctx: AppContext): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('deepseekHarness.explainSelection', (selected: unknown) => {
      const text = typeof selected === 'string' ? selected : '';
      const question = text === '' ? '请解释当前选中内容。' : `请解释下面这段代码:\n\`\`\`\n${text}\n\`\`\``;
      void askViaPanel(ctx, question).catch((error) => {
        ctx.logger.warn(`explainSelection 失败:${error instanceof Error ? error.message : String(error)}`);
      });
    }),
    vscode.commands.registerCommand(
      'deepseekHarness.fixDiagnostic',
      (info: unknown) => {
        const diag = info as { file?: unknown; line?: unknown; message?: unknown } | undefined;
        const file = typeof diag?.file === 'string' ? diag.file : '当前文件';
        const line = typeof diag?.line === 'number' ? diag.line : undefined;
        const message = typeof diag?.message === 'string' ? diag.message : '';
        const where = line !== undefined ? `${file}:${line}` : file;
        const question = `修复 ${where} 的诊断问题${message !== '' ? `:${message}` : ''}。`;
        void askViaPanel(ctx, question).catch((error) => {
          ctx.logger.warn(`fixDiagnostic 失败:${error instanceof Error ? error.message : String(error)}`);
        });
      },
    ),
    vscode.commands.registerCommand('deepseekHarness.fixDiagnosticFromMenu', () => {
      // 编辑器右键:取活动文件第一条 error 诊断
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const diags = vscode.languages.getDiagnostics(editor.document.uri);
      const first = diags[0];
      const question = first
        ? `修复 ${vscode.workspace.asRelativePath(editor.document.uri, false)}:${first.range.start.line + 1} 的诊断问题:${first.message.split('\n')[0] ?? ''}。`
        : '当前文件没有诊断,请检查代码质量。';
      void askViaPanel(ctx, question).catch((error) => {
        ctx.logger.warn(`fixDiagnosticFromMenu 失败:${error instanceof Error ? error.message : String(error)}`);
      });
    }),
  ];
}
