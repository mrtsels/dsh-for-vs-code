/**
 * extension.ts — 应用组装:runtime / sessions / controller / 双面板 / watcher / 状态栏。
 * Phase 2:编辑器上下文注入、diagnostics 徽标、git 摘要、approval 原生审批、
 * Pseudoterminal 终端、改动审查面板(方案 a)。
 */
import * as vscode from 'vscode';
import { HarnessRuntime } from './agent/runtime.js';
import { SessionManager } from './agent/session-manager.js';
import { AgentController } from './agent/controller.js';
import { ChangesPanel, toChangeItems } from './webview/changes-panel.js';
import { ChatPanel } from './webview/chat-panel.js';
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
import { registerChatParticipant } from './commands/chat-participant.js';
import { registerCodeActions, registerNativeCommands } from './commands/native.js';
import type { AppContext } from './commands/context.js';
import type { WebviewRequest } from './webview/bridge.js';
import type { ExtensionMessage } from './webview/bridge.js';
import type { RuntimeState } from './agent/runtime.js';
import type { MuxFrame } from './agent/wire.js';

/** 主 UI 宿主:活动栏侧边栏视图(WebviewView 内嵌 dsh 原生 UI) */
interface ChatPanelHost {
  open: () => Promise<void>;
  post: (message: ExtensionMessage) => void;
  reload: (baseUrl: string) => void;
}

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
  // 主 UI = 编辑器 WebviewPanel(宽面板容纳 dsh 完整布局,范式对齐社区实践);
  // 活动栏 view 提供"打开"入口节点
  const chatPanelHost = new ChatPanel({
    extensionUri: context.extensionUri,
    getBaseUrl: () =>
      vscode.workspace.getConfiguration('deepseekHarness').get<string>('baseUrl', baseUrl),
  });
  const chatPanel: ChatPanelHost = {
    open: () => chatPanelHost.open(),
    post: (message) => chatPanelHost.post(message),
    reload: (url) => chatPanelHost.reload(url),
  };

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
    onMeta: (sessionId, meta) => {
      // P3-4/P3-7:jobs/goal 投影推送直转 UI(不改事件日志)
      if (meta.jobs) chatPanel.post({ type: 'meta:jobs', sessionId, jobs: meta.jobs });
      if (meta.projection) {
        if (meta.projection.key === 'goal') chatPanel.post({ type: 'meta:goals', sessionId, goal: sessions.goal(sessionId) });
      }
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

  /** P3-5:记住活跃会话(写 globalState;失败仅告警,不影响主流程) */
  const rememberActiveSession = async (ctx: vscode.ExtensionContext, sessionId: string): Promise<void> => {
    try {
      await ctx.globalState.update('dsh.lastActiveSession', sessionId);
    } catch (error) {
      logger.warn(`持久化活跃会话失败:${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /** P3-3:拉取子代理列表并推给 chat 面板(meta:subagents 请求与 interrupt 成功共用) */
  const refreshSubagents = async (sessionId: string): Promise<void> => {
    try {
      const entries = await sessions.listSubagents(sessionId);
      chatPanel.post({ type: 'meta:subagents', sessionId, entries });
    } catch (error) {
      chatPanel.post({ type: 'error', message: `子代理列表获取失败:${error instanceof Error ? error.message : String(error)}` });
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
        void rememberActiveSession(context, request.sessionId);
        await sessions.seedHistory(request.sessionId);
        break;
      case 'session:create': {
        const sessionId = await sessions.create();
        state.value = sessionId;
        void rememberActiveSession(context, sessionId);
        controller.setActiveSession(sessionId);
        await refreshSessionList();
        break;
      }
      case 'session:fork': {
        const childId = await sessions.fork(request.sessionId);
        state.value = childId;
        controller.setActiveSession(childId);
        void rememberActiveSession(context, childId);
        await sessions.seedHistory(childId);
        chatPanel.post({ type: 'session:forked', sessionId: childId });
        await refreshSessionList();
        break;
      }
      case 'meta:jobs':
        chatPanel.post({ type: 'meta:jobs', sessionId: request.sessionId, jobs: sessions.jobs(request.sessionId) });
        break;
      case 'meta:skills':
        try {
          const skills = await sessions.listSkills(request.sessionId);
          chatPanel.post({ type: 'meta:skills', sessionId: request.sessionId, skills });
        } catch (error) {
          chatPanel.post({ type: 'error', message: `技能列表获取失败:${error instanceof Error ? error.message : String(error)}` });
        }
        break;
      case 'meta:subagents':
        await refreshSubagents(request.sessionId);
        break;
      case 'meta:goals':
        chatPanel.post({ type: 'meta:goals', sessionId: request.sessionId, goal: sessions.goal(request.sessionId) });
        break;
      case 'goal:create':
        try {
          await sessions.goalCreate(request.sessionId, request.objective);
          await sessions.seedHistory(request.sessionId); // 投影基线刷新
          chatPanel.post({ type: 'meta:goals', sessionId: request.sessionId, goal: sessions.goal(request.sessionId) });
        } catch (error) {
          chatPanel.post({ type: 'error', message: `goal 创建失败:${error instanceof Error ? error.message : String(error)}` });
        }
        break;
      case 'goal:control':
        try {
          await sessions.goalControl(request.sessionId, request.ref, request.action);
          await sessions.seedHistory(request.sessionId);
          chatPanel.post({ type: 'meta:goals', sessionId: request.sessionId, goal: sessions.goal(request.sessionId) });
        } catch (error) {
          chatPanel.post({ type: 'error', message: `goal 操作失败:${error instanceof Error ? error.message : String(error)}` });
        }
        break;
      case 'subagent:interrupt':
        try {
          await sessions.interruptSubagent(request.parentSessionId, request.childSessionId);
          // P2-B:成功不进 error 通道(状态经 meta:subagents 刷新可见);失败才报错
          void refreshSubagents(request.parentSessionId);
        } catch (error) {
          chatPanel.post({ type: 'error', message: `打断失败:${error instanceof Error ? error.message : String(error)}` });
        }
        break;
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
    try {
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
        void rememberActiveSession(context, sessionId);
      }
      controller.setActiveSession(sessionId);
      await sessions.seedHistory(sessionId);
      await controller.ask(sessionId, finalText);
      await refreshSessionList();
    } catch (error) {
      // P1-3:ask 失败必须对 UI 可见(pendingAsk 依赖 error 消息解锁)
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`ask 失败:${message}`);
      chatPanel.post({ type: 'error', message: `提问失败:${message}` });
    }
  };

  // P2-5:approval 原生审批(approval/requested → 通知 → /api/respond)
  const handleApproval = async (
    frame: Extract<MuxFrame, { type: 'approval/requested' }>,
    rpcId?: string,
  ): Promise<void> => {
    try {
      if (!rpcId) {
        // 无 rpcId 无法回传:按协议无法应答,提示 UI 但不击穿(P1-4)
        logger.warn('approval 帧缺少 rpcId,无法应答');
        void vscode.window.showWarningMessage('DeepSeek Harness:收到无法应答的工具审批请求(缺 rpcId)');
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
    } catch (error) {
      // P1-4:respond 传输失败(断连/HTTP 错误)不击穿;尽力兜底重试一次 rejected
      logger.warn(`approval 流程异常:${error instanceof Error ? error.message : String(error)}`);
      if (rpcId) {
        try {
          await runtime.respond(rpcId, { sessionId: frame.sessionId, approvalId: frame.approvalId, outcome: 'rejected' });
        } catch {
          // 吞掉:实例已不可达,服务端会自行超时;不再次外抛
        }
      }
    }
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
  chatPanelHost.onRequest = handleRequest;
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
    extensionUri: context.extensionUri,
    activeSessionId: state,
  };
  disposables.add(registerAsk(app));
  disposables.add(registerAgent(app));
  disposables.add(registerReview(app));
  try {
    disposables.add(registerChatParticipant(app));
  } catch (error) {
    // 降级:chat API/声明缺失时 ChatParticipant 不可用,不影响主 UI(runtime/视图照常)
    logger.warn(`ChatParticipant 注册失败(降级):${error instanceof Error ? error.message : String(error)}`);
  }
  disposables.add(registerCodeActions(app));
  for (const d of registerNativeCommands(app)) disposables.add(d);
  disposables.add(statusItem);

  // 活动栏 view = WebviewViewProvider:点击图标直接在侧边栏渲染 dsh 原生 UI
  disposables.add(vscode.window.registerWebviewViewProvider(ChatPanel.viewType, chatPanelHost));

  // P3-10:连接切换命令(写入配置 + runtime.rebase)
  disposables.add(
    vscode.commands.registerCommand('deepseekHarness.setBaseUrl', async () => {
      const current = vscode.workspace.getConfiguration('deepseekHarness').get<string>('baseUrl', 'http://127.0.0.1:3080');
      const next = await vscode.window.showInputBox({
        value: current,
        prompt: 'dsh 实例地址(如 http://127.0.0.1:3080);任何实例都是第 N 个 viewer,扩展不另起 runtime',
        validateInput: (v) => (/^https?:\/\/[^/]+/.test(v) ? undefined : '需为 http(s)://host[:port] 形式'),
      });
      if (next === undefined || next === current) return;
      await vscode.workspace.getConfiguration('deepseekHarness').update('baseUrl', next.trim(), true);
      // rebase 由 onDidChangeConfiguration 统一处理(单一路径,防重复重连)
      cwdWarned = false;
      void vscode.window.showInformationMessage(`DeepSeek Harness:正在连接 ${next.trim()}…`);
    }),
  );

  // P3-5:会话持久化 — 记住上次活跃会话,重启后自动恢复(会话本体在实例侧,这里只存引用)
  // P1-A 修复:persist 键必须写入才有恢复可言(之前只有 get,是死代码)
  const lastSession = context.globalState.get<string>('dsh.lastActiveSession');
  if (lastSession) {
    state.value = lastSession;
    controller.setActiveSession(lastSession);
  }

  context.subscriptions.push({
    dispose: () => {
      controller.dispose();
      runtime.dispose();
      disposables.dispose();
    },
  });

  // 启动即连接(P1-3):失败自动重连,状态经 onStatus 可见
  void runtime.connect().then((description) => {
    logger.info(`已连接 ${baseUrl}(cwd=${description.cwd},model=${description.model})`);
    void refreshSessionList();
    void postState();
    if (lastSession) {
      // 恢复上次会话历史 + 推送列表
      void sessions.seedHistory(lastSession).then(() => chatPanel.post({ type: 'meta:goals', sessionId: lastSession, goal: sessions.goal(lastSession) }));
    }
  });

  // 记住活动会话(供下次启动恢复);配置变化统一在此 rebase(P3-10)
  disposables.add(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('deepseekHarness.baseUrl')) {
        const next = vscode.workspace.getConfiguration('deepseekHarness').get<string>('baseUrl', '');
        if (next !== '' && next !== runtime.currentBaseUrl) {
          runtime.rebase(next);
          cwdWarned = false;
        }
      }
    }),
  );

  logger.info(`DeepSeek Harness 已激活(baseUrl=${baseUrl},workspace=${workspaceRoot || '(无)'})`);
}

export function deactivate(): void {
  // 所有 disposer 已注册到 context.subscriptions,activate 幂等(空场景安全)
}
