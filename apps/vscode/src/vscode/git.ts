/**
 * git.ts — 仓库状态 + 工作区 diff 摘要(P2-4)。
 * 优先 Git Extension API;不可用时降级 `git` CLI(只读命令,child_process 仅此用途)。
 */
import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { parseNumstat, parseStatusPorcelain } from '../agent/git-parse.js';

export interface GitChanges {
  files: Map<string, { status: string; additions: number; deletions: number }>;
  error?: string;
}

/** 收集工作区 git 变更;非 git 仓库返回空 Map */
export async function gitChanges(workspaceRoot: string): Promise<GitChanges> {
  const files = new Map<string, { status: string; additions: number; deletions: number }>();
  try {
    const statusText = await git(['status', '--porcelain=v1'], workspaceRoot);
    for (const e of parseStatusPorcelain(statusText)) {
      files.set(e.path, { status: e.status, additions: 0, deletions: 0 });
    }
    const numstatText = await git(['diff', '--numstat'], workspaceRoot);
    for (const e of parseNumstat(numstatText)) {
      const cur = files.get(e.path);
      if (cur) {
        cur.additions = e.additions;
        cur.deletions = e.deletions;
      } else {
        files.set(e.path, { status: '??', additions: e.additions, deletions: e.deletions });
      }
    }
    return { files };
  } catch (error) {
    return { files, error: error instanceof Error ? error.message : String(error) };
  }
}

function git(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['--no-pager', ...args], { cwd, timeout: 10_000 }, (err, stdout) => {
      if (err) reject(new Error(`git ${args.join(' ')} 失败:${err.message}`));
      else resolve(stdout);
    });
  });
}
