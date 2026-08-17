#!/usr/bin/env node
/**
 * build-web-shell.mjs — Route A 装配脚本(替代 fetch-dsh-ui.mjs)
 *
 * 从锁定 rev 的 vendor/deepseek-harness 源码构建产物,装配出 webview 可加载的
 * 完整 shell 目录(不再对着活 3080 抓取):
 *
 *   dist/web/dsh-shell/
 *     index.html          上游 apps/web vite 产物,绝对路径改相对(无 manifest/favicon)
 *     shell.css           侧边栏融合样式(静态,替代旧 DOM 启发式)
 *     assets/**           vite 构建产物(js/css/fonts/langs)
 *     plugins/<id>/client.js   各 client 包 lib/client.js(与上游 /plugins/<id>/client.js 同构)
 *     boot.js             window.__DSH_BOOT__ = {rev, entries[]}(静态组图,镜像上游
 *                         ClientModuleRegistry 语义:扫描 dsh.client 声明)
 *
 * 唯一适配缝:connection bundle 的 resolveBase 三元表达式 → __DSH_WEB_URL__ 优先
 * (扩展侧代理地址,绕行 Origin 栅栏)。断言式替换:期望文本缺失即失败并提示更新缝。
 *
 * 默认裁剪模式(Phase 6 定制 boot 图):排除叶子 UI 插件(由 VS Code 原生层接管),
 * 并裁剪 inject 边(缺依赖会导致 loader 等待 → 插件永不激活);--full 保留全量图。
 * 裁剪结果与 scripts/ref-graph-rc6.json(已验证的 rc.6 裁剪图)做集合断言。
 * 同时写入 shell.css(侧边栏融合,静态样式,替代旧 DOM 启发式)并注入 index.html。
 *
 * 用法:node scripts/build-web-shell.mjs [vendorRoot] [dest] [--full]
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

/** 裁剪:排除纯叶子 UI 插件(设置/计划/交付物/工作流/agent-preset/权限预设/目录选择),
 * 由 VS Code 原生 UI 接管;会话区+输入面保留。短 id(去掉 @deepseek-ai/ 前缀)。 */
const EXCLUDE_PLUGINS = new Set([
  'dsh-client-ui-plan',
  'dsh-client-ui-deliverables',
  'dsh-client-ui-workflow-run',
  'dsh-client-ui-agent-preset',
  'dsh-client-ui-permission-presets',
  'dsh-client-ui-settings-general',
  'dsh-client-ui-settings-models',
  'dsh-client-ui-settings-plugin-inventory',
  'dsh-client-ui-settings-plugins',
  'dsh-client-ui-directory-picker-native',
  'dsh-client-ui-directory-picker-browse',
  // ui-workspace/ui-sidebar 保留:工作区选择/显示依赖;自动关联由扩展层实现
  // 注:browse 是 rc.5 源码多出的包(rc.6 服务端图没有),裁剪以对齐已验证的 28 集
]);

/** 侧边栏融合样式(静态;替代旧 transparentPageChrome DOM 启发式)。 */
const SHELL_CSS = `/* dsh-shell 侧边栏融合(静态样式,构建产物,与 shell rev 绑定) */
html, body, #root { background: transparent !important; }
/* 布局 chrome(哈希类名后缀稳定:CSS modules 的 [hash]_[name]):框架/三列透出 VS Code 底色;
   内容卡片(消息/输入框)保留自身表面色 */
[class$="_frame"], [class$="_sidebarCol"], [class$="_centerCol"], [class$="_detailsCol"] { background: transparent !important; }
`;

const shortId = (id) => id.replace('@deepseek-ai/', '');

/**
 * 会话切换桥(静态,与 shell rev 绑定):原生 Sessions 树 → webview 的切换契约。
 * 扩展侧 post 'dsh:switch-session' → 本桥写上游 attachPersistence 读取的
 * localStorage(dsh.sessions.current,JSON {sessionId})→ 回 post
 * 'switch-session:applied' → chat-panel 重注入 html 完成重载(上游在 boot 时恢复会话)。
 * 无 acquireVsCodeApi 的环境(纯浏览器调试/冒烟)下静默,不影响 UI。
 */
const BRIDGE_JS = `window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg === null || typeof msg !== 'object' || msg.type !== 'dsh:switch-session') return;
  if (typeof msg.sessionId !== 'string') return;
  try {
    localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: msg.sessionId }));
    window.parent.postMessage({ type: 'switch-session:applied', sessionId: msg.sessionId }, '*');
  } catch (err) {
    console.error('[dsh-bridge] switch-session:', String(err));
  }
});
`;

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
  // 绝对路径改相对;去掉 manifest/favicon(webview 内 404,同时不随 VSIX 分发)
  let html = readFileSync(shellHtml, 'utf8')
    .replace(/(src|href)="\//g, '$1="./')
    .replace(/<link rel="manifest"[^>]*>\s*/g, '')
    .replace(/<link rel="icon"[^>]*>\s*/g, '');
  writeFileSync(shellHtml, html);
  rmSync(join(dest, 'manifest.webmanifest'), { force: true });
  rmSync(join(dest, 'favicon.svg'), { force: true });

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

  // 3. 裁剪(默认;--full 关闭):排除叶子插件 + 裁剪 inject 边 + 清除产物目录
  const full = process.argv.includes('--full');
  let graphEntries = entries;
  if (!full) {
    const excluded = entries.filter((e) => EXCLUDE_PLUGINS.has(shortId(e.id)));
    const kept = entries.filter((e) => !EXCLUDE_PLUGINS.has(shortId(e.id)));
    const keptIds = new Set(kept.map((e) => e.id));
    graphEntries = kept.map((e) => {
      const inject = (e.inject ?? []).filter((d) => keptIds.has(d));
      return { ...e, ...(inject.length > 0 ? { inject } : {}) };
    });
    for (const e of excluded) {
      rmSync(join(dest, 'plugins', ...e.id.split('/')), { recursive: true, force: true });
    }
    console.log(`boot 裁剪: ${entries.length} → ${graphEntries.length} 个插件`);
  }

  // 4. 图 rev + boot.js + shell.css;index.html 静态注入(首个 head 脚本,
  // 先于模块脚本执行;与上游 injectBootManifest 同构,产物自包含)
  writeFileSync(join(dest, 'shell.css'), SHELL_CSS);
  const graphRev = shortHash(graphEntries.map((e) => e.rev).join('|'));
  const graph = { rev: graphRev, entries: graphEntries };
  const bootJs = `window.__DSH_BOOT__ = ${JSON.stringify(graph).replaceAll('<', '\\u003c')};\n`;
  writeFileSync(join(dest, 'boot.js'), bootJs);
  writeFileSync(join(dest, 'bridge.js'), BRIDGE_JS);
  html = html.replace(/<head>/i, '<head><link rel="stylesheet" href="./shell.css" /><script src="./boot.js"></script><script src="./bridge.js"></script>');
  writeFileSync(shellHtml, html);

  // 5. 与参考图集合核对(ref-graph-rc6.json 优先;旧抓取图兜底)
  const REF_FILE = join(repoRoot, 'apps', 'vscode', 'scripts', 'ref-graph-rc6.json');
  let ref;
  if (existsSync(REF_FILE)) {
    ref = new Set(JSON.parse(readFileSync(REF_FILE, 'utf8')).ids);
  } else {
    ref = referenceGraph();
  }
  if (ref !== undefined) {
    const ids = new Set(graphEntries.map((e) => e.id));
    const extra = [...ids].filter((id) => !ref.has(id)).sort();
    const missingIds = [...ref].filter((id) => !ids.has(id)).sort();
    if (full) {
      if (extra.length > 0) console.warn(`⚠ 新增插件(参考图没有):${extra.join(', ')}`);
      if (missingIds.length > 0) console.warn(`⚠ 缺失插件(参考图有,rc.5 源码没有):${missingIds.join(', ')}`);
    } else if (extra.length > 0 || missingIds.length > 0) {
      throw new Error(
        `裁剪图与参考图不一致:\n  extra(参考图没有):${extra.join(', ') || '(无)'}\n  missing(参考图有):${missingIds.join(', ') || '(无)'}\n`
        + '  裁剪集合已变:确认是上游新增插件还是裁剪误伤;有意变更则更新 scripts/ref-graph-rc6.json',
      );
    }
  }
  console.log(`✅ dsh-shell 装配完成 → ${dest}: plugins=${graphEntries.length}, rev=${graphRev}${full ? ' (full)' : ''}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});