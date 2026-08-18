/**
 * bridge.ts — webview ↔ extension host 消息协议(类型化 union + 入参白名单结构校验)。
 * 纯模块,零 vscode 依赖,webview 与 extension host 共用。
 * 校验失败显式抛错,绝不静默放行未知载荷(TASK §0.5、P1-7)。
 */
import type { GoalView, JobView, SessionEvent, SessionSummary, SkillEntry, SubagentEntry } from '../agent/wire.js';

/** webview → extension */
export type WebviewRequest =
  | { type: 'ready' }
  | { type: 'ask'; text: string }
  | { type: 'stop' }
  | { type: 'session:list' }
  | { type: 'session:open'; sessionId: string }
  | { type: 'session:create' }
  | { type: 'session:fork'; sessionId: string }
  | { type: 'terminal:run'; command: string }
  | { type: 'changes:list' }
  | { type: 'changes:rollback'; path: string }
  | { type: 'changes:accept'; path: string }
  | { type: 'meta:jobs'; sessionId: string }
  | { type: 'meta:skills'; sessionId: string }
  | { type: 'meta:subagents'; sessionId: string }
  | { type: 'meta:goals'; sessionId: string }
  | { type: 'goal:create'; sessionId: string; objective: string }
  | { type: 'goal:control'; sessionId: string; ref: { id: string; revision: number }; action: 'pause' | 'resume' | 'complete' | 'clear' }
  | { type: 'subagent:interrupt'; parentSessionId: string; childSessionId: string }
  // 会话切换已应用:boot 桥已写 localStorage,扩展应重新注入 webview.html 完成重载
  | { type: 'switch-session:applied'; sessionId: string }
  // webview 内"新会话"按钮被拦截 → 扩展用 VS Code 当前目录创建/复用会话(boot 桥写 localStorage)
  | { type: 'dsh:new-session' }
  // webview 布局/语言自动诊断(扩展写入 .dsh-webview-diag.json 供排查)
  | { type: 'dsh:diag'; payload: Record<string, unknown> }
  // UI 语言与 VS Code 设置不符(boot 初始读取失败/推送丢失)→ 请扩展重载 webview
  | { type: 'dsh:locale-mismatch' }
  // 上游 accept/adopt 注入日志转发(诊断)
  | { type: 'dsh:console'; kind: string; text: string }
  // ---- Phase 10 附着(文件/选区)----
  // webview 附着 UI 就绪(扩展推送 dsh:attachments:state)
  | { type: 'dsh:attachments:ready' }
  // Explorer/OS 拖入文件(webview 只传 URI,内容由扩展侧读取)
  | { type: 'dsh:attachments:add'; attachments: readonly { uri: string }[] }
  // 移除附着文件 chip
  | { type: 'dsh:attachments:remove'; attachmentId: string }
  // 附着开关(活动文件 / 活动选区)
  | { type: 'dsh:attachments:toggle'; kind: AttachmentToggleKind; enabled: boolean }
  // 内部调试通道:webview 内 error/unhandledrejection 转发(不入 validateWebviewRequest 白名单,
  // 仅 ChatViewProvider 内部消费,不发给业务 handler)
  | { type: 'debug'; kind: 'error' | 'rejection'; message: string };

/** 连接/运行状态(与 AgentController 状态机对齐) */
export type ConnectionState = 'idle' | 'running' | 'error' | 'disconnected';

/** extension → webview */
export type ExtensionMessage =
  | { type: 'event'; sessionId: string; events: SessionEvent[] }
  | { type: 'session:list'; items: SessionSummary[] }
  | { type: 'session:forked'; sessionId: string }
  | { type: 'state'; state: ConnectionState; host?: { cwd: string; model: string } }
  | { type: 'error'; message: string }
  | { type: 'terminal:output'; text: string }
  | { type: 'diagnostics'; errors: number; warnings: number }
  | { type: 'changes'; items: ChangeItem[] }
  | { type: 'meta:jobs'; sessionId: string; jobs: JobView[] }
  | { type: 'meta:skills'; sessionId: string; skills: SkillEntry[] }
  | { type: 'meta:subagents'; sessionId: string; entries: SubagentEntry[] }
  | { type: 'meta:goals'; sessionId: string; goal: GoalView | undefined }
  // 原生会话切换:扩展 → webview(boot 桥监听并写 dsh.sessions.current + reload)
  | { type: 'dsh:switch-session'; sessionId: string }
  // 首开/文件夹切换 bootstrap(Phase 9):与 switch-session 同路径,但语义为"新建会话接管"
  | { type: 'dsh:bootstrap-session'; sessionId: string }
  // Phase 10 附着状态推送(开关/可用性/活动编辑器/选区/附着文件)
  | { type: 'dsh:attachments:state'; state: AttachmentState }
  // Phase 10 附着错误(拖入/读取失败;webview 展示 toast)
  | { type: 'dsh:attachments:error'; code: 'invalid-uri' | 'directory' | 'unreadable' | 'too-large' | 'unsupported'; message: string; attachmentId?: string };

/** 改动条目(方案 a 快照 diff,供审批面板) */
export interface ChangeItem {
  path: string;
  diff: string;
  at: number;
}

// ---- Phase 10 附着类型 ----

/** 附着开关种类:活动文件 / 活动选区 */
export type AttachmentToggleKind = 'activeFile' | 'selection';

/** 附着文件引用(webview 只持有 URI;内容由扩展侧发送时读取) */
export interface AttachmentRef {
  id: string;
  uri: string;
  name: string;
  size?: number;
  languageId?: string;
  /** 展示路径(工作区内相对路径,工作区外绝对路径) */
  displayPath: string;
  /** 工作区外文件(模型可见性提示) */
  outsideWorkspace: boolean;
}

/** 活动编辑器选区摘要(1-based,不含文本;文本仅发送瞬间快照) */
export interface SelectionSummary {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  charCount: number;
}

/** 附着状态(扩展 → webview 推送) */
export interface AttachmentState {
  activeFileEnabled: boolean;
  selectionEnabled: boolean;
  activeFileAvailable: boolean;
  selectionAvailable: boolean;
  activeFile?: {
    path: string;
    /** 绝对路径(插件 fs.resolve 以进程 cwd 为基准,相对路径解析不可靠 —— 建议附着必须传绝对路径) */
    fsPath: string;
    languageId: string;
    isDirty: boolean;
    isUntitled: boolean;
  };
  selections: readonly SelectionSummary[];
  attachments: readonly AttachmentRef[];
  /** dsh-file-attach 插件身份(wire inventory 解析;null = 插件未定义/未运行)。
   *  webview 侧据此驱动插件 client half 激活并委托「建议附着」。 */
  cordis?: { agentId: string; pluginId: string; packageId: string } | null;
}

/** 白名单结构校验:返回归一化后的请求;非法输入抛错 */
export function validateWebviewRequest(raw: unknown): WebviewRequest {
  if (typeof raw !== 'object' || raw === null) throw new Error('bridge: message is not an object');
  const msg = raw as Record<string, unknown>;
  switch (msg.type) {
    case 'ready':
      return { type: 'ready' };
    case 'ask':
      if (typeof msg.text !== 'string' || msg.text.length === 0 || msg.text.length > 100_000) {
        throw new Error('bridge: ask.text must be a non-empty string <= 100k chars');
      }
      return { type: 'ask', text: msg.text };
    case 'stop':
      return { type: 'stop' };
    case 'session:list':
      return { type: 'session:list' };
    case 'session:open':
      if (typeof msg.sessionId !== 'string' || !msg.sessionId.startsWith('session-')) {
        throw new Error('bridge: session:open.sessionId must be a session id');
      }
      return { type: 'session:open', sessionId: msg.sessionId };
    case 'session:create':
      return { type: 'session:create' };
    case 'terminal:run':
      if (typeof msg.command !== 'string' || msg.command.trim().length === 0 || msg.command.length > 2_000) {
        throw new Error('bridge: terminal:run.command must be a non-empty string <= 2k chars');
      }
      return { type: 'terminal:run', command: msg.command };
    case 'changes:list':
      return { type: 'changes:list' };
    case 'changes:rollback':
      if (typeof msg.path !== 'string' || msg.path.length === 0 || msg.path.length > 1_000) {
        throw new Error('bridge: changes:rollback.path must be a string');
      }
      return { type: 'changes:rollback', path: msg.path };
    case 'changes:accept':
      if (typeof msg.path !== 'string' || msg.path.length === 0 || msg.path.length > 1_000) {
        throw new Error('bridge: changes:accept.path must be a string');
      }
      return { type: 'changes:accept', path: msg.path };
    case 'session:fork':
      if (typeof msg.sessionId !== 'string' || !msg.sessionId.startsWith('session-')) {
        throw new Error('bridge: session:fork.sessionId must be a session id');
      }
      return { type: 'session:fork', sessionId: msg.sessionId };
    case 'meta:jobs':
    case 'meta:skills':
    case 'meta:subagents':
    case 'meta:goals':
      if (typeof msg.sessionId !== 'string' || !msg.sessionId.startsWith('session-')) {
        throw new Error(`bridge: ${msg.type}.sessionId must be a session id`);
      }
      return { type: msg.type, sessionId: msg.sessionId };
    case 'goal:create':
      if (typeof msg.sessionId !== 'string' || !msg.sessionId.startsWith('session-')) {
        throw new Error('bridge: goal:create.sessionId must be a session id');
      }
      if (typeof msg.objective !== 'string' || msg.objective.trim().length === 0 || msg.objective.length > 5_000) {
        throw new Error('bridge: goal:create.objective must be a non-empty string <= 5k chars');
      }
      return { type: 'goal:create', sessionId: msg.sessionId, objective: msg.objective };
    case 'goal:control': {
      if (typeof msg.sessionId !== 'string' || !msg.sessionId.startsWith('session-')) {
        throw new Error('bridge: goal:control.sessionId must be a session id');
      }
      const ref = msg.ref as Record<string, unknown> | undefined;
      if (
        typeof ref !== 'object' || ref === null ||
        typeof ref.id !== 'string' || typeof ref.revision !== 'number'
      ) {
        throw new Error('bridge: goal:control.ref must be {id, revision}');
      }
      const action = msg.action;
      if (action !== 'pause' && action !== 'resume' && action !== 'complete' && action !== 'clear') {
        throw new Error('bridge: goal:control.action invalid');
      }
      return { type: 'goal:control', sessionId: msg.sessionId, ref: { id: ref.id, revision: ref.revision }, action };
    }
    case 'subagent:interrupt':
      if (typeof msg.parentSessionId !== 'string' || !msg.parentSessionId.startsWith('session-')) {
        throw new Error('bridge: subagent:interrupt.parentSessionId must be a session id');
      }
      if (typeof msg.childSessionId !== 'string' || !msg.childSessionId.startsWith('session-')) {
        throw new Error('bridge: subagent:interrupt.childSessionId must be a session id');
      }
      return { type: 'subagent:interrupt', parentSessionId: msg.parentSessionId, childSessionId: msg.childSessionId };
    // ---- Phase 10 附着 ----
    case 'dsh:attachments:ready':
      return { type: 'dsh:attachments:ready' };
    case 'dsh:attachments:add': {
      const atts = msg.attachments;
      if (!Array.isArray(atts) || atts.length === 0 || atts.length > 16) {
        throw new Error('bridge: dsh:attachments:add.attachments must be 1..16 items');
      }
      const attachments: { uri: string }[] = [];
      for (const item of atts) {
        if (typeof item !== 'object' || item === null) {
          throw new Error('bridge: dsh:attachments:add item must be an object');
        }
        const uri = (item as Record<string, unknown>).uri;
        if (typeof uri !== 'string' || uri.length === 0 || uri.length > 8_192) {
          throw new Error('bridge: dsh:attachments:add.uri must be a string <= 8k chars');
        }
        attachments.push({ uri });
      }
      return { type: 'dsh:attachments:add', attachments };
    }
    case 'dsh:attachments:remove':
      if (typeof msg.attachmentId !== 'string' || msg.attachmentId.length === 0 || msg.attachmentId.length > 128) {
        throw new Error('bridge: dsh:attachments:remove.attachmentId invalid');
      }
      return { type: 'dsh:attachments:remove', attachmentId: msg.attachmentId };
    case 'dsh:attachments:toggle': {
      const kind = msg.kind;
      if (kind !== 'activeFile' && kind !== 'selection') {
        throw new Error('bridge: dsh:attachments:toggle.kind must be activeFile|selection');
      }
      if (typeof msg.enabled !== 'boolean') {
        throw new Error('bridge: dsh:attachments:toggle.enabled must be a boolean');
      }
      return { type: 'dsh:attachments:toggle', kind, enabled: msg.enabled };
    }
    default:
      throw new Error(`bridge: unknown message type: ${String(msg.type)}`);
  }
}
