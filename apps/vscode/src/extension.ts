/**
 * extension.ts — 应用组装:runtime / sessions / controller / panel / watcher / 状态栏。
 * Phase 1 MVP:连接 127.0.0.1:3080 的现有 dsh web 实例(不拉起实例),Chat webview 流式渲染。
 */
import * as vscode from 'vscode';
import { HarnessRuntime } from './agent/runtime.js';
import { SessionManager } from './agent/session-manager.js';
import { AgentController } from './agent/controller.js';
import { ChatPanel } from './webview/panel.js';
import { SnapshotWatcher } from './vscode/workspace.js';
import { Logger } from './util/logger.js';
import { DisposableSet, toVscodeDisposable } from './util/dispose.js';
import { registerAsk } from './commands/ask.js';
import { registerAgent } from './commands/agent.js';
import { registerReview } from './commands/review.js';
import type { AppContext } from './commands/context.js';
import type { ConnectionState, WebviewRequest } from './webview/bridge.js';
import type { SessionSummary } from './agent/wire.js';

export function activate(context: vscode.ExtensionContext): void {
  const disposables = new DisposableSet();
  const logger = new Logger('DeepSeek Harness');

  const baseUrl =
    vscode.workspace.getConfiguration('deepseekHarness').get<string>('baseUrl', 'http://127.0.0.1:3080');

  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusItem.show();
  disposables.add(statusItem);

  // panel 的 onRequest 经可变 handler 转发,解决 panel ↔ ctx 的构造顺序依赖
  let requestHandler: (request: WebviewRequest) => void = () => {};
  const panel = new ChatPanel({
    extensionUri: context.extensionUri,
    onRequest: (request) => requestHandler(request),
  });

  const runtime = new HarnessRuntime({ baseUrl });
  const sessions = new SessionManager(runtime, {
    onEvents: (sessionId, events) => panel.post({ type: 'event', sessionId, events }),
  });
  const controller = new AgentController(runtime, sessions, {
    onState: (state) => postState(panel, runtime, state),
  });

  const workspaceRoots = vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [];
  const watcher = new SnapshotWatcher(workspaceRoots);

  const ctx: AppContext = { logger, runtime, sessions, controller, panel, watcher };

  runtime.onMuxFrame = (frame) => {
    sessions.handleMuxFrame(frame);
    controller.handleMuxFrame(frame);
  };
  runtime.onHostFrame = (frame) => {
    if (frame.type === 'host/session-added' || frame.type === 'host/session-removed') {
      void refreshSessionList(ctx);
    }
  };
  runtime.onStatus = (status) => {
    if (status.state === 'connected') {
      const desc = runtime.description;
      statusItem.text = '$(broadcast) dsh: 已连接';
      if (desc) {
        const wsRoot = workspaceRoots[0];
        const cwdMismatch = wsRoot !== undefined && desc.cwd !== wsRoot;
        statusItem.tooltip = cwdMismatch
          ? `dsh 实例 cwd = ${desc.cwd}\n⚠ 与当前工作区(${wsRoot})不一致 — agent 操作的是实例 cwd`
          : `dsh ${desc.version} | ${desc.provider}/${desc.model} | cwd = ${desc.cwd}`;
        if (cwdMismatch) statusItem.text = '$(warning) dsh: cwd ≠ 工作区';
      }
      void refreshSessionList(ctx);
    } else if (status.state === 'reconnecting') {
      statusItem.text = `$(sync~spin) dsh: 重连中(#${status.attempt})`;
    } else {
      statusItem.text = '$(circle-slash) dsh: 未连接';
      statusItem.tooltip = status.error ?? '运行 dsh web 后自动连接';
    }
    postState(panel, runtime, controller.currentState);
  };

  requestHandler = (request) => void handleRequest(ctx, request);

  disposables.addFn(() => {
    runtime.dispose();
    watcher.dispose();
    logger.dispose();
    panel.dispose();
  });
  context.subscriptions.push(
    toVscodeDisposable(disposables),
    registerAsk(ctx),
    registerAgent(ctx),
    registerReview(ctx),
  );

  void runtime.connect().catch((error) => {
    logger.error(`runtime.connect failed: ${error instanceof Error ? error.message : String(error)}`);
  });
}

export function deactivate(): void {
  // 全部由 context.subscriptions 清理
}

async function handleRequest(ctx: AppContext, request: WebviewRequest): Promise<void> {
  try {
    switch (request.type) {
      case 'ready': {
        await ctx.runtime.connect();
        await refreshSessionList(ctx);
        if (ctx.activeSessionId) {
          await ctx.sessions.seedHistory(ctx.activeSessionId, 50);
        }
        break;
      }
      case 'ask': {
        const sessionId = ctx.activeSessionId ?? (await ctx.sessions.create());
        ctx.activeSessionId = sessionId;
        ctx.controller.setActiveSession(sessionId);
        await ctx.sessions.seedHistory(sessionId, 50);
        await ctx.controller.ask(sessionId, request.text);
        break;
      }
      case 'stop': {
        if (ctx.activeSessionId) await ctx.controller.stop(ctx.activeSessionId);
        break;
      }
      case 'session:list': {
        await refreshSessionList(ctx);
        break;
      }
      case 'session:open': {
        ctx.activeSessionId = request.sessionId;
        ctx.controller.setActiveSession(request.sessionId);
        await ctx.sessions.seedHistory(request.sessionId, 50);
        ctx.panel.post({
          type: 'event',
          sessionId: request.sessionId,
          events: ctx.sessions.snapshot(request.sessionId),
        });
        break;
      }
      case 'session:create': {
        const sessionId = await ctx.sessions.create();
        ctx.activeSessionId = sessionId;
        ctx.controller.setActiveSession(sessionId);
        await refreshSessionList(ctx);
        break;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.logger.error(`request ${request.type} failed: ${message}`);
    ctx.panel.post({ type: 'error', message });
  }
}

async function refreshSessionList(ctx: AppContext): Promise<void> {
  try {
    const items = await ctx.sessions.list();
    ctx.panel.post({ type: 'session:list', items: summarize(items) });
  } catch (error) {
    ctx.logger.debug(`session.list failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function summarize(items: SessionSummary[]): SessionSummary[] {
  return items.map((s) => ({
    sessionId: s.sessionId,
    updatedAt: s.updatedAt,
    running: s.running,
    blank: s.blank,
    cwd: s.cwd,
    agentPreset: s.agentPreset,
    projections: s.projections
      ? {
          asOfSeq: s.projections.asOfSeq,
          values: {
            title: s.projections.values?.title,
            sessionStats: s.projections.values?.sessionStats,
            tokenUsage: s.projections.values?.tokenUsage,
          },
        }
      : undefined,
  }));
}

function postState(panel: ChatPanel, runtime: HarnessRuntime, state: ConnectionState): void {
  const desc = runtime.description;
  panel.post({
    type: 'state',
    state,
    host: desc ? { cwd: desc.cwd, model: `${desc.provider}/${desc.model}` } : undefined,
  });
}
