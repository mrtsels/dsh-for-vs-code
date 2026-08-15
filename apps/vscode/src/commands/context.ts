/**
 * context.ts — 命令层共享的应用上下文(extension.ts 组装后注入)。
 */
import * as vscode from 'vscode';
import type { AgentController } from '../agent/controller.js';
import type { HarnessRuntime } from '../agent/runtime.js';
import type { SessionManager } from '../agent/session-manager.js';
import type { Logger } from '../util/logger.js';
import type { SnapshotWatcher } from '../vscode/workspace.js';
import type { ChatPanel } from '../webview/panel.js';
import type { ChangesPanel } from '../webview/changes-panel.js';

export interface AppContext {
  logger: Logger;
  runtime: HarnessRuntime;
  sessions: SessionManager;
  controller: AgentController;
  panel: ChatPanel;
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
