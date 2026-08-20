/**
 * smoke-helpers.mjs — 共享工具:服务器启动 + 浏览器 boot。
 *
 * 父编排器调 createServers() 启动服务器;
 * 子进程调 bootPage(relayPort, staticPort) 启动浏览器并加载 shell。
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SHELL = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'web', 'dsh-shell');
const UPSTREAM = 'http://127.0.0.1:3080';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json' };

/**
 * 启动静态服务器 + Origin 中继代理 + WS 中继。
 * @param {number} staticPort
 * @param {number} relayPort
 * @returns {{ shutdown: () => void, relayLog: string[] }}
 */
export async function createServers(staticPort, relayPort) {
  const relayLog = [];

  const staticServer = createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${staticPort}`);
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = join(SHELL, p);
    if (!existsSync(file)) { res.writeHead(404); res.end('not found: ' + p); return; }
    const ext = p.slice(p.lastIndexOf('.'));
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream', 'access-control-allow-origin': '*' });
    res.end(readFileSync(file));
  });

  const relay = createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${relayPort}`);
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

  // WS 中继
  let wss;
  try {
    const wsMod = await import(join(REPO_ROOT, 'vendor/deepseek-harness/node_modules/.pnpm/ws@8.21.0/node_modules/ws/index.js'));
    const { WebSocketServer, WebSocket } = wsMod.default ?? wsMod;
    wss = new WebSocketServer({ noServer: true });
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
  } catch { /* ws 缺失 */ }

  const shutdown = () => { staticServer.close(); relay.close(); wss?.close(); };

  await new Promise((r) => staticServer.listen(staticPort, r));
  await new Promise((r) => relay.listen(relayPort, r));
  return { shutdown, relayLog };
}

/**
 * 子进程:启动浏览器并 boot shell 页面。
 * @param {number} relayPort
 * @param {number} staticPort
 */
export async function bootPage(relayPort, staticPort) {
  const pw = await import(join(REPO_ROOT, 'vendor/deepseek-harness/apps/web/node_modules/playwright/index.mjs'));
  const browser = await pw.chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 320, height: 600 });

  const consoleMsgs = [];
  page.on('console', (m) => consoleMsgs.push(`[${m.type()}] ${m.text().slice(0, 200)}`));
  page.on('pageerror', (e) => consoleMsgs.push(`[pageerror] ${String(e).slice(0, 300)}`));
  page.on('requestfailed', (r) => consoleMsgs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText ?? ''}`));
  page.on('response', (r) => { if (r.status() >= 400) consoleMsgs.push(`[http ${r.status()}] ${r.url()}`); });

  // 取真实会话 id
  let bootSessionId = undefined;
  try {
    const listBody = await fetch(`http://127.0.0.1:${relayPort}/api/session.list`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'smoke-boot', method: 'session.list', payload: {} }),
      signal: AbortSignal.timeout(3000),
    }).then((r) => r.json());
    const items = listBody?.result?.value?.items;
    const titled = Array.isArray(items)
      ? items.find((it) => it?.projections?.values?.title !== undefined && it.projections.values.title !== '')
      : undefined;
    bootSessionId = titled?.sessionId ?? (Array.isArray(items) ? items[0]?.sessionId : undefined);
  } catch { /* 跳过 */ }

  await page.addInitScript((args) => {
    window.__DSH_WEB_URL__ = args.relay;
    window.__DSH_HOST__ = 'sidebar';
    if (args.bootSessionId !== undefined) {
      window.__DSH_BOOT_SESSION__ = { sessionId: args.bootSessionId };
    }
  }, { relay: `http://127.0.0.1:${relayPort}`, bootSessionId });

  await page.goto(`http://127.0.0.1:${staticPort}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(10000);

  const state = await page.evaluate(() => {
    const root = document.getElementById('root');
    const errBanner = document.querySelector('[class*="error"], [class*="Error"]');
    const frame = document.querySelector('[class$="_frame"]');
    return {
      rootChildren: root?.children.length ?? -1,
      rootHtml: (root?.innerHTML ?? '').slice(0, 200),
      bodyText: (root?.textContent ?? '').slice(0, 300),
      errBannerInfo: errBanner === null ? '(无)' : `cls=${errBanner.className} text=${(errBanner.textContent ?? '').slice(0, 120)}`,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      frameBg: frame ? getComputedStyle(frame).backgroundColor : '(无 frame)',
    };
  });

  return { browser, page, state, consoleMsgs };
}
