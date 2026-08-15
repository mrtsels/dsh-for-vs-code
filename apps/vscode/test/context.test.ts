import { describe, expect, it } from 'vitest';
import { formatEditorContext, type EditorContext } from '../src/agent/context.js';

const base: EditorContext = { diagnostics: [], gitChanges: new Map() };

describe('formatEditorContext', () => {
  it('空上下文 → 空串', () => {
    expect(formatEditorContext(base)).toBe('');
  });

  it('文件 + 选区 + 诊断 + git 完整块', () => {
    const ctx: EditorContext = {
      file: 'src/foo.ts',
      selection: { startLine: 3, startCol: 1, endLine: 3, endCol: 10, text: 'const x = 1' },
      diagnostics: [{ file: 'src/foo.ts', line: 5, severity: 'error', message: '类型不匹配' }],
      gitChanges: new Map([['src/foo.ts', { additions: 2, deletions: 1 }]]),
    };
    const out = formatEditorContext(ctx);
    expect(out).toContain('<editor-context>');
    expect(out).toContain('file: src/foo.ts');
    expect(out).toContain('lines 3:1-3:10');
    expect(out).toContain('const x = 1');
    expect(out).toContain('[error] src/foo.ts:5: 类型不匹配');
    expect(out).toContain('src/foo.ts (+2/-1)');
  });

  it('诊断超 20 条折叠提示', () => {
    const diags = Array.from({ length: 25 }, (_, i) => ({ file: 'a', line: i, severity: 'warning' as const, message: `m${i}` }));
    const out = formatEditorContext({ ...base, diagnostics: diags });
    expect(out).toContain('另有 5 条');
  });
});
