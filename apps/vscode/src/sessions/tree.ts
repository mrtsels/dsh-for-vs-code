/**
 * sessions-tree.ts — 原生侧边栏会话列表(会话切换在 VS Code 原生层,webview 只渲染会话区)。
 *
 * 数据源:3080 session.list;点击会话 → postMessage 通知 webview 切换
 * (上游 attachPersistence 契约:boot 桥写 localStorage dsh.sessions.current + 扩展重注入 html)。
 */

import * as vscode from 'vscode';
import { listSessions, type SessionItem } from '../rpc.js';

/** 会话树节点:label=标题(无标题显示"新会话"),description=cwd/时间,icon=running */
export class SessionNode {
  constructor(
    readonly sessionId: string,
    readonly label: string,
    readonly description: string,
    readonly running: boolean,
    readonly item: SessionItem,
  ) {}
}

export class SessionsTreeProvider implements vscode.TreeDataProvider<SessionNode> {
  private readonly onDidChange = new vscode.EventEmitter<SessionNode | undefined>();
  readonly onDidChangeTreeData = this.onDidChange.event;

  private sessions: SessionNode[] = [];
  private refreshTimer: NodeJS.Timeout | undefined;

  constructor(private readonly getBaseUrl: () => string) {}

  /** 立即拉取并刷新列表;失败时保留旧列表并抛给调用方(命令面板可见) */
  async refresh(): Promise<void> {
    const items = await listSessions(this.getBaseUrl());
    this.sessions = items.map((item) => {
      const title = item.projections?.values?.title;
      const turns = item.projections?.values?.sessionStats?.turns ?? 0;
      const when = new Date(item.updatedAt).toLocaleString();
      const label = title && title.length > 0 ? title : item.blank ? '新会话' : `会话 ${turns} 轮`;
      return new SessionNode(item.sessionId, label, `${item.cwd} · ${when}`, item.running, item);
    });
    this.onDidChange.fire(undefined);
  }

  getTreeItem(node: SessionNode): vscode.TreeItem {
    const treeItem = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
    treeItem.description = node.description;
    treeItem.tooltip = node.item.cwd;
    treeItem.iconPath = node.running
      ? new vscode.ThemeIcon('sync~spin')
      : new vscode.ThemeIcon('comment-discussion');
    treeItem.command = {
      command: 'deepseekHarness.switchSession',
      title: '切换会话',
      arguments: [node.sessionId],
    };
    return treeItem;
  }

  getChildren(): SessionNode[] {
    return this.sessions;
  }

  /** 周期性刷新(5s),running 状态与新增会话保持可见;dispose 时停止 */
  startAutoRefresh(): vscode.Disposable {
    this.refreshTimer = setInterval(() => {
      void this.refresh().catch(() => undefined);
    }, 5000);
    return { dispose: () => clearInterval(this.refreshTimer) };
  }
}
