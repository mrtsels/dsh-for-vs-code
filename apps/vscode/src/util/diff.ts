/**
 * diff.ts — 按行 diff(增删行),输出 unified 风格文本。纯函数,零依赖。
 */
export function diffLines(before: string, after: string): string {
  const a = before.split('\n');
  const b = after.split('\n');
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
    } else if (a[i + 1] === b[j]) {
      out.push(`- ${a[i]}`);
      i += 1;
    } else if (a[i] === b[j + 1]) {
      out.push(`+ ${b[j]}`);
      j += 1;
    } else {
      out.push(`- ${a[i]}`);
      out.push(`+ ${b[j]}`);
      i += 1;
      j += 1;
    }
  }
  while (i < a.length) out.push(`- ${a[i++]} `);
  while (j < b.length) out.push(`+ ${b[j++]}`);
  return out.join('\n');
}
