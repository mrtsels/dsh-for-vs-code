/**
 * terminal.ts — 命令执行走 VS Code 集成终端(TASK §0.5.5,Phase 1 输出不回传,
 * UI 标注"输出在集成终端查看";Phase 2 换 Pseudoterminal 接管)。
 */
import * as vscode from 'vscode';

const PREFIX = 'dsh';

export function runCommand(command: string): vscode.Terminal {
  const terminal =
    vscode.window.terminals.find((t) => t.name === PREFIX) ??
    vscode.window.createTerminal({ name: PREFIX, cwd: vscode.workspace.workspaceFolders?.[0]?.uri });
  terminal.show();
  terminal.sendText(command);
  return terminal;
}
