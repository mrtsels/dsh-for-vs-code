#!/usr/bin/env node
// P5-4 验证脚本:抓 3080 的 shell 产物 + 插件 bundle 到本地 dist/web/dsh-plugins/
// 用法:node scripts/fetch-dsh-ui.mjs <dest-dir>
// 产物结构:
//   <dest>/boot.json                 — __DSH_BOOT__(entries.url 改写为本地相对路径)
//   <dest>/assets/*                  — index/vendor js+css
//   <dest>/plugins/<id>/client.js    — 每个插件的 bundle
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://127.0.0.1:3080';
const dest = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'web', 'dsh-plugins');

async function get(url) {
  const res = await fetch(BASE + url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.text();
}

// 1. boot 图(平衡括号解析,避免 JSON 内含 < 干扰正则)
const html = await get('/');
const bootStart = html.indexOf('__DSH_BOOT__');
if (bootStart < 0) throw new Error('未找到 __DSH_BOOT__');
const brace = html.indexOf('{', bootStart);
let depth = 0;
let k = brace;
while (k < html.length) {
  const c = html[k];
  if (c === '{') depth += 1;
  else if (c === '}') {
    depth -= 1;
    if (depth === 0) break;
  }
  k += 1;
}
const boot = JSON.parse(html.slice(brace, k + 1));
console.log(`boot: rev=${boot.rev}, entries=${boot.entries.length}`);

// 2. assets 清单(index/vendor js+css)
const assetUrls = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((x) => x[1]);
console.log(`assets: ${assetUrls.length} 个`);

// 3. 下载插件 bundle(去重)
const pluginIds = new Set();
const rewrites = new Map(); // 原 url → 本地路径
for (const e of boot.entries) {
  const id = e.id;
  if (pluginIds.has(id)) continue;
  pluginIds.add(id);
  const local = `plugins/${id}/client.js`;
  rewrites.set(e.url, local);
}
const pluginUrls = [...new Set(boot.entries.map((e) => e.url))];
console.log(`plugins: ${pluginUrls.length} 个 bundle 待下载`);

// 4. 并行下载
const tasks = [];
for (const u of assetUrls) {
  const local = `assets/${u.split('/').pop()}`;
  tasks.push(get(u).then(async (body) => {
    await mkdir(join(dest, 'assets'), { recursive: true });
    await writeFile(join(dest, local), body);
  }).catch((e) => console.error(`assets 失败 ${u}: ${e.message}`)));
}
for (const u of pluginUrls) {
  const id = u.match(/plugins\/@deepseek-ai\/([^/]+)\/client\.js/)?.[1];
  if (!id) { console.error(`插件 URL 无法解析: ${u}`); continue; }
  const local = `plugins/${id}/client.js`;
  tasks.push(get(u).then(async (body) => {
    // 本地适配:webview 的 location.origin 是 vscode-webview://,connection 无法从
    // 页面推导实例地址 → 固定指向 127.0.0.1:3080(Phase 6 定制构建时改为注入配置)
    if (id === 'dsh-client-connection') {
      body = body
        .replace(/location\?\.origin !== void 0 && location\.origin !== "null" \? location\.origin : INTERNAL_BASE/g, '"http://127.0.0.1:3080"')
        .replace(/loc\?\.origin !== void 0 && loc\.origin !== "null" \? loc\.origin : INTERNAL_BASE\$1/g, '"http://127.0.0.1:3080"');
      if (!body.includes('"http://127.0.0.1:3080"')) {
        console.error(`⚠️ connection 适配替换未命中(id=${id})`);
      }
    }
    await mkdir(join(dest, 'plugins', id), { recursive: true });
    await writeFile(join(dest, local), body);
  }).catch((e) => console.error(`插件失败 ${u}: ${e.message}`)));
}
await Promise.all(tasks);

// 5. boot 图 URL 改写为本地相对路径;输出 boot.js(CSP 无 inline script,数据走独立文件)
const localBoot = {
  ...boot,
  rev: 'local',
  entries: boot.entries.map((e) => ({
    ...e,
    url: `./plugins/${e.id}/client.js`,
    rev: 'local',
  })),
};
await writeFile(join(dest, 'boot.js'), `window.__DSH_BOOT__ = ${JSON.stringify(localBoot)};\n`);
console.log(`✅ 完成 → ${dest}`);
console.log(`   assets: ${assetUrls.length}, plugins: ${pluginIds.size}`);
