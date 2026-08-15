/**
 * git-parse.ts — git 输出解析(P2-4)。纯函数,零依赖。
 */
export interface StatusEntry {
  path: string;
  status: string;
}

/** 解析 `git status --porcelain=v1` 输出 */
export function parseStatusPorcelain(text: string): StatusEntry[] {
  const out: StatusEntry[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    // "XY path" / "XY -> path" (renames)
    const status = line.slice(0, 2).trim() || line.charAt(0);
    const rest = line.slice(3);
    const arrow = rest.indexOf(' -> ');
    out.push({ path: arrow >= 0 ? rest.slice(arrow + 4) : rest, status });
  }
  return out;
}

export interface NumstatEntry {
  path: string;
  additions: number;
  deletions: number;
}

/** 解析 `git diff --numstat` 输出(binary 行是 "-\t-\tpath") */
export function parseNumstat(text: string): NumstatEntry[] {
  const out: NumstatEntry[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (!m) continue;
    if (m[1] === '-' || m[2] === '-') {
      out.push({ path: m[3] ?? '', additions: 0, deletions: 0 });
      continue;
    }
    out.push({ path: m[3] ?? '', additions: Number(m[1]), deletions: Number(m[2]) });
  }
  return out;
}
