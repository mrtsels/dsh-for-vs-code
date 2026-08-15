/**
 * editor.ts — 活动编辑器上下文收集(P2-1):文件路径、选区、当前行。
 * 格式化用纯函数 src/agent/context.ts(可单测)。
 */
import * as vscode from 'vscode';
import type { EditorContext, SelectionInfo } from '../agent/context.js';

export function collectEditorContext(workspaceRoot: string): EditorContext {
  const editor = vscode.window.activeTextEditor;
  const ctx: EditorContext = { diagnostics: [], gitChanges: new Map() };
  if (!editor) return ctx;
  const doc = editor.document;
  const root = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath ?? workspaceRoot;
  ctx.file = vscode.workspace.asRelativePath(doc.uri, false) || doc.fileName;
  if (root !== workspaceRoot) {
    // 文件不在主工作区时用绝对路径,避免误导模型
    ctx.file = doc.fileName;
  }
  const sel = editor.selection;
  if (!sel.isEmpty) {
    // P2-3:选区文本限长,防超大选区整段注入模型上下文
    const text = doc.getText(sel);
    const MAX = 20_000;
    const truncated = text.length > MAX ? `${text.slice(0, MAX)}\n…(已截断,共 ${text.length} 字符)` : text;
    const s: SelectionInfo = {
      startLine: sel.start.line + 1,
      startCol: sel.start.character + 1,
      endLine: sel.end.line + 1,
      endCol: sel.end.character + 1,
      text: truncated,
    };
    ctx.selection = s;
  }
  return ctx;
}
