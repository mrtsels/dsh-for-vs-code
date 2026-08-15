import { describe, expect, it } from 'vitest';
import { parseNumstat, parseStatusPorcelain } from '../src/agent/git-parse.js';

describe('parseStatusPorcelain', () => {
  it('普通增删改 + 未跟踪 + 重命名', () => {
    const entries = parseStatusPorcelain(' M src/a.ts\n?? new.txt\nR  old.ts -> new2.ts\n');
    expect(entries).toEqual([
      { path: 'src/a.ts', status: 'M' },
      { path: 'new.txt', status: '??' },
      { path: 'new2.ts', status: 'R' },
    ]);
  });

  it('空输出 → 空数组', () => {
    expect(parseStatusPorcelain('')).toEqual([]);
  });
});

describe('parseNumstat', () => {
  it('解析增删行数与 binary', () => {
    const entries = parseNumstat('3\t1\tsrc/a.ts\n-\t-\tsrc/b.bin\n');
    expect(entries).toEqual([
      { path: 'src/a.ts', additions: 3, deletions: 1 },
      { path: 'src/b.bin', additions: 0, deletions: 0 },
    ]);
  });
});
