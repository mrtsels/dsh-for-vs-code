#!/usr/bin/env node
// fetch-dsh-ui.mjs — 抓 3080 上游 shell 产物到本地(递归,含动态 import chunk)
// 用法:node scripts/fetch-dsh-ui.mjs [dest]
// 产物结构:
//   <dest>/boot.js                   — __DSH_BOOT__(entries.url → ./plugins/<id>/client.js)
//   <dest>/assets/<file>             — vite 入口 + 所有 chunk(保持目录结构)
//   <dest>/plugins/<id>/client.js    — 每个插件 bundle(connection 已适配指向 3080)
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://127.0.0.1:3080';
const dest = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'web', 'dsh-plugins');

const fetched = new Map(); // url → local path
const queue = [];

async function fetchTo(url, local) {
  const full = BASE + url;
  const res = await fetch(full);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  const body = await res.text();
  const out = join(dest, ...local.split('/'));
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, body);
  fetched.set(url, local);
  return body;
}

/** 从 JS 文本提取相对引用(静态/动态 import + CSS url) */
function refsFrom(js) {
  const refs = new Set();
  for (const m of js.matchAll(/["'](\.[^"']+)["']/g)) {
    const r = m[1];
    if (!r.startsWith('.')) continue;
    refs.add(r.split('?')[0]);
  }
  for (const m of js.matchAll(/url\(["']?(\.[^"')]+)["']?\)/g)) refs.add(m[1].split('?')[0]);
  return refs;
}

// 1. boot 图(平衡括号解析)
const html = await fetchTo('/', '__root__.html');
const bootStart = html.indexOf('__DSH_BOOT__');
const brace = html.indexOf('{', bootStart);
let depth = 0, k = brace;
while (k < html.length) {
  const c = html[k];
  if (c === '{') depth += 1;
  else if (c === '}') { depth -= 1; if (depth === 0) break; }
  k += 1;
}
const boot = JSON.parse(html.slice(brace, k + 1));
console.log(`boot: rev=${boot.rev}, entries=${boot.entries.length}`);

// 2. 入口资源(html 中 /assets/* 与 /plugins/*)
for (const m of html.matchAll(/(?:src|href)="(\/(?:assets|plugins)\/[^"]+)"/g)) {
  const url = m[1];
  if (fetched.has(url)) continue;
  const local = url.startsWith('/assets/') ? `assets/${url.slice('/assets/'.length)}` : url.slice(1);
  try {
    const body = await fetchTo(url, local);
    if (url.startsWith('/assets/')) queue.push({ url, local, body });
  } catch (e) { console.error(`入口失败 ${url}: ${e.message}`); }
}

// 3. 递归抓取 JS/CSS 的相对引用(vite chunk 树)
while (queue.length > 0) {
  const { url, local, body } = queue.shift();
  const refs = refsFrom(body ?? '');
  for (const ref of refs) {
    const childUrl = normalize(join(dirname(url), ref));
    const fullUrl = childUrl.startsWith('/') ? childUrl : `/${childUrl}`;
    if (fetched.has(fullUrl)) continue;
    const childLocal = fullUrl.replace(/^\//, '');
    try {
      const childBody = await fetchTo(fullUrl, childLocal);
      if (fullUrl.endsWith('.js') || fullUrl.endsWith('.css')) queue.push({ url: fullUrl, local: childLocal, body: childBody });
    } catch (e) { console.error(`chunk 失败 ${fullUrl}: ${e.message}`); }
  }
}

// 4. 插件 bundle(connection 本地适配)
const pluginIds = new Set(boot.entries.map((e) => e.id));
for (const url of [...new Set(boot.entries.map((e) => e.url))]) {
  const id = url.match(/plugins\/@deepseek-ai\/([^/]+)\/client\.js/)?.[1];
  if (!id) continue;
  try {
    let body = await fetchTo(url, `plugins/${id}/client.js`);
    if (id === 'dsh-client-connection') {
      body = body
        .replace(/location\?\.origin !== void 0 && location\.origin !== "null" \? location\.origin : INTERNAL_BASE/g, '"http://127.0.0.1:3080"')
        .replace(/loc\?\.origin !== void 0 && loc\.origin !== "null" \? loc\.origin : INTERNAL_BASE\$1/g, '"http://127.0.0.1:3080"');
      await writeFile(join(dest, 'plugins', id, 'client.js'), body);
    }
  } catch (e) { console.error(`插件失败 ${url}: ${e.message}`); }
}

// 5. boot.js(CSP 无 inline script,数据走独立文件;附加错误转发通道用于调试)
const localBoot = {
  ...boot,
  rev: 'local',
  entries: boot.entries.map((e) => ({ ...e, url: `./plugins/${e.id}/client.js`, rev: 'local' })),
};
const debugBridge = `
;(() => {
  const vs = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
  if (!vs) return;
  const send = (kind, msg) => vs.postMessage({ type: 'debug', kind, message: String(msg).slice(0, 500) });
  window.addEventListener('error', (e) => send('error', e.message || e.error));
  window.addEventListener('unhandledrejection', (e) => send('rejection', e.reason && (e.reason.stack || e.reason.message || e.reason)));
  // CSP 检测诊断:与 preload 的 querySelector 一致
  send('error', 'CSP-大写查询=' + (document.querySelector('meta[http-equiv="Content-Security-Policy"]') !== null)
    + ' CSP-小写查询=' + (document.querySelector('meta[http-equiv="content-security-policy"]') !== null));
})();`;
await writeFile(join(dest, 'boot.js'), `window.__DSH_BOOT__ = ${JSON.stringify(localBoot)};\n${debugBridge}\n`);
const assetCount = [...fetched.keys()].filter((u) => u.startsWith('/assets/')).length;
console.log(`✅ 完成 → ${dest}: assets=${assetCount} 文件, plugins=${pluginIds.size} 个`);
