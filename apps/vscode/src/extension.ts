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
import { readAgentPresetRoster, registerSettingsBridge } from './settings-bridge.js';
import { ensureFolderSession } from './sessions/bootstrap.js';
import { postRpc } from './rpc.js';
import { SnapshotWatcher } from './vscode/workspace.js';
import { WorkspaceChangeDecorationProvider } from './vscode/workspace-decoration.js';
import { HttpProxy } from './vscode/proxy.js';
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
  // P1-1:编辑器内改动装饰(112GT 模式);watcher 变化/回滚/接受后刷新激活编辑器
  let changeDecorations: WorkspaceChangeDecorationProvider;
  let refreshDecorations: () => void;
  const watcher = new SnapshotWatcher(
    vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [],
    (changes) => {
      changesPanel.post({ type: 'changes', items: toChangeItems(changes) });
      refreshDecorations();
    },
  );
  changeDecorations = new WorkspaceChangeDecorationProvider(() => watcher.listChanges());
  refreshDecorations = (): void => changeDecorations.refreshActive();
  disposables.add(changeDecorations);
  // Origin 栅栏代理:webview 直连 3080 会 403(信任栅栏要求同源),扩展进程内
  // 起 HTTP+WS 转发代理(127.0.0.1 随机端口),webview 的 runtime 连代理。
  const proxy = new HttpProxy(
    vscode.workspace.getConfiguration('deepseekHarness').get<string>('baseUrl', baseUrl),
  );
  void proxy.start().catch((error: unknown) => {
    logger.warn(`代理启动失败:${error instanceof Error ? error.message : String(error)}`);
  });
  disposables.add({ dispose: () => void proxy.stop() });
  // 主 UI = 编辑器 WebviewPanel(宽面板容纳 dsh 完整布局,范式对齐社区实践);
  // 活动栏 view 提供"打开"入口节点
  const chatPanelHost = new ChatPanel({
    extensionUri: context.extensionUri,
    getBaseUrl: () =>
      vscode.workspace.getConfiguration('deepseekHarness').get<string>('baseUrl', baseUrl),
    getProxyBase: () => proxy.baseUrl,
    // 首开会话(Phase 9):globalState 持久化的 cwd 会话;webview 装配时注入 __DSH_BOOT_SESSION__
    getBootSession: () => {
      const id = context.globalState.get<string>('dsh.initialSessionId');
      return id === undefined ? undefined : { sessionId: id };
    },
  });
  // 设置桥(Phase 9):theme/locale/permission/agentPreset/busyEnter 双向同步;
  // 语言写回成功后重载 webview(上游 locale 仅 boot 时应用)
  for (const d of registerSettingsBridge(
    () => vscode.workspace.getConfiguration('deepseekHarness').get<string>('baseUrl', baseUrl),
    () => controller.currentState === 'running',
    () => chatPanelHost.isVisible(),
    () => chatPanelHost.reload(vscode.workspace.getConfiguration('deepseekHarness').get<string>('baseUrl', baseUrl)),
  )) {
    context.subscriptions.push(d);
  }
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
  let failureNotified = false;

  function updateStatusItem(state: RuntimeState, error?: string): void {
    if (state === 'connected') {
      failureNotified = false; // 连接恢复后允许再次通知失败
      const cwd = runtime.description?.cwd;
      const mismatch = workspaceRoot !== '' && cwd !== undefined && cwd !== workspaceRoot;
      statusItem.text = mismatch ? '$(warning) dsh: cwd ≠ 工作区' : '$(broadcast) dsh: 已连接';
      statusItem.tooltip = mismatch
        ? `实例 cwd = ${cwd}\n工作区 = ${workspaceRoot}\n(agent 操作的是实例 cwd)\n点击重连`
        : `dsh ${runtime.description?.version ?? ''}\nprovider=${runtime.description?.provider ?? ''}\n模型=${runtime.description?.model ?? ''}\ncwd=${cwd}\n点击重连`;
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
      statusItem.tooltip = (error ? `${error}\n` : '') + '点击重试连接';
      // P0-1:连接失败对 UI 可见(一次性通知,防打扰;重试入口=状态栏点击/命令)
      if (error && !failureNotified) {
        failureNotified = true;
        void vscode.window.showWarningMessage(`DeepSeek Harness:无法连接实例\n${error}\n(点击状态栏或运行命令重试)`);
      }
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
        // Phase 9:webview 装配早于首开 bootstrap 完成时补发(桥写 localStorage + 重载)
        {
          const bootId = context.globalState.get<string>('dsh.initialSessionId');
          if (bootId !== undefined && !chatPanelHost.hasBootSessionInjected) {
            chatPanel.post({ type: 'dsh:bootstrap-session', sessionId: bootId });
          }
        }
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
    // 注册失败必须对用户可见(Chat 是核心入口),不静默降级
    const message = `ChatParticipant 注册失败:${error instanceof Error ? error.message : String(error)}`;
    logger.warn(message);
    void vscode.window.showWarningMessage(`DeepSeek Harness:${message}`);
  }
  disposables.add(registerCodeActions(app));
  for (const d of registerNativeCommands(app)) disposables.add(d);
  disposables.add(statusItem);

  // 活动栏 view = WebviewViewProvider:点击图标直接在侧边栏渲染 dsh 原生 UI
  disposables.add(vscode.window.registerWebviewViewProvider(ChatPanel.viewType, chatPanelHost));

  // P0-1:重试连接命令(状态栏点击同入口);状态栏 command 绑定
  const retryConnection = (): void => {
    void runtime.connect().then(() => {
      void vscode.window.showInformationMessage('DeepSeek Harness:已连接');
    });
  };
  disposables.add(vscode.commands.registerCommand('deepseekHarness.retryConnection', retryConnection));
  statusItem.command = 'deepseekHarness.retryConnection';
  // P0-3 + Phase 9:切换工作区文件夹 → 确保该文件夹有会话(新建时自动进入),
  // 并重估 cwd 一致性。有现存会话的文件夹不干预(恢复上次会话语义)。
  disposables.add(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (wsPath) {
        void bootstrapFolder(wsPath, { forceMessage: true });
      }
      cwdWarned = false;
      updateStatusItem(runtime.currentState, runtime.lastError);
    }),
  );
  // 新建会话(Phase 9):复用/新建当前工作区的空白会话,自动进入;
  // 无工作区时回退实例默认 cwd
  disposables.add(
    vscode.commands.registerCommand('deepseekHarness.newSession', async () => {
      const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const current = vscode.workspace.getConfiguration('deepseekHarness').get<string>('baseUrl', baseUrl);
      try {
        const sessionId = wsPath
          ? await ensureFolderSession(current, wsPath)
          : await createSessionAtDefaultCwd(current);
        if (sessionId === undefined) throw new Error('新建会话:实例未就绪或路径无效');
        await context.globalState.update('dsh.initialSessionId', sessionId);
        chatPanel.post({ type: 'dsh:switch-session', sessionId });
      } catch (error) {
        void vscode.window.showErrorMessage(
          `新建会话失败:${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
  );
  // Phase 9 首开:确保当前工作区有会话(复用空白或新建),存入 globalState;
  // 实例未就绪时静默(webview ready 时再补发一次)
  const bootstrapFolder = async (folder: string, opts?: { forceMessage?: boolean }): Promise<void> => {
    const current = vscode.workspace.getConfiguration('deepseekHarness').get<string>('baseUrl', baseUrl);
    try {
      const sessionId = await ensureFolderSession(current, folder);
      if (sessionId === undefined) return;
      await context.globalState.update('dsh.initialSessionId', sessionId);
      if (opts?.forceMessage === true && !chatPanelHost.hasBootSessionInjected) {
        chatPanel.post({ type: 'dsh:bootstrap-session', sessionId });
      }
    } catch (error) {
      // 实例未就绪/路径无效:静默,由 ready 或下次文件夹切换重试
      logger.warn(`首开会话 bootstrap 失败:${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (wsPath) {
    void bootstrapFolder(wsPath);
  }
  // 无工作区时:session.create 空负载 → 实例默认 cwd
  const createSessionAtDefaultCwd = async (current: string): Promise<string | undefined> => {
    const body = await postRpc(current, 'session.create', {});
    const sessionId = (body?.result?.value as { sessionId?: string } | undefined)?.sessionId;
    return typeof sessionId === 'string' ? sessionId : undefined;
  };

  // P1-3:模型查看/选择 QuickPick(模型由 dsh 实例 provider 配置决定,扩展只读展示+指引)
  disposables.add(
    vscode.commands.registerCommand('deepseekHarness.selectModel', async () => {
      const current = vscode.workspace.getConfiguration('deepseekHarness').get<string>('baseUrl', baseUrl);
      try {
        const desc = await runtime.connect();
        const body = await postRpc(current, 'settings.describe', {});
        const nss = (body?.result?.value as { namespaces?: Array<{ ns: string; value?: { models?: Array<{ id: string; name?: string }> } }> } | undefined)?.namespaces ?? [];
        const models = nss.find((n) => n.ns === 'llm-deepseek')?.value?.models ?? [];
        const currentModel = desc.model;
        const pick = await vscode.window.showQuickPick(
          [
            ...models.map((m) => ({
              label: m.name ?? m.id,
              description: m.id,
              detail: m.id === currentModel ? '当前模型' : undefined,
              id: m.id,
            })),
            {
              label: '$(gear) 在 dsh web UI 中配置模型…',
              description: '打开 http://127.0.0.1:3080 设置页',
              id: 'open-web',
            },
          ],
          { placeHolder: `当前模型:${currentModel}(provider:${desc.provider})` },
        );
        if (!pick) return;
        if (pick.id === 'open-web') {
          void vscode.env.openExternal(vscode.Uri.parse(current));
        } else {
          // 模型切换属 dsh 实例 provider 配置域;扩展不直接改 provider 配置(避免破坏实例)
          void vscode.window.showInformationMessage(
            `模型由 dsh 实例的 provider 配置决定(当前:${currentModel})。切换请在 dsh web UI 设置页操作。`,
          );
        }
      } catch (error) {
        void vscode.window.showErrorMessage(
          `读取模型列表失败:${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
  );

  // Phase 9:Agent preset 选择(名册驱动 QuickPick → 写 VS Code 设置,设置桥写回实例)
  disposables.add(
    vscode.commands.registerCommand('deepseekHarness.selectAgentPreset', async () => {
      const current = vscode.workspace.getConfiguration('deepseekHarness').get<string>('baseUrl', baseUrl);
      try {
        const roster = await readAgentPresetRoster(current);
        if (roster === undefined) throw new Error('实例未就绪');
        const currentVal = vscode.workspace.getConfiguration('deepseekHarness').get<string>('agentPreset', '');
        const pick = await vscode.window.showQuickPick(
          ['', ...roster].map((id) => ({
            label: id === '' ? '跟随实例默认(不写回)' : id,
            description: id === currentVal ? '当前' : undefined,
            id,
          })),
          { placeHolder: '选择新建会话的默认 agent preset' },
        );
        if (pick === undefined) return;
        await vscode.workspace.getConfiguration('deepseekHarness').update('agentPreset', pick.id, true);
      } catch (error) {
        void vscode.window.showErrorMessage(
          `读取 agent preset 失败:${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
  );

  // P2-1:验证连接命令(手动触发,输出 cwd/模型/版本一致性)
  disposables.add(
    vscode.commands.registerCommand('deepseekHarness.verifyConnection', async () => {
      try {
        const desc = await runtime.connect();
        const cwdNote =
          workspaceRoot !== '' && desc.cwd !== workspaceRoot
            ? `\n⚠ 实例 cwd(${desc.cwd}) ≠ 工作区(${workspaceRoot})`
            : '';
        void vscode.window.showInformationMessage(
          `✅ 已连接 dsh ${desc.version}\nprovider=${desc.provider}\n模型=${desc.model}\ncwd=${desc.cwd}${cwdNote}`,
        );
      } catch (error) {
        void vscode.window.showErrorMessage(
          `连接失败:${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
  );

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
          proxy.setTarget(next); // 代理端口不变,重定向转发目标(webview 无需重载)
          cwdWarned = false;
        }
      }
    }),
  );

  // 自动化冒烟钩子:DSH_SMOKE_OPEN=1 时激活后自动打开聊天面板(视觉冒烟/CI 用)
  if (process.env.DSH_SMOKE_OPEN === '1') {
    setTimeout(() => {
      void vscode.commands.executeCommand('deepseekHarness.open');
    }, 1500);
  }

  logger.info(`DeepSeek Harness 已激活(baseUrl=${baseUrl},workspace=${workspaceRoot || '(无)'})`);
}

export function deactivate(): void {
  // 所有 disposer 已注册到 context.subscriptions,activate 幂等(空场景安全)
}
