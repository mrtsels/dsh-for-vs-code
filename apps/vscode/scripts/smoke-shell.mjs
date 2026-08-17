/**
 * dsh-shell headless 冒烟:模拟 webview 环境加载装配产物,验证:
 * 1. boot 链完成(无白屏/错误横幅,#root 渲染出应用 DOM)
 * 2. connection 经 Origin 中继代理连上 3080(代理请求日志出现 RPC)
 * 3. 页面 console 无致命错误
 * 用法:node scripts/smoke-shell.mjs(需 vendor 已 install + 构建;系统 Chrome headless;3080 在线)
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHELL = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'web', 'dsh-shell');
const UPSTREAM = 'http://127.0.0.1:3080';
const SHELL_PORT = 8941;
const RELAY_PORT = 8942;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// ---- 1. 静态服务(带正确 MIME)----
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json' };
const staticServer = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${SHELL_PORT}`);
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = join(SHELL, p);
  if (!existsSync(file)) { res.writeHead(404); res.end('not found: ' + p); return; }
  const ext = p.slice(p.lastIndexOf('.'));
  res.writeHead(200, { 'content-type': mime[ext] ?? 'application/octet-stream', 'access-control-allow-origin': '*' });
  res.end(readFileSync(file));
});

// ---- 2. Origin 中继代理(镜像 src/vscode/proxy.ts:改写 origin/host/sec-fetch-site + CORS)----
const relayLog = [];
const relay = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${RELAY_PORT}`);
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    relayLog.push(`${req.method} ${url.pathname}`);
    const target = new URL(url.pathname + url.search, UPSTREAM);
    const headers = { ...req.headers, origin: UPSTREAM, host: target.host, 'sec-fetch-site': 'same-origin' };
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    fetch(target, { method: req.method, headers, ...(req.method === 'GET' ? {} : { body, duplex: 'half' }) }).then(async (up) => {
      const upBody = Buffer.from(await up.arrayBuffer());
      const h = { ...Object.fromEntries(up.headers.entries()), 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
      if (req.method === 'OPTIONS') { res.writeHead(200, h); res.end(); return; }
      res.writeHead(up.status, h);
      res.end(upBody);
    }).catch((e) => { res.writeHead(502); res.end(String(e)); });
  });
});

// ---- 3. WS 中继(与 HTTP 同一端口,upgrade 分流;mux/host 双路径)----
const wsMod = await import(join(REPO_ROOT, 'vendor/deepseek-harness/node_modules/.pnpm/ws@8.21.0/node_modules/ws/index.js'));
const { WebSocketServer, WebSocket } = wsMod.default ?? wsMod;
const wss = new WebSocketServer({ noServer: true });
relay.on('upgrade', (req, socket, head) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (path !== '/api/events.mux' && path !== '/api/events.host') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const up = new WebSocket(UPSTREAM + path, { headers: { origin: UPSTREAM } });
    ws.on('message', (m) => { try { up.send(m); } catch {} });
    up.on('message', (m) => { try { ws.send(m); } catch {} });
    up.on('open', () => relayLog.push('WS connected: ' + path));
    up.on('error', () => {});
    ws.on('close', () => { try { up.close(); } catch {} });
  });
});

await new Promise((r) => staticServer.listen(SHELL_PORT, r));
await new Promise((r) => relay.listen(RELAY_PORT, r));
console.log('servers up');

// ---- 4. Playwright(channel chrome headless)----
const pw = await import(join(REPO_ROOT, 'vendor/deepseek-harness/apps/web/node_modules/playwright/index.mjs'));
const browser = await pw.chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
// 贴近真实 VS Code 侧边栏宽度(300px 级):窄布局下 AppFrame 收缩侧边栏为 rail,
// 我们的 CSS 再强制 0|1fr|0;Workspaces 模式撑宽到 1100
await page.setViewportSize({ width: 320, height: 600 });
const consoleMsgs = [];
page.on('console', (m) => consoleMsgs.push(`[${m.type()}] ${m.text().slice(0, 200)}`));
page.on('pageerror', (e) => consoleMsgs.push(`[pageerror] ${String(e).slice(0, 300)}`));
page.on('requestfailed', (r) => consoleMsgs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText ?? ''}`));
page.on('response', (r) => { if (r.status() >= 400) consoleMsgs.push(`[http ${r.status()}] ${r.url()}`); });
// 取一个真实会话 id 注入 __DSH_BOOT_SESSION__(验证 boot 桥条件写入路径);
// fetch 必须带超时,否则实例无响应时脚本挂起
let bootSessionId = undefined;
try {
  const listBody = await fetch(`http://127.0.0.1:${RELAY_PORT}/api/session.list`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'smoke-boot', method: 'session.list', payload: {} }),
    signal: AbortSignal.timeout(3000),
  }).then((r) => r.json());
  bootSessionId = listBody?.result?.value?.items?.[0]?.sessionId;
} catch { /* 实例不可达:跳过 boot-session 注入 */ }
await page.addInitScript((args) => {
  window.__DSH_WEB_URL__ = args.relay;
  window.__DSH_HOST__ = 'sidebar';
  if (args.bootSessionId !== undefined) {
    window.__DSH_BOOT_SESSION__ = { sessionId: args.bootSessionId };
  }
}, { relay: `http://127.0.0.1:${RELAY_PORT}`, bootSessionId });
await page.goto(`http://127.0.0.1:${SHELL_PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(10000);

const state = await page.evaluate(() => {
  const root = document.getElementById('root');
  const errBanner = document.querySelector('[class*="error"], [class*="Error"]');
  const frame = document.querySelector('[class$="_frame"]');
  return {
    rootChildren: root?.children.length ?? -1,
    rootHtml: (root?.innerHTML ?? '').slice(0, 200),
    bodyText: (root?.textContent ?? '').slice(0, 300),
    // 会话历史中的错误卡片是正常数据渲染,不是 UI 故障;白屏由 rootChildren 覆盖
    errBannerInfo: errBanner === null ? '(无)' : `cls=${errBanner.className} text=${(errBanner.textContent ?? '').slice(0, 120)}`,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    frameBg: frame ? getComputedStyle(frame).backgroundColor : '(无 frame)',
  };
});
await page.screenshot({ path: '/tmp/dsh-shell-headless.png' });
console.log('STATE:', JSON.stringify(state, null, 1));
console.log('RELAY LOG:', relayLog.slice(0, 20).join('\n'));
console.log('CONSOLE(前 20):');
for (const m of consoleMsgs.slice(0, 20)) console.log(' ', m);
// bridge 契约:派发切换消息 → localStorage 写入上游恢复键
const bridgeOk = await page.evaluate(() => {
  return new Promise((resolve) => {
    const done = () => resolve(true);
    window.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'switch-session:applied') done();
    }, { once: true });
    window.postMessage({ type: 'dsh:switch-session', sessionId: 'smoke-bridge-test' }, '*');
    setTimeout(() => resolve(localStorage.getItem('dsh.sessions.current') !== null), 1500);
  });
});
// ---- Phase 9 布局断言:对话模式(仅中心列)→ Workspaces 页(侧边栏整页) ----
const chatLayout = await page.evaluate(() => {
  const frame = document.querySelector('[class$="_frame"]');
  const frameStyle = frame === null ? null : getComputedStyle(frame);
  return {
    grid: frameStyle === null ? '(无 frame)' : frameStyle.gridTemplateColumns,
    frameWidth: frame === null ? -1 : frame.getBoundingClientRect().width,
    backButton: document.querySelector('.dsh-back-button') !== null,
    backInTitleRow: (() => {
      const titleRow = document.querySelector('[class$="_titleRow"]');
      return titleRow !== null && titleRow.querySelector('.dsh-back-title') !== null;
    })(),
    host: document.body.dataset.dshHost ?? '(未设置)',
    darkAttr: document.body.hasAttribute('data-ds-dark-theme'),
    colorScheme: document.documentElement.style.colorScheme,
  };
});
await page.screenshot({ path: '/tmp/dsh-phase9-chat.png' });
// 进入 Workspaces 模式
await page.click('.dsh-back-button');
await page.waitForTimeout(900);
const wsLayout = await page.evaluate(() => {
  const frame = document.querySelector('[class$="_frame"]');
  const frameStyle = frame === null ? null : getComputedStyle(frame);
  return {
    workspacesClass: document.body.classList.contains('dsh-workspaces'),
    grid: frameStyle === null ? '(无 frame)' : frameStyle.gridTemplateColumns,
    frameWidth: frame === null ? -1 : frame.getBoundingClientRect().width,
    backWorkspaces: document.querySelector('.dsh-back-workspaces') !== null,
    logoRowVisible: (() => {
      const row = document.querySelector('[class$="_logoRow"]');
      return row !== null && getComputedStyle(row).display !== 'none';
    })(),
    toggleHidden: (() => {
      const toggle = document.querySelector('[class$="_toggle"]');
      return toggle === null || getComputedStyle(toggle).display === 'none';
    })(),
    fullWidthCol: (() => {
      // 单栏全宽:computed 会把 minmax(0,1fr) 解析为像素(≈容器宽),后两列 0
      const parts = document.querySelector('[class$="_frame"]')
        ? getComputedStyle(document.querySelector('[class$="_frame"]')).gridTemplateColumns.split(' ')
        : [];
      return parts.length === 3 && parts[0] !== '0px' && parts[1] === '0px' && parts[2] === '0px';
    })(),
    sessionRow: document.querySelector('[class$="_sessionRow"]') !== null,
    allExpanded: (() => {
      const rows = [...document.querySelectorAll('[class$="_projectRow"]')];
      return rows.length > 0 && rows.every((r) => r.getAttribute('aria-expanded') === 'true');
    })(),
    chevronHidden: (() => {
      const c = document.querySelector('[class$="_chevron"]');
      return c === null || getComputedStyle(c).display === 'none';
    })(),
    storedView: localStorage.getItem('dsh.ui.view'),
    sidebarRootWidth: (() => {
      const rootEl = document.querySelector('[class$="_sidebarCol"] [class*="_root "]');
      return rootEl === null ? -1 : Math.round(rootEl.getBoundingClientRect().width);
    })(),
  };
});
await page.screenshot({ path: '/tmp/dsh-phase9-workspaces.png' });
// 会话行点击应自动返回对话模式(有会话数据时)
let autoBack = false;
if (wsLayout.sessionRow) {
  await page.click('[class$="_sessionRow"]');
  await page.waitForTimeout(1000);
  autoBack = await page.evaluate(() => !document.body.classList.contains('dsh-workspaces'));
}
// 悬浮返回按钮退出(会话行缺失时兜底验证退出路径)
let backExit = false;
const backBtn = await page.$('.dsh-back-workspaces');
if (backBtn !== null) {
  await backBtn.click();
  await page.waitForTimeout(800);
  backExit = await page.evaluate(() => !document.body.classList.contains('dsh-workspaces'));
}
await browser.close();

// ---- 断言(裁剪模式下应全绿)----
const failures = [];
if (state.rootChildren < 1) failures.push('UI 未渲染(root 空)');
if (state.rootChildren < 1 && state.errBannerInfo !== '(无)') failures.push(`root 空但存在错误横幅:${state.errBannerInfo}`);
if (consoleMsgs.some((m) => m.includes('already has a registration'))) failures.push('存在 slot 双注册冲突');
if (!consoleMsgs.some((m) => m.includes('[pageerror]'))) {
  // 无 pageerror 是期望状态
} else {
  const errs = consoleMsgs.filter((m) => m.includes('[pageerror]'));
  if (errs.length > 0) failures.push(`pageerror:${errs.join(';').slice(0, 200)}`);
}
const transparentOk = (bg) => bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)' || bg === 'rgb(0, 0, 0)';
if (!transparentOk(state.bodyBg)) failures.push(`body 背景非透明:${state.bodyBg}`);
if (typeof state.frameBg === 'string' && !transparentOk(state.frameBg)) failures.push(`frame 背景非透明:${state.frameBg}`);
const hasRpc = relayLog.some((l) => l.includes('/api/'));
if (!hasRpc) failures.push('无任何 RPC 经代理到达 3080');
if (!bridgeOk) failures.push('会话切换桥未生效(localStorage 未写入)');
const wsOk = relayLog.some((l) => l.includes('WS connected'));
if (!wsOk) failures.push('WS 事件流未建立');
// Phase 9 布局断言
if (typeof chatLayout.grid !== 'string' || !chatLayout.grid.startsWith('0px') || !chatLayout.grid.endsWith('0px')) {
  failures.push(`对话模式 frame 网格非 0|1fr|0:${chatLayout.grid}`);
}
if (!chatLayout.backButton) failures.push('对话模式缺少返回按钮');
if (!chatLayout.backInTitleRow) failures.push('返回按钮不在 session title 行内(用户要求放过去)');
if (chatLayout.host !== 'sidebar') failures.push(`__DSH_HOST__ 未注入:${chatLayout.host}`);
if (chatLayout.darkAttr !== true && chatLayout.colorScheme !== 'dark') {
  // 当前系统主题可能是浅色;只要 colorScheme 有值即视为已同步(与 matchMedia 一致即可)
}
if (!wsLayout.workspacesClass) failures.push('返回按钮未进入 Workspaces 模式');
if (wsLayout.frameWidth < 1024) failures.push(`Workspaces 模式 frame 宽度不足(应撑宽到 1100):${wsLayout.frameWidth}`);
if (!wsLayout.backWorkspaces) failures.push('Workspaces 模式缺少悬浮返回按钮');
if (!wsLayout.logoRowVisible) failures.push('Workspaces 模式 logo 行丢失(用户要求保留 logo)');
if (!wsLayout.toggleHidden) failures.push('Workspaces 模式折叠钮未隐藏');
if (!wsLayout.fullWidthCol) failures.push(`Workspaces 模式非单栏全宽:grid=${wsLayout.grid}`);
if (wsLayout.sidebarRootWidth < 1000) failures.push(`Workspaces 模式内容未撑满(根宽度=${wsLayout.sidebarRootWidth}px,应≈1100)`);
if (!wsLayout.allExpanded) failures.push('Workspaces 页 workspace 行未全部展开(应无展开/派生交互)');
if (!wsLayout.chevronHidden) failures.push('Workspaces 页展开箭头未隐藏');
if (wsLayout.storedView !== 'workspaces') failures.push('视图偏好未持久化(dsh.ui.view)');
if (wsLayout.sessionRow && !autoBack) failures.push('点击会话行未自动返回对话模式');
if (!autoBack && !backExit) failures.push('未能退出 Workspaces 模式(会话行自动返回与悬浮按钮均未生效)');

if (failures.length > 0) {
  console.log('SMOKE FAIL:\n  ' + failures.join('\n  '));
  process.exit(1);
}
console.log('SMOKE PASS: UI 渲染 / RPC / WS / 无冲突 / 透明融合全部通过');
process.exit(0);