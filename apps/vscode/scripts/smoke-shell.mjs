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
const consoleMsgs = [];
page.on('console', (m) => consoleMsgs.push(`[${m.type()}] ${m.text().slice(0, 200)}`));
page.on('pageerror', (e) => consoleMsgs.push(`[pageerror] ${String(e).slice(0, 300)}`));
page.on('requestfailed', (r) => consoleMsgs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText ?? ''}`));
page.on('response', (r) => { if (r.status() >= 400) consoleMsgs.push(`[http ${r.status()}] ${r.url()}`); });
await page.addInitScript((relay) => {
  window.__DSH_WEB_URL__ = relay;
}, `http://127.0.0.1:${RELAY_PORT}`);
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
    hasErrorBanner: errBanner !== null,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    frameBg: frame ? getComputedStyle(frame).backgroundColor : '(无 frame)',
  };
});
await page.screenshot({ path: '/tmp/dsh-shell-headless.png' });
console.log('STATE:', JSON.stringify(state, null, 1));
console.log('RELAY LOG:', relayLog.slice(0, 20).join('\n'));
console.log('CONSOLE(前 20):');
for (const m of consoleMsgs.slice(0, 20)) console.log(' ', m);
await browser.close();

// ---- 断言(裁剪模式下应全绿)----
const failures = [];
if (state.rootChildren < 1) failures.push('UI 未渲染(root 空)');
if (state.hasErrorBanner) failures.push('页面出现错误横幅');
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
const wsOk = relayLog.some((l) => l.includes('WS connected'));
if (!wsOk) failures.push('WS 事件流未建立');

if (failures.length > 0) {
  console.log('SMOKE FAIL:\n  ' + failures.join('\n  '));
  process.exit(1);
}
console.log('SMOKE PASS: UI 渲染 / RPC / WS / 无冲突 / 透明融合全部通过');
process.exit(0);