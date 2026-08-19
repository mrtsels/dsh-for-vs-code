/**
 * dsh-attachment-ui.ts — Phase 10 附着 UI(注入 dsh 上游对话输入区,webview 侧)。
 *
 * 背景:上游 ui-conversation 输入框冻结(红线禁改 vendor),附着能力走既有桥注入范式:
 *   - document 级 capture 拖放监听(Explorer = text/uri-list 纯 URI 行;OS 拖入尽力
 *     feature-detect webUtils.getPathForFile,拿不到路径明确降级提示);
 *   - 输入区上方注入工具栏:[Selection] 开关 chip + 附着文件 chip(可移除;
 *     活动文件指示已弃用,见下方「插件整合」);
 *   - 上游 React 重渲染会清除注入节点 → MutationObserver(rAF 合并)重插;
 *   - 状态由扩展推送(dsh:attachments:state,结构白名单校验);回传走 __dshBridge.postToHost
 *     (bridge 持有唯一 acquireVsCodeApi,不可二次 acquire)。
 *
 * 插件整合(2026,需求 4/5):活动文件不再自绘 icon+文件名 指示(已弃用)——
 * 由 dsh-file-attach 动态插件渲染「建议附着」虚线 chip + 「+」(点击才正式附着):
 *   - 插件 client 与 webview 同页时(window.__dshFileAttach):把活动文件路径推为建议;
 *   - 插件 client 未激活但 wire inventory 可解析插件身份(state.cordis)时,经
 *     build-web-shell.mjs 桥接缝 3(window.__dshCordisEnsureClient)驱动 client half
 *     在本页加载(对已运行插件宿主零重启),落地后再推建议;
 *   - 插件缺失/无法激活:活动文件无 webview 指示(原生 ask 路径由扩展侧读取,不受影响)。
 * 插件激活时本页拖放/paste 让位给插件(避免双份 chip / 双重附着)。
 * **选区指示同活动文件指示一样弃用自绘**(2026-08):webview 不再自绘 icon+「N lines
 * selected」,改由插件渲染虚线建议框(排在文件建议框之前,点击正式附着);插件缺失时
 * 不显示。拖入文件 chip(插件缺失时的原生回退)保持本页渲染。
 *
 * 构建:scripts/build.mjs → dist/web/dsh-attachment-ui.js → build-web-shell.mjs 拷入 dsh-shell
 * 并在 </body> 前注入 <script>。无 node 依赖;无 inline 事件处理器(CSP);chip 文本一律
 * textContent 渲染(文件名转义)。
 */
declare global {
  interface Window {
    __DSH_LOCALE__?: string;
    /** 扩展注入的 runtime 代理地址(webview 侧兜底 wire 调用用;bridge 同款) */
    __DSH_WEB_URL__?: string;
    __dshBridge?: {
      setView: (view: 'chat' | 'sessions') => void;
      postToHost?: (message: unknown) => void;
    };
    webUtils?: { getPathForFile?: (file: File) => string };
    /** dsh-file-attach 动态插件暴露的建议附着 API(插件 client 与 webview 同页时存在)。 */
    __dshFileAttach?: {
      suggest?: (paths: string[]) => Promise<unknown>;
      /** v15:选区建议 —— selection = { path, ranges:[{startLine,endLine}], lineCount } | null */
      suggestSelection?: (selection: {
        path: string;
        ranges: readonly { startLine: number; endLine: number }[];
        lineCount: number;
      } | null) => Promise<unknown>;
      clearSuggest?: () => Promise<unknown>;
    };
    /** build-web-shell.mjs 桥接缝 3 暴露:确保动态插件 client half 在本页加载
     * (cordis-client-runner apply 内注入;对已运行插件经 runHostHalf 直连手势挂接,宿主零重启)。 */
    __dshCordisEnsureClient?: (request: {
      agentId: string;
      pluginId: string;
      packageId: string;
      mode?: 'run' | 'update';
    }) => Promise<{ ok: boolean; already?: boolean; message?: string }>;
    __dshCordisIsLoaded?: (pluginId: string) => boolean;
    /** 当前浏览文件绝对路径(插件 client 建议补发读取;v12 协议) */
    __dshActiveFileFsPath?: string;
    /** 当前选区声明(插件 client 建议补发读取;v15 协议):
     *  { path, ranges:[{startLine,endLine}], lineCount } | null,每次状态推送写入 */
    __dshActiveSelection?: {
      path: string;
      ranges: readonly { startLine: number; endLine: number }[];
      lineCount: number;
    } | null;
  }
}

/** 通知插件 client「附着状态可能已变化」(v14 协议:事件带来源标记,双方只响应对方来源,
 *  防 dsh:attachments:changed 自激循环 —— 扩展 suggest 落地 dispatch {from:'extension'},
 *  插件 removeItem 后 dispatch {from:'plugin'})。 */
function notifyAttachmentsChanged(from: 'extension' | 'plugin'): void {
  try {
    window.dispatchEvent(new CustomEvent('dsh:attachments:changed', { detail: { from } }));
  } catch {
    /* 事件可选 */
  }
}

/** 插件建议 API 是否可用(feature-detect,不假设同页必有插件);
 *  v15:suggest 或 suggestSelection 任一存在即视为插件已激活 */
function pluginSuggestApi(): Window['__dshFileAttach'] | undefined {
  const api = window.__dshFileAttach;
  return api !== undefined && (typeof api.suggest === 'function' || typeof api.suggestSelection === 'function')
    ? api
    : undefined;
}

/**
 * 把当前打开的文件推为「建议附着」(需求 4/5):插件 client 激活时推建议,由插件渲染
 * 虚线包裹文件名 + 「+」(点击才正式附着);插件不可用时**不再回退自绘指示**(icon+文件名
 * 指示已弃用),返回 false 由调用方决定是否驱动插件激活。
 * suggest 落地(host 已存)后 dispatch dsh:attachments:changed,插件据此重拉 list 立即显示。
 */
function pushActiveFileSuggestion(fsPath: string | undefined): boolean {
  const api = pluginSuggestApi();
  if (api === undefined || api.suggest === undefined) return false;
  try {
    const p = api.suggest(fsPath === undefined ? [] : [fsPath]);
    if (p !== undefined && p !== null) {
      Promise.resolve(p).then(() => notifyAttachmentsChanged('extension')).catch(() => {});
    } else {
      notifyAttachmentsChanged('extension');
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 把当前选区推为「建议附着」(v15):selection 非空时推选区建议,由插件渲染
 * 「N lines selected」虚线框(排在文件建议框之前,点击正式附着);selection 为 null
 * 时清空选区建议(无选区)。suggest 落地后 dispatch dsh:attachments:changed(extension 来源),
 * 插件据此重拉立即显示。
 */
function pushActiveSelectionSuggestion(
  selection: {
    path: string;
    ranges: readonly { startLine: number; endLine: number }[];
    lineCount: number;
  } | null,
): boolean {
  const api = pluginSuggestApi();
  if (api === undefined || api.suggestSelection === undefined) return false;
  try {
    const p = api.suggestSelection(selection);
    if (p !== undefined && p !== null) {
      Promise.resolve(p).then(() => notifyAttachmentsChanged('extension')).catch(() => {});
    } else {
      notifyAttachmentsChanged('extension');
    }
    return true;
  } catch {
    return false;
  }
}

/* ---- 插件 client half 激活(桥接缝 3)---- */
/** 插件是否已在本页激活(window.__dshFileAttach 存在) */
function pluginActive(): boolean {
  return pluginSuggestApi() !== undefined;
}

/** 确保 dsh-file-attach 插件 client half 在本页加载,加载成功后返回 true。
 *  先等 __dshCordisEnsureClient 桥就绪(boot 竞态),再触发 startUserRun(已运行则宿主
 *  零重启挂接),最后等 window.__dshFileAttach 落地(插件 apply 内设置)。
 *  连接未就绪/瞬时失败在 deadline 内重试(webview connection 建立晚于本脚本执行)。带 in-flight 去重。 */
let ensureInFlight: Promise<boolean> | null = null;

function ensurePluginClient(info: { agentId: string; pluginId: string; packageId: string }): Promise<boolean> {
  if (ensureInFlight !== null) return ensureInFlight;
  let attempt: Promise<boolean>;
  attempt = new Promise<boolean>((resolve) => {
    const deadline = Date.now() + 10_000;
    const waitFor = (check: () => boolean, then: () => void): void => {
      if (check()) {
        then();
        return;
      }
      if (Date.now() > deadline) {
        resolve(false);
        return;
      }
      setTimeout(() => waitFor(check, then), 120);
    };
    const runEnsure = (): void => {
      const ensure = window.__dshCordisEnsureClient;
      if (ensure === undefined) return; // waitFor 继续轮询桥就绪
      ensure({ agentId: info.agentId, pluginId: info.pluginId, packageId: info.packageId, mode: 'run' })
        .then((r) => {
          if (r !== null && typeof r === 'object' && r.ok === true) {
            waitFor(() => pluginActive(), () => resolve(true));
          } else {
            scheduleRetry();
          }
        })
        .catch(() => scheduleRetry());
    };
    const scheduleRetry = (): void => {
      if (Date.now() > deadline) {
        resolve(false);
        return;
      }
      setTimeout(runEnsure, 400);
    };
    waitFor(
      () => typeof window.__dshCordisEnsureClient === 'function',
      runEnsure,
    );
  }).finally(() => {
    ensureInFlight = null;
  });
  ensureInFlight = attempt;
  return attempt;
}

/* ---- 插件身份兜底解析(扩展未推送 cordis 时,经代理自行查 inventory)---- */
/** 已解析的插件身份:undefined = 未尝试;null = 无插件;对象 = 可用 */
let selfCordis: AttachmentState['cordis'] | undefined;
let selfCordisResolving = false;

/**
 * 经 __DSH_WEB_URL__ 代理自行解析 dsh-file-attach 插件身份(与扩展 host 的 resolveCordis
 * 同逻辑:inventory 按包名 dsh-file-attach + 双半 + activeRun 匹配)。仅解析一次;
 * 解析失败/无插件置 null(后续靠扩展推送 cordis 或 webview 重载重试)。
 */
async function resolveCordisSelf(): Promise<AttachmentState['cordis']> {
  const base = window.__DSH_WEB_URL__;
  if (typeof base !== 'string' || base === '') return null;
  try {
    const res = await fetch(base + '/api/dynamicCordisRunner/inventory', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'attach-cordis-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        method: 'dynamicCordisRunner/inventory',
        payload: { args: {} },
      }),
    });
    if (res.status !== 200) return null;
    const raw: unknown = await res.json();
    const value = (raw as { result?: { ok?: boolean; value?: unknown } })?.result?.value;
    if (!Array.isArray(value)) return null;
    for (const r of value) {
      if (r === null || typeof r !== 'object') continue;
      const row = r as {
        pluginId?: string;
        agentId?: string;
        activeRun?: { packageId?: string };
        packages?: readonly { name?: string; hasClientHalf?: boolean }[];
      };
      if (typeof row.pluginId !== 'string' || typeof row.agentId !== 'string') continue;
      if (row.activeRun === undefined || typeof row.activeRun.packageId !== 'string') continue;
      const matches = (row.packages ?? []).some((p) => p.hasClientHalf === true && p.name === 'dsh-file-attach');
      if (!matches) continue;
      return { agentId: row.agentId, pluginId: row.pluginId, packageId: row.activeRun.packageId };
    }
    return null;
  } catch {
    return null;
  }
}

/** 激活插件 client half 并在落地后重推活动文件 + 选区建议(扩展推送与自身解析共用)。 */
function ensureWithCordis(info: AttachmentState['cordis']): void {
  if (info === undefined || info === null) return;
  void ensurePluginClient(info).then((ok) => {
    if (!ok || lastState === null) return;
    pushSuggestionsFromState(lastState);
  });
}

/** 依据最近状态推送文件 + 选区建议(插件激活落地后 / 插件事件后重推共用)。 */
function pushSuggestionsFromState(state: AttachmentState): void {
  const activeFsPath =
    state.activeFileAvailable && state.activeFile !== undefined && !state.activeFile.isUntitled
      ? state.activeFile.fsPath
      : '';
  if (activeFsPath !== '') pushActiveFileSuggestion(activeFsPath);
  else pushActiveFileSuggestion(undefined);
  const selection = computeActiveSelection(state);
  pushActiveSelectionSuggestion(selection);
}

/** 当前选区声明(全局写入 + 建议推送共用):无活动文件/untitled/无选区 → null。 */
function computeActiveSelection(state: AttachmentState): {
  path: string;
  ranges: readonly { startLine: number; endLine: number }[];
  lineCount: number;
} | null {
  if (!state.activeFileAvailable || state.activeFile === undefined || state.activeFile.isUntitled) return null;
  const fsPath = state.activeFile.fsPath;
  if (fsPath === '' || state.selections.length === 0) return null;
  return {
    path: fsPath,
    ranges: state.selections.map((s) => ({ startLine: s.startLine, endLine: s.endLine })),
    lineCount: selectionLineCount(state.selections),
  };
}

/* ---- 回传宿主:优先 bridge 的唯一 acquire;独立调试环境回退 window.parent ---- */
const postToHost = (message: unknown): void => {
  const bridgePost = window.__dshBridge?.postToHost;
  if (typeof bridgePost === 'function') {
    bridgePost(message);
    return;
  }
  try {
    window.parent.postMessage(message, '*');
  } catch {
    /* 忽略:无宿主环境 */
  }
};

/* ---- 语言(与 SessionView 同规则)---- */
const ui = (): 'zh' | 'en' => {
  const l = window.__DSH_LOCALE__;
  if (l === 'zh' || l === 'en') return l;
  return (navigator.language ?? '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
};
const str = (zh: string, en: string): string => (ui() === 'zh' ? zh : en);

/* ---- 拖放解析(text/uri-list = 每行一个 URI,非 JSON;# 为注释)---- */
const URI_LIST_MIME = 'text/uri-list';

function parseUriList(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}

/** DataTransfer.types 兼容 DOMStringList/数组 */
function typesOf(dt: DataTransfer): string[] {
  const out: string[] = [];
  for (let i = 0; i < dt.types.length; i += 1) out.push(String(dt.types[i]));
  return out;
}

function isSupportedDrop(dt: DataTransfer | null): boolean {
  if (dt === null) return false;
  const types = typesOf(dt);
  return types.includes(URI_LIST_MIME) || types.includes('Files');
}

/* ---- OS 拖入尽力取本地路径(webUtils feature-detect,非 VS Code API 合约)---- */
function tryGetLocalPath(file: File): string | undefined {
  const webUtils = (globalThis as typeof globalThis & { webUtils?: { getPathForFile?: (f: File) => string } }).webUtils;
  if (webUtils?.getPathForFile === undefined) return undefined;
  try {
    const path = webUtils.getPathForFile(file);
    return path === '' ? undefined : path;
  } catch {
    return undefined;
  }
}

/** fsPath → file:// URI(webview 无 node pathToFileURL;按段转义,Windows 盘符保留) */
function filePathToUri(fsPath: string): string {
  const normalized = fsPath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  const encoded = parts
    .map((seg, i) => (i === 1 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg)))
    .join('/');
  return 'file://' + (normalized.startsWith('/') ? '' : '/') + encoded;
}

/* ---- 宿主推送消息(结构白名单校验,不信任 event.data)---- */
interface SelectionSummaryState {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  charCount: number;
}

interface AttachmentRefState {
  id: string;
  uri: string;
  name: string;
  size?: number;
  languageId?: string;
  displayPath: string;
  outsideWorkspace: boolean;
}

interface AttachmentState {
  activeFileEnabled: boolean;
  selectionEnabled: boolean;
  activeFileAvailable: boolean;
  selectionAvailable: boolean;
  activeFile?: { path: string; fsPath: string; languageId: string; isDirty: boolean; isUntitled: boolean };
  selections: readonly SelectionSummaryState[];
  attachments: readonly AttachmentRefState[];
  /** dsh-file-attach 插件身份(wire inventory 解析;null = 插件未定义/未运行) */
  cordis?: { agentId: string; pluginId: string; packageId: string } | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isAttachmentState(v: unknown): v is AttachmentState {
  if (!isRecord(v)) return false;
  if (typeof v.activeFileEnabled !== 'boolean') return false;
  if (typeof v.selectionEnabled !== 'boolean') return false;
  if (typeof v.activeFileAvailable !== 'boolean') return false;
  if (typeof v.selectionAvailable !== 'boolean') return false;
  if (!Array.isArray(v.selections)) return false;
  if (!Array.isArray(v.attachments)) return false;
  return true;
}

/* ---- 注入 DOM ---- */
let root: HTMLElement | null = null;
let lastState: AttachmentState | null = null;

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return String(bytes);
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

/** 注入到 composer 座位容器([data-composer-seat])最前 = "Message your agent"
 *  输入框正上方;作为座位容器的兄弟节点,**不触碰输入卡片内部**(上游 card 是
 *  React 严格管理的 flex 布局,插入子节点会破坏 textarea 排版 —— 2026-08-21 实测教训)。
 *  composer 座位未就绪返回 null;根已在 DOM 则复用。 */
function ensureRoot(): HTMLElement | null {
  if (document.body.classList.contains('dsh-sessions')) return null;
  if (root !== null && root.isConnected) return root;
  const seat = document.querySelector('[data-composer-seat]');
  if (seat === null) return null;
  root = document.createElement('div');
  root.id = 'dsh-attachment-root';
  root.className = 'dsh-attachment-root';
  root.setAttribute('data-dsh-attachment', '');
  const overlay = document.createElement('div');
  overlay.id = 'dsh-drop-overlay';
  overlay.className = 'dsh-drop-overlay';
  const toolbar = document.createElement('div');
  toolbar.className = 'dsh-attach-toolbar';
  toolbar.setAttribute('data-dsh-attach-toolbar', '');
  toolbar.hidden = true;
  // 活动文件指示与选区指示均已弃用(2026-08):webview 内由 dsh-file-attach 插件渲染
  // 「建议附着」虚线 chip(文件 + 「N lines selected」);此处只保留拖入文件 chip 回退。
  const files = document.createElement('span');
  files.className = 'dsh-attach-files';
  files.setAttribute('data-dsh-attach-files', '');
  const toast = document.createElement('div');
  toast.className = 'dsh-attach-toast';
  toast.hidden = true;
  toolbar.append(files);
  root.append(overlay, toolbar, toast);
  seat.insertBefore(root, seat.firstChild);
  return root;
}

function renderState(state: AttachmentState): void {
  lastState = state;
  const el = ensureRoot();
  if (el === null || !el.isConnected) return;
  const toolbar = el.querySelector('.dsh-attach-toolbar');
  const files = el.querySelector('.dsh-attach-files');
  let hasContent = false;
  // 活动文件:**弃用自绘指示** —— 仅委托插件「建议附着」(虚线 chip + 「+」正式附着)。
  // 插件 client 未激活时先驱动激活:身份来源 = 扩展推送的 state.cordis,缺失则经代理自行
  // 解析(兼容旧扩展进程);落地后重推建议。
  // 注意:必须传**绝对路径**(插件 fs.resolve 以进程 cwd 为基准,相对路径解析不可靠);untitled 跳过。
  // 暴露 window.__dshActiveFileFsPath(v12 协议):插件 client 在建议为空时据此补发。
  const activeFsPath =
    state.activeFileAvailable && state.activeFile !== undefined && !state.activeFile.isUntitled
      ? state.activeFile.fsPath
      : '';
  try {
    window.__dshActiveFileFsPath = activeFsPath;
  } catch {
    /* 全局可选 */
  }
  // v15:选区同活动文件 —— 弃用自绘指示,委托插件「建议附着」;同时暴露
  // window.__dshActiveSelection(选区声明)供插件 client 补发(与 __dshActiveFileFsPath 同范式)。
  const selection = computeActiveSelection(state);
  try {
    window.__dshActiveSelection = selection;
  } catch {
    /* 全局可选 */
  }
  const filePushed = pushActiveFileSuggestion(activeFsPath !== '' ? activeFsPath : undefined);
  const selPushed = pushActiveSelectionSuggestion(selection);
  if ((!filePushed || !selPushed)) {
    const info = state.cordis ?? selfCordis;
    if (info !== undefined && info !== null) {
      ensureWithCordis(info);
    } else if (selfCordis === undefined && !selfCordisResolving) {
      selfCordisResolving = true;
      void resolveCordisSelf().then((resolved) => {
        selfCordis = resolved;
        selfCordisResolving = false;
        if (resolved !== undefined && resolved !== null) ensureWithCordis(resolved);
      });
    }
  }
  // 拖入文件 chip:插件激活时隐藏(插件自身渲染附着 chips,paste/drop 由插件接管,
  // 避免双份 chip / 双重附着);插件缺失时保留本页渲染(原生 ask 路径仍走扩展)。
  if (files instanceof HTMLElement) {
    files.textContent = '';
    if (!pluginActive()) {
      for (const a of state.attachments) {
        const chip = document.createElement('span');
        chip.className = 'dsh-attach-chip dsh-attach-file' + (a.outsideWorkspace ? ' warning' : '');
        chip.title = a.uri + (a.outsideWorkspace ? ' · ' + str('工作区外', 'outside workspace') : '');
        const name = document.createElement('span');
        name.textContent = a.name + (a.size !== undefined ? ' (' + formatSize(a.size) + ')' : '');
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'dsh-attach-remove';
        remove.setAttribute('aria-label', str('移除', 'Remove'));
        remove.textContent = '×';
        remove.addEventListener('click', (e) => {
          e.stopPropagation();
          postToHost({ type: 'dsh:attachments:remove', attachmentId: a.id });
        });
        chip.append(name, remove);
        files.append(chip);
        hasContent = true;
      }
    }
  }
  if (toolbar instanceof HTMLElement) toolbar.hidden = !hasContent;
}

/** 选区总行数(多光标求和;1-based 行号差 +1,单行计 1) */
function selectionLineCount(selections: readonly SelectionSummaryState[]): number {
  let total = 0;
  for (const s of selections) total += Math.max(s.endLine - s.startLine + 1, 1);
  return total;
}

/* ---- 错误 toast ---- */
let toastTimer: number | undefined;

function showToast(message: string): void {
  const el = ensureRoot();
  if (el === null) return;
  const toast = el.querySelector('.dsh-attach-toast');
  if (!(toast instanceof HTMLElement)) return;
  toast.textContent = message;
  toast.hidden = false;
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 4000);
}

/* ---- 拖放(document capture;仅命中 text/uri-list 或 Files 才拦截)---- */
function inSessions(): boolean {
  return document.body.classList.contains('dsh-sessions');
}

function onDragEnter(event: DragEvent): void {
  // 插件激活时拖放由插件接管(composer 内自动附着 + 渲染 chips),扩展不再拦截
  if (pluginActive() || inSessions() || !isSupportedDrop(event.dataTransfer)) return;
  event.preventDefault();
  event.stopPropagation();
  document.body.classList.add('dsh-dragging');
}

function onDragOver(event: DragEvent): void {
  if (pluginActive() || inSessions() || !isSupportedDrop(event.dataTransfer)) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy';
}

function onDragLeave(event: DragEvent): void {
  if (pluginActive()) return;
  const related = event.relatedTarget;
  if (related === null || !(related instanceof Node) || !document.body.contains(related)) {
    document.body.classList.remove('dsh-dragging');
  }
}

function onDrop(event: DragEvent): void {
  document.body.classList.remove('dsh-dragging');
  if (pluginActive() || inSessions()) return;
  const dt = event.dataTransfer;
  if (dt === null) return;
  // Explorer / Tree View:text/uri-list(标准 MIME)
  const uriList = dt.getData(URI_LIST_MIME);
  if (uriList !== '') {
    const uris = parseUriList(uriList);
    if (uris.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    postToHost({ type: 'dsh:attachments:add', attachments: uris.map((uri) => ({ uri })) });
    return;
  }
  // OS 桌面:尽力取本地路径(webUtils feature-detect);拿不到明确降级提示
  const files = Array.from(dt.files);
  if (files.length === 0) return;
  const first = tryGetLocalPath(files[0]!);
  if (first === undefined) {
    event.preventDefault();
    event.stopPropagation();
    postToHost({
      type: 'dsh:attachments:error',
      code: 'unsupported',
      message: str('无法获取本地文件路径,请从 VS Code Explorer 拖入文件。', 'Cannot resolve local file path. Drag from the VS Code Explorer instead.'),
    });
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const attachments = files
    .map((f) => {
      const path = tryGetLocalPath(f);
      return path === undefined ? null : { uri: filePathToUri(path) };
    })
    .filter((x): x is { uri: string } => x !== null);
  if (attachments.length > 0) postToHost({ type: 'dsh:attachments:add', attachments });
}

/* ---- 宿主消息:状态推送 / 错误 ---- */
function onHostMessage(event: MessageEvent): void {
  const data = event.data;
  if (!isRecord(data)) return;
  if (data.type === 'dsh:attachments:state') {
    if (isAttachmentState(data.state)) renderState(data.state);
    return;
  }
  if (data.type === 'dsh:attachments:error' && typeof data.message === 'string') {
    showToast(data.message);
  }
}

/* ---- 启动:监听 + MutationObserver(rAF 合并)重插 + 就绪上报 ---- */
function init(): void {
  document.addEventListener('dragenter', onDragEnter, true);
  document.addEventListener('dragover', onDragOver, true);
  document.addEventListener('dragleave', onDragLeave, true);
  document.addEventListener('drop', onDrop, true);
  window.addEventListener('message', onHostMessage);
  // v12 同步协议:插件 client 在「移除已附着文件」等操作后 dispatch dsh:attachments:changed
  // → 本页重新推当前浏览文件为建议(host 自动跳过仍附着的)→ 虚线 + 「+」形态恢复。
  // v14:只响应插件来源(from==='plugin'),不响应自身 suggest 落地的 extension 事件 ——
  // 切断自激循环(扩展 suggest→dispatch→监听→再 suggest 曾致建议框持续重建、点击落空)。
  // v15:同时重推选区建议(X 掉选区 chip 后虚线「N lines selected」恢复)。
  window.addEventListener('dsh:attachments:changed', (e) => {
    const from = (e as CustomEvent<{ from?: string }> | null)?.detail?.from;
    if (from !== 'plugin') return;
    if (lastState === null) return;
    pushSuggestionsFromState(lastState);
  });
  let rafId: number | undefined;
  const observer = new MutationObserver(() => {
    if (rafId !== undefined) return;
    rafId = requestAnimationFrame(() => {
      rafId = undefined;
      // 注入根被上游重渲染清除时重建并重渲染;根仍在则不动作 —— 关键守卫:
      // renderState 的 DOM 写入会再次触发 observer,若无此守卫会 rAF 级无限自激循环
      // (页面主线程被打满,Playwright/真实 webview 全部卡死)。
      if (root === null || !root.isConnected) {
        if (ensureRoot() !== null && lastState !== null) renderState(lastState);
      }
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  ensureRoot();
  postToHost({ type: 'dsh:attachments:ready' });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export {};

