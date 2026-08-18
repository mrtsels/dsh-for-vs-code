/**
 * context.ts — 命令层共享的应用上下文(extension.ts 组装后注入)。
 */
import * as vscode from 'vscode';
import type { AgentController } from '../agent/controller.js';
import type { ConnectionWrapper } from '../api/connection-wrapper.js';
import type { SessionManager } from '../agent/session-manager.js';
import type { Logger } from '../util/logger.js';
import type { SnapshotWatcher } from '../vscode/workspace.js';
import type { ChangesPanel } from '../webview/changes-panel.js';
import type { ExtensionMessage } from '../webview/bridge.js';

export interface AppContext {
  logger: Logger;
  runtime: ConnectionWrapper;
  sessions: SessionManager;
  controller: AgentController;
  /** 主 UI 宿主(活动栏 WebviewView);open 聚焦侧边栏,post 推消息 */
  panel: {
    open: () => Promise<void>;
    post: (message: ExtensionMessage) => void;
    reload: (baseUrl: string) => void;
  };
  changesPanel: ChangesPanel;
  watcher: SnapshotWatcher;
  extensionUri: vscode.Uri;
  /** 当前活动会话(共享 holder,extension 与命令层同引用) */
  activeSessionId: { value?: string };
}

/** 确保已连接,返回 host 描述 */
export async function ensureConnected(ctx: AppContext): Promise<void> {
  await ctx.runtime.connect();
}

/** 确保存在活动会话(没有则创建),并铺底历史 */
export async function ensureSession(ctx: AppContext): Promise<string> {
  let sessionId = ctx.activeSessionId.value;
  if (!sessionId) {
    sessionId = await ctx.sessions.create();
    ctx.activeSessionId.value = sessionId;
  }
  ctx.controller.setActiveSession(sessionId);
  return sessionId;
}
