/**
 * diff-lines.ts — 朴素行 diff(纯函数,无 vscode 依赖,可单测)。
 * 修改行同时标记 added+removed;纯增/删各标一侧(够用,不做 LCS)。
 */

export function diffLines(before: string, after: string): { added: number[]; removed: number[] } {
  const b = before === '' ? [] : before.split('\n');
  const a = after === '' ? [] : after.split('\n');
  const max = Math.max(b.length, a.length);
  const added: number[] = [];
  const removed: number[] = [];
  for (let i = 0; i < max; i++) {
    if (i >= b.length) added.push(i);
    else if (i >= a.length) removed.push(i);
    else if (b[i] !== a[i]) {
      added.push(i);
      removed.push(i);
    }
  }
  return { added, removed };
}
