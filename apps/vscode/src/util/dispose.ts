/**
 * dispose.ts — disposer 组合工具(注册即 effect,deactivate 全量清理,见 TASK §0.5.2)。
 */
import type * as vscode from 'vscode';

type DisposableLike = { dispose(): unknown };

export class DisposableSet {
  private readonly items: DisposableLike[] = [];

  /** 加入一个 { dispose } 对象(如 vscode 事件订阅、Timeout 等) */
  add<T extends DisposableLike>(item: T): T {
    this.items.push(item);
    return item;
  }

  /** 便利:包装任意回调为 disposer */
  addFn(fn: () => void): void {
    this.items.push({ dispose: fn });
  }

  dispose(): void {
    for (const item of this.items.splice(0)) {
      try {
        item.dispose();
      } catch {
        // 单个 disposer 失败不阻断整体清理
      }
    }
  }
}

export function toVscodeDisposable(set: DisposableSet): vscode.Disposable {
  return { dispose: () => set.dispose() };
}
