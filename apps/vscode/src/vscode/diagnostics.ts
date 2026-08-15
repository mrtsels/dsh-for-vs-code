/**
 * diagnostics.ts — 收集当前文件/工作区诊断(P2-3),格式化为模型可见;变更推送 UI 徽标。
 */
import * as vscode from 'vscode';
import type { DiagnosticItem } from '../agent/context.js';

export function collectDiagnostics(uri?: vscode.Uri): DiagnosticItem[] {
  const items: DiagnosticItem[] = [];
  const sources = uri ? [[uri, vscode.languages.getDiagnostics(uri)] as const] : vscode.languages.getDiagnostics();
  for (const [u, diagnostics] of sources) {
    for (const d of diagnostics) {
      const severity: DiagnosticItem['severity'] =
        d.severity === vscode.DiagnosticSeverity.Error
          ? 'error'
          : d.severity === vscode.DiagnosticSeverity.Warning
            ? 'warning'
            : d.severity === vscode.DiagnosticSeverity.Information
              ? 'info'
              : 'hint';
      items.push({
        file: vscode.workspace.asRelativePath(u, false) || u.fsPath,
        line: d.range.start.line + 1,
        severity,
        message: d.message.split('\n')[0] ?? '',
      });
    }
  }
  // 稳定排序:错误优先,再按文件/行
  const order = { error: 0, warning: 1, info: 2, hint: 3 } as const;
  items.sort((a, b) => order[a.severity] - order[b.severity] || a.file.localeCompare(b.file) || a.line - b.line);
  return items;
}

/** 统计工作区诊断数(error/warning),供 UI 徽标 */
export function countWorkspaceDiagnostics(): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const [, diagnostics] of vscode.languages.getDiagnostics()) {
    for (const d of diagnostics) {
      if (d.severity === vscode.DiagnosticSeverity.Error) errors += 1;
      else if (d.severity === vscode.DiagnosticSeverity.Warning) warnings += 1;
    }
  }
  return { errors, warnings };
}
