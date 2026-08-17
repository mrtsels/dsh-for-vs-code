#!/usr/bin/env node
/**
 * build-web-shell.mjs — Route A 装配脚本(替代 fetch-dsh-ui.mjs)
 *
 * 从锁定 rev 的 vendor/deepseek-harness 源码构建产物,装配出 webview 可加载的
 * 完整 shell 目录(不再对着活 3080 抓取):
 *
 *   dist/web/dsh-shell/
 *     index.html          上游 apps/web vite 产物,绝对路径改相对(无 manifest/favicon)
 *     assets/**           vite 构建产物(js/css/fonts/langs)
 *     plugins/<id>/client.js   各 client 包 lib/client.js(与上游 /plugins/<id>/client.js 同构)
 *     boot.js             window.__DSH_BOOT__ = {rev, entries[]}(静态组图,镜像上游
 *                         ClientModuleRegistry 语义:扫描 dsh.client 声明)
 *
 * 唯一适配缝:connection bundle 的 resolveBase 三元表达式 → __DSH_WEB_URL__ 优先
 * (扩展侧代理地址,绕行 Origin 栅栏)。断言式替换:期望文本缺失即失败并提示更新缝。
 *
 * 用法:node scripts/build-web-shell.mjs [vendorRoot] [dest]
 *   vendorRoot 默认 <repo>/vendor/deepseek-harness(构建产物须已就绪:
 *   build:lib:client + build:web)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, cpSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const vendorRoot = resolve(process.argv[2] ?? join(repoRoot, 'vendor', 'deepseek-harness'));
const dest = resolve(process.argv[3] ?? join(repoRoot, 'apps', 'vscode', 'dist', 'web', 'dsh-shell'));

const SHELL_DIST = join(vendorRoot, 'apps', 'web', 'dist');

/** sha1 取前 12 位(与上游 graphRow rev 同规格)。 */
function shortHash(input) {
  return createHash('sha1').update(input).digest('hex').slice(0, 12);
}

/** 扫描 packages/<group>[/<name>]/package.json 的 dsh.client 声明(platform=web)。 */
function scanClientPackages() {
  const rows = [];
  const groupsDir = join(vendorRoot, 'packages');
  if (!existsSync(groupsDir)) return rows;
  const pushRow = (pkgDir) => {
    const pkgJson = join(pkgDir, 'package.json');
    if (!existsSync(pkgJson)) return;
    const pkg = JSON.parse(readFileSync(pkgJson, 'utf8'));
    const decl = pkg.dsh?.client;
    if (decl === undefined || decl.platform !== 'web') return;
    rows.push({ id: pkg.name, pkgDir, decl });
  };
  for (const group of readdirSync(groupsDir).sort()) {
    const dir = join(groupsDir, group);
    if (!statSync(dir).isDirectory()) continue; // packages/ 下有 README/AGENTS 等文件
    if (existsSync(join(dir, 'package.json'))) {
      pushRow(dir); // 组目录本身是包(如 packages/boot)
      continue;
    }
    for (const name of readdirSync(dir).sort()) {
      pushRow(join(dir, name));
    }
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * resolveBase 适配缝:connection bundle 内 base 解析替换。
 * 期望文本为 rc.5 构建产物(packages/client/connection/lib/client.js)中实测的
 * 两个 resolveBase 变体(rpc.ts 函数 + web-api-client.ts 方法;tsdown 产物把
 * undefined 压成 void 0、双引号,并给重复声明加 $1 后缀)。
 * 替换后 webview 内优先读扩展注入的 __DSH_WEB_URL__(扩展侧代理地址)。
 * 断言式:任一变体缺失即构建失败,提示升级专项同步更新。
 */
const RESOLVE_BASE_VARIANTS = [
  {
    from: 'loc?.origin !== void 0 && loc.origin !== "null" ? loc.origin : INTERNAL_BASE$1',
    to: 'globalThis.__DSH_WEB_URL__ ?? INTERNAL_BASE$1',
  },
  {
    from: 'location?.origin !== void 0 && location.origin !== "null" ? location.origin : INTERNAL_BASE',
    to: 'globalThis.__DSH_WEB_URL__ ?? INTERNAL_BASE',
  },
];

function patchResolveBase(clientJsPath) {
  let body = readFileSync(clientJsPath, 'utf8');
  for (const { from, to } of RESOLVE_BASE_VARIANTS) {
    const count = body.split(from).length - 1;
    if (count === 0) {
      throw new Error(
        `resolveBase 适配缝失配:${clientJsPath} 中未找到:\n  ${from}\n`
        + '  上游 connection 构建产物已变?升级专项时同步更新本脚本。',
      );
    }
    if (count !== 1) {
      console.warn(`⚠ resolveBase 变体命中 ${count} 处(期望 1):${from}\n继续但需人工确认`);
    }
    body = body.split(from).join(to);
  }
  writeFileSync(clientJsPath, body);
}

/** 读取现存 rc.6 抓取图(如存在)用于集合核对。 */
function referenceGraph() {
  const refBoot = join(dest, '..', 'dsh-plugins', 'boot.js');
  if (!existsSync(refBoot)) return undefined;
  const m = readFileSync(refBoot, 'utf8').match(/window\.__DSH_BOOT__ = (.*?);\n/);
  if (m === null) return undefined;
  try {
    const g = JSON.parse(m[1]);
    return new Set(g.entries.map((e) => e.id));
  } catch {
    return undefined;
  }
}

async function main() {
  if (!existsSync(join(vendorRoot, 'package.json'))) {
    throw new Error(`vendor 不存在:${vendorRoot}(先 git submodule update --init)`);
  }
  if (!existsSync(SHELL_DIST)) {
    throw new Error(`shell 产物缺失:${SHELL_DIST}(先跑 vendor build:web)`);
  }

  // 1. 拷贝 shell 产物
  rmSync(dest, { recursive: true, force: true });
  cpSync(SHELL_DIST, dest, { recursive: true });
  const shellHtml = join(dest, 'index.html');
  if (!existsSync(shellHtml)) throw new Error(`shell index.html 缺失:${shellHtml}`);
  // 绝对路径改相对;去掉 manifest/favicon(webview 内 404)
  let html = readFileSync(shellHtml, 'utf8')
    .replace(/(src|href)="\//g, '$1="./')
    .replace(/<link rel="manifest"[^>]*>\s*/g, '')
    .replace(/<link rel="icon"[^>]*>\s*/g, '');
  writeFileSync(shellHtml, html);

  // 2. 扫描 client 包 → 拷贝 bundle + 组图
  const rows = scanClientPackages();
  if (rows.length === 0) throw new Error(`未扫描到任何 dsh.client(platform=web)包:${vendorRoot}`);
  const missing = [];
  const entries = [];
  for (const { id, pkgDir, decl } of rows) {
    const bundle = join(pkgDir, 'lib', 'client.js');
    if (!existsSync(bundle)) {
      missing.push(`${id}(${bundle})`);
      continue;
    }
    const content = readFileSync(bundle, 'utf8');
    const rev = shortHash(content);
    const pluginDest = join(dest, 'plugins', ...id.split('/'));
    mkdirSync(pluginDest, { recursive: true });
    writeFileSync(join(pluginDest, 'client.js'), content);
    if (id === '@deepseek-ai/dsh-client-connection') {
      patchResolveBase(join(pluginDest, 'client.js'));
    }
    entries.push({
      id,
      url: `./plugins/${id}/client.js?rev=${rev}`,
      rev,
      ...(decl.inject !== undefined && decl.inject.length > 0 ? { inject: decl.inject } : {}),
      ...(decl.immediately === true ? { immediately: true } : {}),
    });
  }
  if (missing.length > 0) {
    throw new Error(`client bundle 缺失(${missing.length}):\n  ${missing.join('\n  ')}\n先跑 vendor build:lib:client`);
  }
  entries.sort((a, b) => a.id.localeCompare(b.id));

  // 3. 图 rev + boot.js
  const graphRev = shortHash(entries.map((e) => e.rev).join('|'));
  const graph = { rev: graphRev, entries };
  const bootJs = `window.__DSH_BOOT__ = ${JSON.stringify(graph).replaceAll('<', '\\u003c')};\n`;
  writeFileSync(join(dest, 'boot.js'), bootJs);

  // 4. 与 rc.6 抓取图集合核对(存在才比对)
  const ref = referenceGraph();
  if (ref !== undefined) {
    const ids = new Set(entries.map((e) => e.id));
    const extra = [...ids].filter((id) => !ref.has(id)).sort();
    const missingIds = [...ref].filter((id) => !ids.has(id)).sort();
    if (extra.length > 0) console.warn(`⚠ 新增插件(rc.6 抓取图没有):${extra.join(', ')}`);
    if (missingIds.length > 0) console.warn(`⚠ 缺失插件(rc.6 抓取图有,rc.5 源码没有):${missingIds.join(', ')}`);
  }
  console.log(`✅ dsh-shell 装配完成 → ${dest}: plugins=${entries.length}, rev=${graphRev}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
