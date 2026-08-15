/**
 * context.ts — model-facing 上下文格式化(P2-1/P2-2)。纯函数,零依赖。
 * 形状:file/selection/diagnostics/git(§6),注入为 user 消息前缀(问题前缀注入)。
 */
export interface DiagnosticItem {
  file: string;
  line: number;
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
}

export interface SelectionInfo {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  text: string;
}

export interface EditorContext {
  file?: string;
  selection?: SelectionInfo;
  diagnostics: DiagnosticItem[];
  /** git 变更摘要(file → 增删行数),为空表示工作区干净 */
  gitChanges: Map<string, { additions: number; deletions: number }>;
}

/** 结构化为模型可见的上下文块;空上下文返回空串 */
export function formatEditorContext(ctx: EditorContext): string {
  const parts: string[] = [];
  if (ctx.file) {
    parts.push(`file: ${ctx.file}`);
  }
  if (ctx.selection) {
    const s = ctx.selection;
    parts.push(`selection: lines ${s.startLine}:${s.startCol}-${s.endLine}:${s.endCol}`);
    parts.push('```');
    parts.push(s.text);
    parts.push('```');
  }
  if (ctx.diagnostics.length > 0) {
    parts.push('diagnostics:');
    for (const d of ctx.diagnostics.slice(0, 20)) {
      parts.push(`- [${d.severity}] ${d.file}:${d.line}: ${d.message}`);
    }
    if (ctx.diagnostics.length > 20) parts.push(`- …(另有 ${ctx.diagnostics.length - 20} 条)`);
  }
  if (ctx.gitChanges.size > 0) {
    parts.push('git working-tree changes:');
    for (const [file, c] of ctx.gitChanges) {
      parts.push(`- ${file} (+${c.additions}/-${c.deletions})`);
    }
  }
  return parts.length === 0 ? '' : `<editor-context>\n${parts.join('\n')}\n</editor-context>`;
}
