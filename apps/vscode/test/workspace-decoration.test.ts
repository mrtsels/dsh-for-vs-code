import { describe, expect, it } from 'vitest';
import { diffLines } from '../src/vscode/diff-lines.js';

describe('diffLines', () => {
  it('相同内容无差异', () => {
    expect(diffLines('a\nb\nc', 'a\nb\nc')).toEqual({ added: [], removed: [] });
  });

  it('纯新增行标 added', () => {
    expect(diffLines('a\nb', 'a\nb\nc')).toEqual({ added: [2], removed: [] });
  });

  it('纯删除行标 removed', () => {
    expect(diffLines('a\nb\nc', 'a\nb')).toEqual({ added: [], removed: [2] });
  });

  it('修改行同时标 added+removed', () => {
    expect(diffLines('a\nb', 'a\nX')).toEqual({ added: [1], removed: [1] });
  });

  it('空 before 全为新增', () => {
    expect(diffLines('', 'x\ny')).toEqual({ added: [0, 1], removed: [] });
  });

  it('空 after 全为删除', () => {
    expect(diffLines('x\ny', '')).toEqual({ added: [], removed: [0, 1] });
  });
});
