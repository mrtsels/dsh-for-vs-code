/**
 * workspace.ts — 文件读取 / WorkspaceEdit 写入 / 快照 diff(方案 a,TASK §2.1 D2)。
 * 快照对比:监听工作区目录,记录 agent(在 dsh 实例内)改动前后的内容,供 diff 查看与一键回滚。
 */
import * as vscode from 'vscode';
import { watch, type FSWatcher } from 'node:fs';
import { resolve, relative } from 'node:path';
import { DisposableSet } from '../util/dispose.js';
import { diffLines } from '../util/diff.js';

export { diffLines } from '../util/diff.js';

export interface SnapshotChange {
  path: string;
  before: string;
  after: string;
  at: number;
}

/** 监听工作区根目录,捕获文件内容变更快照(排除 .git、node_modules 等) */
export class SnapshotWatcher {
  private readonly disposables = new DisposableSet();
  private readonly watchers: FSWatcher[] = [];
  private readonly snapshots = new Map<string, string>();
  private readonly changes = new Map<string, SnapshotChange>();
  private readonly debounce = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly roots: string[],
    private readonly onChanges?: (changes: SnapshotChange[]) => void,
  ) {
    for (const root of roots) {
      this.snapshots.set(root, '');
      try {
        const watcher = watch(root, { recursive: true }, (_event, filename) => {
          if (!filename) return;
          this.onFileEvent(root, String(filename));
        });
        this.watchers.push(watcher);
      } catch {
        // 目录不存在/权限不足:跳过该根(实例 cwd 可能在工作区外,靠 UI 警告兜底)
      }
    }
  }

  private onFileEvent(root: string, filename: string): void {
    const abs = resolve(root, filename);
    if (this.isIgnored(abs)) return;
    const key = abs;
    const old = this.snapshots.get(key);
    clearTimeout(this.debounce.get(key));
    this.debounce.set(
      key,
      setTimeout(() => {
        this.debounce.delete(key);
        void vscode.workspace.fs.readFile(vscode.Uri.file(abs)).then(
          (bytes) => {
            const after = Buffer.from(bytes).toString('utf8');
            const before = old ?? after; // 首次看到 = 基线,不产生 diff
            if (before !== after) {
              const change: SnapshotChange = { path: key, before, after, at: Date.now() };
              this.changes.set(key, change);
              this.onChanges?.([...this.changes.values()]);
            }
            this.snapshots.set(key, after);
          },
          () => {
            // 文件已删除:记录空内容
            const change: SnapshotChange = { path: key, before: old ?? '', after: '', at: Date.now() };
            this.changes.set(key, change);
            this.onChanges?.([...this.changes.values()]);
          },
        );
      }, 400),
    );
  }

  private isIgnored(abs: string): boolean {
    return /[\\/](node_modules|\.git|dist|\.serena|\.dsh)[\\/]/.test(abs);
  }

  listChanges(): SnapshotChange[] {
    return [...this.changes.values()].sort((a, b) => b.at - a.at);
  }

  /** 一键回滚:恢复 before 内容(走 WorkspaceEdit,可 undo) */
  async rollback(change: SnapshotChange): Promise<void> {
    const editor = await vscode.workspace.openTextDocument(vscode.Uri.file(change.path));
    const edit = new vscode.WorkspaceEdit();
    const full = new vscode.Range(0, 0, editor.lineCount, 0);
    edit.replace(editor.uri, full, change.before);
    await vscode.workspace.applyEdit(edit);
  }

  dispose(): void {
    for (const t of this.debounce.values()) clearTimeout(t);
    this.debounce.clear();
    for (const w of this.watchers) w.close();
    this.disposables.dispose();
  }
}

/** 相对路径展示(相对首个工作区根) */
export function displayPath(abs: string, roots: string[]): string {
  for (const root of roots) {
    const rel = relative(root, abs);
    if (!rel.startsWith('..') && rel !== '') return rel;
  }
  return abs;
}
