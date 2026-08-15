/**
 * extension.ts — 应用组装:runtime / sessions / controller / 双面板 / watcher / 状态栏。
 * Phase 2:编辑器上下文注入、diagnostics 徽标、git 摘要、approval 原生审批、
 * Pseudoterminal 终端、改动审查面板(方案 a)。
 */
import * as vscode from 'vscode';
import { HarnessRuntime } from './agent/runtime.js';
import { SessionManager } from './agent/session-manager.js';
import { AgentController } from './agent/controller.js';
import { ChatPanel } from './webview/panel.js';
import { ChangesPanel, toChangeItems } from './webview/changes-panel.js';
import { SnapshotWatcher } from './vscode/workspace.js';
import { runCommandInTerminal } from './vscode/terminal.js';
import { collectEditorContext } from './vscode/editor.js';
import { collectDiagnostics, countWorkspaceDiagnostics } from './vscode/diagnostics.js';
import { gitChanges } from './vscode/git.js';
import { formatEditorContext, type EditorContext } from './agent/context.js';
import { Logger } from './util/logger.js';
import { DisposableSet } from './util/dispose.js';
import { registerAsk } from './commands/ask.js';
import { registerAgent } from './commands/agent.js';
import { registerReview } from './commands/review.js';
import type { AppContext } from './commands/context.js';
import type { ConnectionState, WebviewRequest } from './webview/bridge.js';
import type { RuntimeState } from './agent/runtime.js';
import type { MuxFrame, SessionSummary } from './agent/wire.js';

export function activate(context: vscode.ExtensionContext): void {
  const disposables = new DisposableSet();
  const logger = new Logger('DeepSeek Harness');
  const baseUrl = vscode.workspace
    .getConfiguration('deepseekHarness')
    .get<string>('baseUrl', 'http://127.0.0.1:3080');
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const state: { value?: string } = {};

  // ---- 面板与 watcher(先建,回调闭包后续接线) ----
  const changesPanel = new ChangesPanel({ extensionUri: context.extensionUri });
  const watcher = new SnapshotWatcher(
    vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [],
    (changes) => {
      changesPanel.post({ type: 'changes', items: toChangeItems(changes) });
    },
  );
  const chatPanel = new ChatPanel({ extensionUri: context.extensionUri });

  // ---- runtime / sessions / controller ----
  const runtime = new HarnessRuntime({
    baseUrl,
    onStatus: (status) => {
      updateStatusItem(status.state, status.error);
      postState();
      if (status.state === 'connected' && state.value) {
        // P1-5:重连成功 → 重取活动会话历史(UI 按 seq 去重,重复推送安全)
        void sessions.seedHistory(state.value);
      }
    },
  });
  const sessions = new SessionManager(runtime, {
    onEvents: (sessionId, events) => {
      chatPanel.post({ type: 'event', sessionId, events });
    },
  });
  const controller = new AgentController(runtime, sessions, {
    onState: () => postState(),
  });

  runtime.onMuxFrame = (frame, rpcId) => {
    sessions.handleMuxFrame(frame);
    controller.handleMuxFrame(frame);
    if (frame.type === 'approval/requested') {
      void handleApproval(frame, rpcId);
    }
  };
  runtime.onHostFrame = (frame) => {
    if (frame.type === 'host/session-added' || frame.type === 'host/session-removed') {
      void refreshSessionList();
    }
  };

  // ---- 状态栏 + cwd 一致性检测(P1-15) ----
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusItem.show();
  let cwdWarned = false;

  function updateStatusItem(state: RuntimeState, error?: string): void {
    if (state === 'connected') {
      const cwd = runtime.description?.cwd;
      const mismatch = workspaceRoot !== '' && cwd !== undefined && cwd !== workspaceRoot;
      statusItem.text = mismatch ? '$(warning) dsh: cwd ≠ 工作区' : '$(broadcast) dsh: 已连接';
      statusItem.tooltip = mismatch
        ? `实例 cwd = ${cwd}\n工作区 = ${workspaceRoot}\n(agent 操作的是实例 cwd)`
        : `实例 cwd = ${cwd}\n模型 = ${runtime.description?.model}`;
      if (mismatch && !cwdWarned) {
        cwdWarned = true;
        void vscode.window.showWarningMessage(
          `DeepSeek Harness:实例 cwd(${cwd})与当前工作区(${workspaceRoot})不一致,agent 读写的是实例 cwd 目录`,
        );
      }
    } else if (state === 'reconnecting' || state === 'connecting') {
      statusItem.text = '$(sync~spin) dsh: 连接中…';
      statusItem.tooltip = error ?? '';
    } else {
      statusItem.text = '$(circle-slash) dsh: 未连接';
      statusItem.tooltip = error ?? '';
    }
  }

  function postState(): void {
    chatPanel.post({
      type: 'state',
      state: controller.currentState,
      host: runtime.description
        ? { cwd: runtime.description.cwd, model: runtime.description.model }
        : undefined,
    });
    changesPanel.post({
      type: 'changes',
      items: toChangeItems(watcher.listChanges()),
    });
  }

  // ---- 面板消息路由 ----
  const handleRequest = async (request: WebviewRequest): Promise<void> => {
    switch (request.type) {
      case 'ready':
        postState();
        void refreshSessionList();
        void postDiagnostics();
        break;
      case 'ask':
        await askWithContext(request.text);
        break;
      case 'stop':
        if (state.value) await controller.stop(state.value);
        break;
      case 'session:list':
        await refreshSessionList();
        break;
      case 'session:open':
        state.value = request.sessionId;
        controller.setActiveSession(request.sessionId);
        await sessions.seedHistory(request.sessionId);
        break;
      case 'session:create': {
        const sessionId = await sessions.create();
        state.value = sessionId;
        controller.setActiveSession(sessionId);
        await refreshSessionList();
        break;
      }
      case 'terminal:run':
        runCommandInTerminal(request.command, workspaceRoot || undefined, (text) => {
          chatPanel.post({ type: 'terminal:output', text });
        });
        break;
      case 'changes:list':
        changesPanel.post({ type: 'changes', items: toChangeItems(watcher.listChanges()) });
        break;
      case 'changes:rollback': {
        const change = watcher.listChanges().find((c) => c.path === request.path);
        if (change) {
          await watcher.rollback(change);
          changesPanel.post({ type: 'changes', items: toChangeItems(watcher.listChanges()) });
        }
        break;
      }
      case 'changes:accept':
        watcher.accept(request.path);
        changesPanel.post({ type: 'changes', items: toChangeItems(watcher.listChanges()) });
        break;
    }
  };

  const askWithContext = async (question: string): Promise<void> => {
    // P2-1/P2-2:编辑器上下文 + 活动文件诊断 + (含 git 语义时)git 摘要 → 前缀注入
    const editorCtx = collectEditorContext(workspaceRoot);
    const activeFileDiag = collectDiagnostics(vscode.window.activeTextEditor?.document.uri);
    const gitMap = new Map<string, { additions: number; deletions: number }>();
    if (/git|status|diff|改动|未提交|commit|提交/i.test(question)) {
      const g = await gitChanges(workspaceRoot);
      for (const [path, v] of g.files) gitMap.set(path, { additions: v.additions, deletions: v.deletions });
      if (g.error) logger.warn(`git 摘要失败:${g.error}`);
    }
    const full: EditorContext = { ...editorCtx, diagnostics: activeFileDiag, gitChanges: gitMap };
    const block = formatEditorContext(full);
    const finalText = block === '' ? question : `${block}\n\n${question}`;
    await runtime.connect();
    let sessionId = state.value;
    if (!sessionId) {
      sessionId = await sessions.create();
      state.value = sessionId;
    }
    controller.setActiveSession(sessionId);
    await sessions.seedHistory(sessionId);
    await controller.ask(sessionId, finalText);
    await refreshSessionList();
  };

  // P2-5:approval 原生审批(approval/requested → 通知 → /api/respond)
  const handleApproval = async (
    frame: Extract<MuxFrame, { type: 'approval/requested' }>,
    rpcId?: string,
  ): Promise<void> => {
    if (!rpcId) {
      logger.warn('approval 帧缺少 rpcId,自动拒绝');
      return;
    }
    const choice = await vscode.window.showInformationMessage(
      `DeepSeek Harness:工具 "${frame.toolName}" 请求执行${frame.reason ? `(${frame.reason})` : ''}`,
      { modal: false },
      '允许一次',
      '拒绝',
    );
    const outcome = choice === '允许一次' ? 'allowed-once' : 'rejected';
    const result = await runtime.respond(rpcId, {
      sessionId: frame.sessionId,
      approvalId: frame.approvalId,
      outcome,
    });
    if (!result.ok) logger.warn(`approval 回应失败:${result.error.code}:${result.error.message}`);
  };

  const refreshSessionList = async (): Promise<void> => {
    try {
      const summaries = await sessions.list();
      chatPanel.post({ type: 'session:list', items: summaries });
    } catch (error) {
      // 列表失败对 UI 可见(P2-1):不静默保留旧列表
      logger.warn(`session.list 失败:${error instanceof Error ? error.message : String(error)}`);
      chatPanel.post({ type: 'error', message: `会话列表获取失败:${error instanceof Error ? error.message : String(error)}` });
    }
  };

  const postDiagnostics = async (): Promise<void> => {
    const { errors, warnings } = countWorkspaceDiagnostics();
    chatPanel.post({ type: 'diagnostics', errors, warnings });
  };

  // ---- 诊断变更 → UI 徽标(P2-3) ----
  disposables.add(
    vscode.languages.onDidChangeDiagnostics(() => {
      void postDiagnostics();
    }),
  );

  // ---- 接线(可变 handler 解决面板/runtime 构造顺序) ----
  chatPanel.onRequest = handleRequest;
  changesPanel.onRequest = handleRequest;

  // ---- 命令 ----
  const app: AppContext = {
    logger,
    runtime,
    sessions,
    controller,
    panel: chatPanel,
    changesPanel,
    watcher,
    activeSessionId: state,
  };
  disposables.add(registerAsk(app));
  disposables.add(registerAgent(app));
  disposables.add(registerReview(app));
  disposables.add(statusItem);

  context.subscriptions.push({
    dispose: () => {
      controller.dispose();
      disposables.dispose();
    },
  });

  // 启动即连接(P1-3):失败自动重连,状态经 onStatus 可见
  void runtime.connect().then((description) => {
    logger.info(`已连接 ${baseUrl}(cwd=${description.cwd},model=${description.model})`);
    void refreshSessionList();
    void postState();
  });

  logger.info(`DeepSeek Harness 已激活(baseUrl=${baseUrl},workspace=${workspaceRoot || '(无)'})`);
}

export function deactivate(): void {
  // 所有 disposer 已注册到 context.subscriptions,activate 幂等(空场景安全)
}
