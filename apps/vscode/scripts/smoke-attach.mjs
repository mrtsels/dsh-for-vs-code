/**
 * smoke-attach.mjs — 子测试: Phase 10 附着 UI。
 * 环境变量: SMOKE_RELAY_PORT, SMOKE_STATIC_PORT
 */
import { bootPage } from './smoke-helpers.mjs';

const rp = Number(process.env.SMOKE_RELAY_PORT) || 8961;
const sp = Number(process.env.SMOKE_STATIC_PORT) || 8960;

const { browser, page } = await bootPage(rp, sp);
const failures = [];

// ---- 1) 注入宿主状态(活动文件 + 选区 + 附件) ----
await page.evaluate(() => {
  window.postMessage({
    type: 'dsh:attachments:state',
    state: {
      activeFileEnabled: true,
      selectionEnabled: true,
      activeFileAvailable: true,
      selectionAvailable: true,
      activeFile: { path: 'src/a.ts', fsPath: '/workspace/src/a.ts', languageId: 'typescript', isDirty: false, isUntitled: false },
      selections: [{ startLine: 3, startCol: 1, endLine: 5, endCol: 10, charCount: 40 }],
      attachments: [
        { id: 'smoke-1', uri: 'file:///workspace/a.ts', name: 'a.ts', size: 42, displayPath: 'a.ts', outsideWorkspace: false },
      ],
    },
  }, '*');
});
await page.waitForTimeout(500);

const attachUi = await page.evaluate(() => {
  const root = document.getElementById('dsh-attachment-root');
  const afGlobal = window.__dshActiveFileFsPath;
  const selGlobal = window.__dshActiveSelection;
  return {
    rootPresent: root !== null,
    composerSeat: document.querySelector('[data-composer-seat]') !== null,
    inSeat: root !== null && root.parentElement !== null && root.parentElement.hasAttribute('data-composer-seat'),
    activeFileGlobal: typeof afGlobal === 'string' ? afGlobal : '(missing)',
    selectionGlobal: selGlobal === null ? '(null)' : selGlobal,
    hasIndicator: document.querySelectorAll('.dsh-attach-indicator').length,
    pluginActive: window.__dshFileAttach !== undefined,
    fileChips: document.querySelectorAll('.dsh-attach-file').length,
  };
});

if (!attachUi.composerSeat) failures.push('对话模式缺少 composer 座位容器');
if (!attachUi.rootPresent) failures.push('附着 UI 根节点未注入');
if (!attachUi.inSeat) failures.push('附着条未注入 composer 座位容器');
if (attachUi.activeFileGlobal !== '/workspace/src/a.ts') failures.push(`活动文件全局未写入:${attachUi.activeFileGlobal}`);
if (attachUi.selectionGlobal === '(null)' || typeof attachUi.selectionGlobal !== 'object') {
  failures.push('选区全局未写入');
} else {
  if (attachUi.selectionGlobal.path !== '/workspace/src/a.ts') failures.push(`选区全局缺 path`);
  if (attachUi.selectionGlobal.lineCount !== 3) failures.push(`选区全局行数错误:${attachUi.selectionGlobal.lineCount}`);
}
if (attachUi.hasIndicator > 0) failures.push('旧自绘指示不应再渲染');
if (!attachUi.pluginActive && attachUi.fileChips < 1) failures.push('附着文件 chip 未渲染');

// ---- 2) enabled=false 但 available=true → 全局仍写入 ----
await page.evaluate(() => {
  window.postMessage({
    type: 'dsh:attachments:state',
    state: {
      activeFileEnabled: false,
      selectionEnabled: false,
      activeFileAvailable: true,
      selectionAvailable: true,
      activeFile: { path: 'src/a.ts', fsPath: '/workspace/src/a.ts', languageId: 'typescript', isDirty: false, isUntitled: false },
      selections: [{ startLine: 3, startCol: 1, endLine: 5, endCol: 10, charCount: 40 }],
      attachments: [],
    },
  }, '*');
});
await page.waitForTimeout(400);
const attachOff = await page.evaluate(() => ({
  activeFileGlobal: typeof window.__dshActiveFileFsPath === 'string' ? window.__dshActiveFileFsPath : '(missing)',
  selectionGlobal: window.__dshActiveSelection === null ? '(null)' : window.__dshActiveSelection,
}));
if (!attachOff.activeFileGlobal.includes('a.ts') || attachOff.selectionGlobal === '(null)') {
  failures.push('存在即显示:enabled=false 时全局仍应写入');
}

// ---- 3) 无活动文件 → 全局清空 ----
await page.evaluate(() => {
  window.postMessage({
    type: 'dsh:attachments:state',
    state: {
      activeFileEnabled: false,
      selectionEnabled: false,
      activeFileAvailable: false,
      selectionAvailable: false,
      selections: [],
      attachments: [],
    },
  }, '*');
});
await page.waitForTimeout(400);
const attachEmpty = await page.evaluate(() => {
  const toolbar = document.querySelector('.dsh-attach-toolbar');
  return {
    toolbarHidden: toolbar === null ? '(no toolbar)' : toolbar.hidden,
    activeFileGlobal: typeof window.__dshActiveFileFsPath === 'string' ? window.__dshActiveFileFsPath : '(missing)',
    selectionGlobal: window.__dshActiveSelection === null ? '(null)' : window.__dshActiveSelection,
  };
});
if (attachEmpty.toolbarHidden !== true) failures.push(`无活动文件/选区时指示条应隐藏:${attachEmpty.toolbarHidden}`);
if (attachEmpty.activeFileGlobal !== '') failures.push(`无活动文件时应清空(空串):${attachEmpty.activeFileGlobal}`);
if (attachEmpty.selectionGlobal !== '(null)') failures.push('无选区时应为 null');

// ---- 4) 模拟拖放 → postToHost 回传 ----
const dropMsg = await page.evaluate(() => new Promise((resolve) => {
  const onMsg = (e) => {
    const d = e.data;
    if (d && typeof d === 'object' && d.type === 'dsh:attachments:add') {
      window.removeEventListener('message', onMsg);
      resolve(d);
    }
  };
  window.addEventListener('message', onMsg);
  try {
    const uriList = 'file:///workspace/a.ts\r\nfile:///workspace/b.ts';
    const uris = uriList.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '' && !l.startsWith('#'));
    window.postMessage({ type: 'dsh:attachments:add', attachments: uris.map(uri => ({ uri })) }, '*');
  } catch (err) {
    window.removeEventListener('message', onMsg);
    resolve({ error: String(err) });
  }
  setTimeout(() => { window.removeEventListener('message', onMsg); resolve(null); }, 1500);
}));
if (dropMsg === null || dropMsg.error !== undefined || dropMsg.attachments?.length !== 2) {
  failures.push(`拖放未回传 dsh:attachments:add:${JSON.stringify(dropMsg)}`);
}

console.log(JSON.stringify({ module: 'attach', failures }));
await browser.close();
process.exit(failures.length > 0 ? 1 : 0);
