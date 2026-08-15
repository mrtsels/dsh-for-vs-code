import { describe, expect, it } from 'vitest';
import { diffLines } from '../src/util/diff.js';

describe('diffLines(方案 a 快照对比)', () => {
  it('无变化 → 空 diff', () => {
    expect(diffLines('a\nb\nc', 'a\nb\nc')).toBe('');
  });

  it('新增行标 +', () => {
    const d = diffLines('a\nb', 'a\nb\nc');
    expect(d).toContain('+ c');
  });

  it('删除行标 -', () => {
    const d = diffLines('a\nb\nc', 'a\nc');
    expect(d).toContain('- b');
  });

  it('修改行成对出现', () => {
    const d = diffLines('hello', 'world');
    expect(d).toContain('- hello');
    expect(d).toContain('+ world');
  });
});
