import { describe, expect, it } from 'vitest';
import { applyHunks, parsePatch } from '../src/agent/patch.js';

const PATCH = `--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,5 +1,6 @@
 line1
-line2
+line2-changed
 line3
 line4
 line5
`;

describe('parsePatch', () => {
  it('解析文件头 + hunk + 行类型', () => {
    const files = parsePatch(PATCH);
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe('src/foo.ts');
    const hunk = files[0]?.hunks[0];
    expect(hunk).toMatchObject({ oldStart: 1, oldLines: 5, newStart: 1, newLines: 6 });
    expect(hunk?.lines.map((l) => l.kind)).toEqual([
      'context', 'delete', 'add', 'context', 'context', 'context',
    ]);
  });

  it('多文件补丁', () => {
    const text = `--- a/a\n+++ b/a\n@@ -1,1 +1,1 @@\n-x\n+y\n--- a/b\n+++ b/b\n@@ -1,1 +1,1 @@\n-z\n+w\n`;
    expect(parsePatch(text)).toHaveLength(2);
  });

  it('坏 hunk 头抛错', () => {
    expect(() => parsePatch('--- a/x\n+++ b/x\n@@ bad @@\n')).toThrow();
  });
});

describe('applyHunks', () => {
  it('增删改正常应用', () => {
    const r = applyHunks('line1\nline2\nline3\nline4\nline5', [
      { oldStart: 1, oldLines: 5, newStart: 1, newLines: 6, lines: [
        { kind: 'context', text: 'line1' },
        { kind: 'delete', text: 'line2' },
        { kind: 'add', text: 'line2-changed' },
        { kind: 'context', text: 'line3' },
        { kind: 'context', text: 'line4' },
        { kind: 'context', text: 'line5' },
      ] },
    ]);
    expect(r.ok && r.content).toBe('line1\nline2-changed\nline3\nline4\nline5');
  });

  it('重叠冲突显式报错', () => {
    const r = applyHunks('aaa\nbbb', [
      { oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [
        { kind: 'context', text: 'AAA' }, // 与文件不符
        { kind: 'delete', text: 'bbb' },
      ] },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('上下文不匹配');
  });

  it('多 hunk 顺序应用正确', () => {
    const r = applyHunks('a\nb\nc\nd', [
      { oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: [
        { kind: 'delete', text: 'a' },
        { kind: 'add', text: 'a1' },
        { kind: 'context', text: 'b' },
      ] },
      { oldStart: 3, oldLines: 2, newStart: 4, newLines: 2, lines: [
        { kind: 'delete', text: 'c' },
        { kind: 'context', text: 'd' },
      ] },
    ]);
    expect(r.ok && r.content).toBe('a1\nb\nd');
  });
});
