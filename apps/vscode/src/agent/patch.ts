/**
 * patch.ts — unified diff 解析器与按行应用(P2-5)。纯函数,零依赖。
 * 支持:增/删/改/上下文行;冲突(上下文不匹配)显式报错,不做猜测。
 */
export type PatchLineKind = 'context' | 'add' | 'delete';

export interface PatchLine {
  kind: PatchLineKind;
  text: string;
}

export interface PatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: PatchLine[];
}

export interface PatchFile {
  path: string;
  hunks: PatchHunk[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** 解析 unified diff 文本;解析失败抛 Error(不静默放行) */
export function parsePatch(text: string): PatchFile[] {
  const files: PatchFile[] = [];
  let current: PatchFile | undefined;
  let hunk: PatchHunk | undefined;

  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('--- a/')) {
      const path = line.slice(6);
      current = { path, hunks: [] };
      files.push(current);
      continue;
    }
    if (line.startsWith('+++ b/') || line === '---' || line === '+++') continue;
    if (line.startsWith('@@ ')) {
      const m = HUNK_RE.exec(line);
      if (!m) throw new Error(`无法解析 hunk 头:${line.slice(0, 60)}`);
      if (!current) throw new Error('hunk 出现在文件头之前');
      hunk = {
        oldStart: Number(m[1]),
        oldLines: m[2] === undefined ? 1 : Number(m[2]),
        newStart: Number(m[3]),
        newLines: m[4] === undefined ? 1 : Number(m[4]),
        lines: [],
      };
      current.hunks.push(hunk);
      continue;
    }
    if (current === undefined || hunk === undefined) continue; // 文件元数据/尾部
    if (line === '') continue; // 末尾空行是格式噪音,不是 context 行
    if (line.startsWith('\\')) continue; // "\ No newline at end of file"
    const kind: PatchLineKind = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'delete' : 'context';
    hunk.lines.push({ kind, text: kind === 'context' ? line.slice(1) : line.slice(1) });
  }
  return files;
}

export type ApplyResult = { ok: true; content: string } | { ok: false; reason: string };

/** 按 hunk 顺序应用补丁:先全部校验上下文,再统一替换(避免半应用) */
export function applyHunks(content: string, hunks: PatchHunk[]): ApplyResult {
  const lines = content.split('\n');
  // 第一遍:校验所有 hunk 的上下文/删除行与目标一致
  for (const hunk of hunks) {
    const start = hunk.oldStart - 1;
    let i = 0;
    for (const pl of hunk.lines) {
      if (pl.kind === 'add') continue;
      const target = lines[start + i];
      if (target !== pl.text) {
        return {
          ok: false,
          reason: `hunk @@ -${hunk.oldStart} 上下文不匹配:第 ${start + i + 1} 行期望 ${JSON.stringify(pl.text)},实际 ${JSON.stringify(target)}`,
        };
      }
      i += 1;
    }
  }
  // 第二遍:从后往前应用,offset 不互相影响
  const edits: { start: number; deleteCount: number; insert: string[] }[] = [];
  for (const hunk of hunks) {
    const oldContent = hunk.lines.filter((l) => l.kind !== 'add');
    const insert = hunk.lines.filter((l) => l.kind !== 'delete').map((l) => l.text);
    edits.push({ start: hunk.oldStart - 1, deleteCount: oldContent.length, insert });
  }
  for (const edit of edits.reverse()) {
    lines.splice(edit.start, edit.deleteCount, ...edit.insert);
  }
  return { ok: true, content: lines.join('\n') };
}
