/**
 * dsh-attachment-ui.ts — Phase 10 附着 UI(注入 dsh 上游对话输入区,webview 侧)。
 *
 * 背景:上游 ui-conversation 输入框冻结(红线禁改 vendor),附着能力走既有桥注入范式:
 *   - document 级 capture 拖放监听(Explorer = text/uri-list 纯 URI 行;OS 拖入尽力
 *     feature-detect webUtils.getPathForFile,拿不到路径明确降级提示);
 *   - 输入区上方注入工具栏:[Active File]/[Selection] 开关 chip + 附着文件 chip(可移除);
 *   - 上游 React 重渲染会清除注入节点 → MutationObserver(rAF 合并)重插;
 *   - 状态由扩展推送(dsh:attachments:state,结构白名单校验);回传走 __dshBridge.postToHost
 *     (bridge 持有唯一 acquireVsCodeApi,不可二次 acquire)。
 *
 * 构建:scripts/build.mjs → dist/web/dsh-attachment-ui.js → build-web-shell.mjs 拷入 dsh-shell
 * 并在 </body> 前注入 <script>。无 node 依赖;无 inline 事件处理器(CSP);chip 文本一律
 * textContent 渲染(文件名转义)。
 */
declare global {
  interface Window {
    __DSH_LOCALE__?: string;
    __dshBridge?: {
      setView: (view: 'chat' | 'sessions') => void;
      postToHost?: (message: unknown) => void;
    };
    webUtils?: { getPathForFile?: (file: File) => string };
  }
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
  activeFile?: { path: string; languageId: string; isDirty: boolean; isUntitled: boolean };
  selections: readonly SelectionSummaryState[];
  attachments: readonly AttachmentRefState[];
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

const formatRanges = (selections: readonly SelectionSummaryState[]): string =>
  selections.map((s) => s.startLine + '-' + s.endLine).join(', ');

/** 取路径的文件名(相对/绝对/untitled uri 都适用;Windows 反斜杠兼容) */
const basenameOf = (path: string): string => {
  const normalized = path.split(/[/\\]/).filter((seg) => seg !== '');
  return normalized.length > 0 ? normalized[normalized.length - 1]! : path;
};

/** 输入区上方注入工具栏根(composer 未就绪返回 null;根已在 DOM 则复用) */
/** 图标(自绘 outline SVG;静态数据,非用户输入,可安全 innerHTML) */
const FILE_ICON_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M3 1.5h6l4 4v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z"/>'
  + '<path d="M9 1.5v4h4"/></svg>';
const SELECTION_ICON_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M2.5 4h11M2.5 8h11M2.5 12h6"/>'
  + '<path d="M12.5 9.5v4.5l1.8-1.4 1.7 1.4v-4.5"/></svg>';

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
  // 活动文件指示:存在即显示(icon + 文件名);点击切换是否随消息附着
  const activeIndicator = document.createElement('button');
  activeIndicator.type = 'button';
  activeIndicator.className = 'dsh-attach-indicator';
  activeIndicator.setAttribute('data-kind', 'activeFile');
  activeIndicator.hidden = true;
  const activeIcon = document.createElement('span');
  activeIcon.className = 'dsh-attach-indicator-icon';
  activeIcon.innerHTML = FILE_ICON_SVG;
  const activeName = document.createElement('span');
  activeName.className = 'dsh-attach-indicator-name';
  activeIndicator.append(activeIcon, activeName);
  activeIndicator.addEventListener('click', () => {
    if (lastState === null) return;
    postToHost({ type: 'dsh:attachments:toggle', kind: 'activeFile', enabled: !lastState.activeFileEnabled });
  });
  // 选区指示:存在即显示(icon + N lines selected);点击切换是否随消息附着
  const selectionIndicator = document.createElement('button');
  selectionIndicator.type = 'button';
  selectionIndicator.className = 'dsh-attach-indicator';
  selectionIndicator.setAttribute('data-kind', 'selection');
  selectionIndicator.hidden = true;
  const selectionIcon = document.createElement('span');
  selectionIcon.className = 'dsh-attach-indicator-icon';
  selectionIcon.innerHTML = SELECTION_ICON_SVG;
  const selectionLines = document.createElement('span');
  selectionLines.className = 'dsh-attach-indicator-lines';
  selectionIndicator.append(selectionIcon, selectionLines);
  selectionIndicator.addEventListener('click', () => {
    if (lastState === null) return;
    postToHost({ type: 'dsh:attachments:toggle', kind: 'selection', enabled: !lastState.selectionEnabled });
  });
  const files = document.createElement('span');
  files.className = 'dsh-attach-files';
  files.setAttribute('data-dsh-attach-files', '');
  const toast = document.createElement('div');
  toast.className = 'dsh-attach-toast';
  toast.hidden = true;
  toolbar.append(activeIndicator, selectionIndicator, files);
  root.append(overlay, toolbar, toast);
  seat.insertBefore(root, seat.firstChild);
  return root;
}

function renderState(state: AttachmentState): void {
  lastState = state;
  const el = ensureRoot();
  if (el === null || !el.isConnected) return;
  const toolbar = el.querySelector('.dsh-attach-toolbar');
  const activeIndicator = el.querySelector('.dsh-attach-indicator[data-kind="activeFile"]');
  const selectionIndicator = el.querySelector('.dsh-attach-indicator[data-kind="selection"]');
  const files = el.querySelector('.dsh-attach-files');
  let hasContent = false;
  // 活动文件指示:**存在即显示**(开关只决定是否随消息附着,不影响显示;on=强调色)
  if (activeIndicator instanceof HTMLButtonElement) {
    const show = state.activeFileAvailable && state.activeFile !== undefined;
    activeIndicator.hidden = !show;
    activeIndicator.classList.toggle('on', state.activeFileEnabled);
    if (show && state.activeFile !== undefined) {
      const nameEl = activeIndicator.querySelector('.dsh-attach-indicator-name');
      const dirty = state.activeFile.isDirty ? ' •' : '';
      if (nameEl !== null) nameEl.textContent = basenameOf(state.activeFile.path) + dirty;
      activeIndicator.title =
        state.activeFile.path
        + (state.activeFile.isDirty ? ' · ' + str('未保存', 'unsaved') : '')
        + ' · ' + str('点击切换随消息附着', 'click to toggle attach');
      hasContent = true;
    }
  }
  // 选区指示:**存在即显示**
  if (selectionIndicator instanceof HTMLButtonElement) {
    const show = state.selectionAvailable && state.selections.length > 0;
    selectionIndicator.hidden = !show;
    selectionIndicator.classList.toggle('on', state.selectionEnabled);
    if (show) {
      const linesEl = selectionIndicator.querySelector('.dsh-attach-indicator-lines');
      const lines = selectionLineCount(state.selections);
      if (linesEl !== null) {
        linesEl.textContent = lines === 1 ? '1 line selected' : lines + ' lines selected';
      }
      selectionIndicator.title = formatRanges(state.selections) + ' · ' + str('点击切换随消息附着', 'click to toggle attach');
      hasContent = true;
    }
  }
  // 拖入文件 chip
  if (files instanceof HTMLElement) {
    files.textContent = '';
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
  if (inSessions() || !isSupportedDrop(event.dataTransfer)) return;
  event.preventDefault();
  event.stopPropagation();
  document.body.classList.add('dsh-dragging');
}

function onDragOver(event: DragEvent): void {
  if (inSessions() || !isSupportedDrop(event.dataTransfer)) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy';
}

function onDragLeave(event: DragEvent): void {
  const related = event.relatedTarget;
  if (related === null || !(related instanceof Node) || !document.body.contains(related)) {
    document.body.classList.remove('dsh-dragging');
  }
}

function onDrop(event: DragEvent): void {
  document.body.classList.remove('dsh-dragging');
  if (inSessions()) return;
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

