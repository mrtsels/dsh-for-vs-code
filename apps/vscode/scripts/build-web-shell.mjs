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

/** setLocale 桥接缝:locale bundle 的 apply 里暴露 window.__dshSetLocale(id)。
 * 断言式:期望的锚点(LocaleRuntime 构造)缺失即失败。 */
function patchSetLocaleBridge(clientJsPath) {
  let body = readFileSync(clientJsPath, 'utf8');
  const anchors = ['new LocaleRuntime(', 'LocaleRuntime(ctx'];
  const anchor = anchors.find((a) => body.includes(a));
  if (anchor === undefined) {
    throw new Error(
      'setLocale 桥接缝失配:' + clientJsPath + ' 未找到 LocaleRuntime 构造锚点(',
      + '升级专项时同步更新本脚本。)',
    );
  }
  const inj = ';if(typeof window!==\'undefined\'){window.__dshSetLocale=(id)=>{try{return ctx.locale.setLocale(id)}catch(e){return e instanceof Error?e.message:String(e)}};}';
  const at = body.indexOf(';', body.indexOf(anchor));
  if (at === -1) throw new Error('setLocale 桥接缝失配:' + clientJsPath + ' 锚点后无分号');
  body = body.slice(0, at + 1) + inj + body.slice(at + 1);
  writeFileSync(clientJsPath, body);
}

/** 裁剪:排除纯叶子 UI 插件(设置/计划/交付物/工作流/agent-preset/权限预设/目录选择),
 * 由 VS Code 原生 UI 接管;会话区+输入面保留。短 id(去掉 @deepseek-ai/ 前缀)。 */
const EXCLUDE_PLUGINS = new Set([
  // ui-plan 于 2026-08-18 恢复:对话面板需要 Mode(计划)控制;
  // Todo 面板属 ui-conversation 自带,不依赖 ui-plan
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

/**
 * 侧边栏融合 + 布局定制 + VS Code 主题同步(静态;替代旧 transparentPageChrome DOM 启发式)。
 * 类名匹配基于 CSS modules 哈希后缀稳定([hash]_[name]);改 vendor rev 后如有失配,
 * 以构建产物实测类名为准更新(Pitfalls 记录在 AGENTS.md)。
 *
 * 布局(Phase 9):
 * - 对话模式(默认):frame 网格强制 0|1fr|0 —— 只显示对话面板(侧边栏/详情列/拖拽条隐藏);
 * - 会话管理页(body.dsh-sessions):扩展自有 React 视图(web/SessionView.tsx → session-view.js),
 *   独立于上游 #root(display:none),宽度 100% 自适应 webview —— 不撑宽根、不依赖
 *   SIDEBAR_AUTO_COLLAPSE、无展开/折叠/workspace 树(取代 08-18 的"拉伸侧边栏"方案)。
 *
 * 主题(Phase 9):上游 --dsw-alias/--dsw-specific 语义 token 全部重映射到 VS Code 主题变量
 * (--vscode-*);宿主背景区分侧边栏(sideBar-background)与编辑器面板(editor-background),
 * 由扩展注入 __DSH_HOST__ → body[data-dsh-host]。!important 压过上游 ThemePresenter 的
 * body 内联 token 写入。数据色(成功/警告/错误)映射 VS Code 对应色,品牌蓝映射 textLink。
 */
const SHELL_CSS = `/* dsh-shell 布局 + 主题(静态,构建产物,与 shell rev 绑定) */
html, body, #root { background: transparent !important; }
[class$="_frame"], [class$="_sidebarCol"], [class$="_centerCol"], [class$="_detailsCol"] { background: transparent !important; }

/* ---- 宿主变量:VS Code 主题色(sidebar 视图 vs 编辑器面板) ---- */
body {
  --dsh-host-bg: var(--vscode-sideBar-background, var(--vscode-editor-background, #1e1e1e));
  --dsh-host-fg: var(--vscode-sideBar-foreground, var(--vscode-editor-foreground, #d4d4d4));
  --dsh-host-input-bg: var(--vscode-input-background, var(--dsh-host-bg));
  --dsh-host-input-fg: var(--vscode-input-foreground, var(--dsh-host-fg));
  --dsh-host-border: var(--vscode-widget-border, var(--vscode-panel-border, transparent));
  --dsh-host-hover: var(--vscode-list-hoverBackground, color-mix(in srgb, var(--dsh-host-fg) 10%, transparent));
  --dsh-host-active: var(--vscode-list-activeSelectionBackground, color-mix(in srgb, var(--dsh-host-fg) 18%, transparent));
  --dsh-host-button-bg: var(--vscode-button-background, #0e639c);
  --dsh-host-button-fg: var(--vscode-button-foreground, #ffffff);
  --dsh-host-button-hover: var(--vscode-button-hoverBackground, #1177bb);
  --dsh-host-link: var(--vscode-textLink-foreground, #4daafc);
  --dsh-host-error: var(--vscode-editorError-foreground, var(--vscode-errorForeground, #f14c4c));
  --dsh-host-warn: var(--vscode-editorWarning-foreground, #cca700);
  --dsh-host-success: var(--vscode-testing-iconPassed, #73c991);
  --dsh-host-tooltip-bg: var(--vscode-editorHoverWidget-background, var(--dsh-host-bg));
  --dsh-host-tooltip-fg: var(--vscode-editorHoverWidget-foreground, var(--dsh-host-fg));
  --dsh-host-menu-bg: var(--vscode-menu-background, var(--dsh-host-bg));
  --dsh-host-menu-fg: var(--vscode-menu-foreground, var(--dsh-host-fg));
  --dsh-host-focus: var(--vscode-focusBorder, var(--dsh-host-link));
  /* VS Code 强调色(textLink/焦点边框):品牌强调文字用 */
  --dsh-host-accent: var(--vscode-textLink-foreground, var(--vscode-focusBorder, #4daafc));
}
body[data-dsh-host="panel"] {
  --dsh-host-bg: var(--vscode-editor-background, #1e1e1e);
  --dsh-host-fg: var(--vscode-editor-foreground, #d4d4d4);
}

/* ---- 上游语义 token → VS Code 主题(浅/深两套一并重映射,值同源) ---- */
body, body[data-ds-dark-theme] {
  --dsw-alias-bg-base: var(--dsh-host-bg);
  --dsw-alias-bg-layer-1: var(--dsh-host-bg);
  --dsw-alias-bg-layer-2: color-mix(in srgb, var(--dsh-host-bg) 98%, var(--dsh-host-fg));
  --dsw-alias-bg-layer-3: color-mix(in srgb, var(--dsh-host-bg) 96%, var(--dsh-host-fg));
  --dsw-alias-bg-module-platform: color-mix(in srgb, var(--dsh-host-bg) 97%, var(--dsh-host-fg));
  --dsw-alias-bg-multi-select: color-mix(in srgb, var(--dsh-host-fg) 8%, var(--dsh-host-bg));
  --dsw-alias-bg-overlay: var(--dsh-host-tooltip-bg);
  --dsw-alias-bg-skeleton: color-mix(in srgb, var(--dsh-host-fg) 8%, transparent);
  --dsw-alias-border-inverted2: transparent;
  --dsw-alias-border-inverted: transparent;
  --dsw-alias-border-l1: color-mix(in srgb, var(--dsh-host-fg) 8%, transparent);
  --dsw-alias-border-l2-darkmode-thin: color-mix(in srgb, var(--dsh-host-fg) 12%, transparent);
  --dsw-alias-border-l2: color-mix(in srgb, var(--dsh-host-fg) 12%, transparent);
  --dsw-alias-border-l3: color-mix(in srgb, var(--dsh-host-fg) 16%, transparent);
  --dsw-alias-border-l4: color-mix(in srgb, var(--dsh-host-fg) 20%, transparent);
  --dsw-alias-brand-primary: var(--dsh-host-button-bg);
  --dsw-alias-brand-primary-invert: var(--dsh-host-button-fg);
  --dsw-alias-brand-primary-new-colorprimary-new-color: var(--dsh-host-link);
  --dsw-alias-brand-text: var(--dsh-host-link);
  --dsw-alias-button-contrast-fill: var(--dsh-host-button-bg);
  --dsw-alias-button-elevated-fill: var(--dsh-host-bg);
  --dsw-alias-button-floating-fill: var(--dsh-host-bg);
  --dsw-alias-button-floating-hover: var(--dsh-host-hover);
  --dsw-alias-button-ghost-active-border: var(--dsh-host-border);
  --dsw-alias-button-ghost-active-fill: var(--dsh-host-hover);
  --dsw-alias-button-ghost-active-hover: color-mix(in srgb, var(--dsh-host-fg) 14%, var(--dsh-host-bg));
  --dsw-alias-button-info-fill: var(--dsh-host-link);
  --dsw-alias-button-info-hover: color-mix(in srgb, var(--dsh-host-link) 85%, var(--dsh-host-bg));
  --dsw-alias-button-primary-dimmed: color-mix(in srgb, var(--dsh-host-button-bg) 30%, var(--dsh-host-bg));
  --dsw-alias-button-primary-fill: var(--dsh-host-button-bg);
  --dsw-alias-button-primary-hover: var(--dsh-host-button-hover);
  --dsw-alias-button-tool-bar-fill-invisible: transparent;
  --dsw-alias-button-tool-bar-fill: color-mix(in srgb, var(--dsh-host-fg) 10%, transparent);
  --dsw-alias-button-tool-bar-hover: color-mix(in srgb, var(--dsh-host-fg) 16%, transparent);
  --dsw-alias-interactive-bg-active: color-mix(in srgb, var(--dsh-host-fg) 12%, transparent);
  --dsw-alias-interactive-bg-hover-accent: color-mix(in srgb, var(--dsh-host-link) 18%, transparent);
  --dsw-alias-interactive-bg-hover-danger: color-mix(in srgb, var(--dsh-host-error) 10%, transparent);
  --dsw-alias-interactive-bg-hover-solid: var(--dsh-host-hover);
  --dsw-alias-interactive-bg-hover: color-mix(in srgb, var(--dsh-host-fg) 8%, transparent);
  --dsw-alias-label-caption: color-mix(in srgb, var(--dsh-host-fg) 58%, var(--dsh-host-bg));
  --dsw-alias-label-dimmed: color-mix(in srgb, var(--dsh-host-fg) 72%, var(--dsh-host-bg));
  --dsw-alias-label-primary-bluish: var(--dsh-host-link);
  --dsw-alias-label-primary-dimmed: color-mix(in srgb, var(--dsh-host-fg) 82%, var(--dsh-host-bg));
  --dsw-alias-label-primary-foreground: var(--dsh-host-button-fg);
  --dsw-alias-label-primary-inverted: var(--dsh-host-button-fg);
  --dsw-alias-label-primary: var(--dsh-host-fg);
  --dsw-alias-label-secondary: color-mix(in srgb, var(--dsh-host-fg) 76%, var(--dsh-host-bg));
  --dsw-alias-label-tertiary: color-mix(in srgb, var(--dsh-host-fg) 60%, var(--dsh-host-bg));
  --dsw-alias-markdown-citation: color-mix(in srgb, var(--dsh-host-link) 12%, var(--dsh-host-bg));
  --dsw-alias-markdown-code-block-banner: color-mix(in srgb, var(--dsh-host-fg) 8%, var(--dsh-host-bg));
  --dsw-alias-markdown-code-block: color-mix(in srgb, var(--dsh-host-bg) 96%, #000);
  --dsw-alias-markdown-code-segment-selected: var(--dsh-host-active);
  --dsw-alias-markdown-code-segment-unselected: color-mix(in srgb, var(--dsh-host-fg) 14%, var(--dsh-host-bg));
  --dsw-alias-markdown-inline-code: color-mix(in srgb, var(--dsh-host-fg) 10%, var(--dsh-host-bg));
  --dsw-alias-markdown-placeholder: color-mix(in srgb, var(--dsh-host-fg) 40%, transparent);
  --dsw-alias-markdown-tag: color-mix(in srgb, var(--dsh-host-link) 16%, var(--dsh-host-bg));
  --dsw-alias-state-business-primary: var(--dsh-host-link);
  --dsw-alias-state-business-tertiary: color-mix(in srgb, var(--dsh-host-link) 14%, var(--dsh-host-bg));
  --dsw-alias-state-error-primary: var(--dsh-host-error);
  --dsw-alias-state-error-secondary: color-mix(in srgb, var(--dsh-host-error) 14%, var(--dsh-host-bg));
  --dsw-alias-state-success-primary: var(--dsh-host-success);
  --dsw-alias-state-success-secondary: color-mix(in srgb, var(--dsh-host-success) 14%, var(--dsh-host-bg));
  --dsw-alias-state-success-tertiary: color-mix(in srgb, var(--dsh-host-success) 10%, var(--dsh-host-bg));
  --dsw-alias-state-warn-label: color-mix(in srgb, var(--dsh-host-warn) 85%, var(--dsh-host-bg));
  --dsw-alias-state-warn-primary: var(--dsh-host-warn);
  --dsw-alias-state-warn-secondary: color-mix(in srgb, var(--dsh-host-warn) 14%, var(--dsh-host-bg));
  --dsw-alias-state-warn-tertiary: color-mix(in srgb, var(--dsh-host-warn) 10%, var(--dsh-host-bg));
  --dsw-alias-toast-bg: var(--dsh-host-tooltip-bg);
  --dsw-alias-tooltip-bg: var(--dsh-host-tooltip-bg);
  --dsw-specific-bubble-highlight: color-mix(in srgb, var(--dsh-host-link) 12%, var(--dsh-host-bg));
  --dsw-specific-bubble: color-mix(in srgb, var(--dsh-host-bg) 96%, var(--dsh-host-fg));
  --dsw-specific-input-major: var(--dsh-host-input-bg);
  --dsw-specific-login-input: var(--dsh-host-input-bg);
  --dsw-specific-menu: var(--dsh-host-menu-bg);
  --dsw-specific-selector: var(--dsh-host-menu-bg);
  --dsw-specific-sidebar-fill: var(--dsh-host-bg);
  --dsw-specific-sidebar-nav-item-active: var(--dsh-host-active);
  --dsw-specific-sidebar-nav-item-active-accent: var(--dsh-host-focus);
  --dsw-specific-sidebar-nav-item-hover: var(--dsh-host-hover);
  --dsw-specific-tip: color-mix(in srgb, var(--dsh-host-link) 12%, var(--dsh-host-bg));
}

/* ---- 布局:对话模式只显示中心列(自适应 webview 宽度) ---- */
[class$="_frame"] { grid-template-columns: 0px minmax(0, 1fr) 0px !important; }
[class$="_sidebarCol"] { overflow: hidden; }
[class$="_handle"] { display: none !important; }

/* ---- 会话管理页(独立单栏页面,扩展自有 React 视图,见 web/SessionView.tsx)。
       不再是"拉伸侧边栏":不撑宽 #root、不依赖 SIDEBAR_AUTO_COLLAPSE、无展开/折叠。
       页面宽度 100%,任意 webview 宽度(320~1400px)不横向溢出。 ---- */
#dsh-sessions-root { width: 100%; height: 100vh; }
#dsh-sessions-root[hidden] { display: none !important; }
.dsh-session-page {
  display: flex; flex-direction: column;
  width: 100%; height: 100%; min-width: 0; max-width: 100%;
  box-sizing: border-box; overflow-x: hidden;
}
.dsh-session-header {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; flex: none;
  border-bottom: 1px solid var(--dsw-alias-border-l1, var(--dsh-host-border));
}
.dsh-session-back {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; flex: none; border-radius: 6px;
  border: none; background: transparent; color: var(--dsh-host-fg);
  cursor: pointer; padding: 0;
}
.dsh-session-back:hover { background: var(--dsh-host-hover); }
.dsh-session-logo { color: var(--dsh-host-fg); flex: none; }
.dsh-session-new {
  display: inline-flex; align-items: center; gap: 6px; margin-left: auto;
  height: 28px; padding: 0 10px; border-radius: 6px; flex: none;
  border: none; background: var(--dsh-host-button-bg); color: var(--dsh-host-button-fg);
  font-size: 12px; line-height: 1; cursor: pointer; white-space: nowrap;
}
.dsh-session-new:hover { background: var(--dsh-host-button-hover); }
.dsh-session-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 8px 8px 16px; }
/* ---- workspace 分组 + 会话行(2026-08-20 P1/P2:分组/运行状态/归档折叠;
        行结构与上游 ui-workspace Rows 对齐:状态点槽 + 标题 + 元信息) ---- */
.dsh-session-sections { display: flex; flex-direction: column; gap: 2px; }
.dsh-session-section { display: flex; flex-direction: column; }
.dsh-session-section-head {
  display: flex; align-items: center; gap: 6px;
  width: 100%; box-sizing: border-box;
  padding: 6px 8px; border: none; border-radius: 6px;
  background: transparent; color: var(--dsw-alias-label-primary, var(--dsh-host-fg));
  font: inherit; font-size: 12px; font-weight: 600; text-align: left; cursor: pointer;
}
.dsh-session-section-head:hover { background: var(--dsh-host-hover); }
.dsh-session-section-arrow {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 14px; height: 14px;
  color: var(--dsw-alias-label-tertiary, var(--dsh-host-fg));
  transition: transform 0.15s ease;
}
.dsh-session-section-arrow--open { transform: rotate(90deg); }
.dsh-session-section-folder { flex: none; display: inline-flex; color: var(--dsw-alias-label-tertiary, var(--dsh-host-fg)); }
.dsh-session-section-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-session-section-count {
  flex: none; font-weight: 400; font-size: 11px;
  color: var(--dsw-alias-label-tertiary, var(--dsh-host-fg));
}
.dsh-session-rows { display: flex; flex-direction: column; gap: 1px; padding-bottom: 4px; }
.dsh-session-row {
  display: flex; align-items: center; gap: 8px;
  width: 100%; min-width: 0; box-sizing: border-box;
  padding: 7px 8px 7px 10px; border: none; border-radius: 6px;
  background: transparent; color: var(--dsw-alias-label-primary, var(--dsh-host-fg));
  font: inherit; font-size: 13px; text-align: left; cursor: pointer;
}
.dsh-session-row:hover { background: var(--dsh-host-hover); }
.dsh-session-row--current { background: var(--dsh-host-active); }
.dsh-session-row--muted { opacity: 0.55; }
.dsh-session-dot-slot { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 12px; height: 12px; }
.dsh-session-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--dsh-host-accent); }
.dsh-session-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-session-meta { flex: none; display: inline-flex; align-items: center; gap: 8px; font-size: 11px; }
.dsh-session-status { color: var(--dsh-host-accent); }
.dsh-session-time { color: var(--dsw-alias-label-tertiary, var(--dsh-host-fg)); }
.dsh-session-state {
  padding: 24px 12px; text-align: center;
  color: var(--dsw-alias-label-tertiary, var(--dsh-host-fg)); font-size: 13px;
}
.dsh-session-error { font-size: 11px; margin: 6px 0; word-break: break-all; color: var(--dsh-host-error); }
.dsh-session-retry {
  margin-top: 8px; height: 26px; padding: 0 12px; border-radius: 6px;
  border: none; background: var(--dsh-host-button-bg); color: var(--dsh-host-button-fg);
  cursor: pointer;
}

/* ---- 子代理嵌套 + 行操作菜单 + 重命名对话框 + 错误横幅(2026-08-20 P1) ---- */
.dsh-session-row-wrap { display: flex; flex-direction: column; }
.dsh-session-row-line { display: flex; align-items: center; min-width: 0; }
.dsh-session-title-group {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: 4px;
}
.dsh-session-inline-chevron {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 16px; height: 16px; border-radius: 4px;
  color: var(--dsw-alias-label-tertiary, var(--dsh-host-fg)); cursor: pointer;
}
.dsh-session-inline-chevron:hover { background: var(--dsh-host-hover); color: var(--dsh-host-fg); }
.dsh-session-inline-chevron svg { transition: transform 0.15s ease; }
.dsh-session-inline-chevron--open svg { transform: rotate(90deg); }
.dsh-session-children { padding-left: 24px; display: flex; flex-direction: column; }
.dsh-session-more {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; margin-right: 4px; border: none; border-radius: 4px;
  background: transparent; color: var(--dsw-alias-label-tertiary, var(--dsh-host-fg));
  cursor: pointer; padding: 0;
}
.dsh-session-more:hover { background: var(--dsh-host-hover); color: var(--dsh-host-fg); }
.dsh-menu-overlay {
  position: fixed; inset: 0; z-index: 900; background: transparent;
}
.dsh-session-menu {
  position: fixed; z-index: 901; min-width: 168px; padding: 4px;
  background: var(--dsh-host-menu-bg, var(--dsh-host-bg));
  border: 1px solid var(--dsh-host-border, color-mix(in srgb, var(--dsh-host-fg) 15%, transparent));
  border-radius: 6px; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
  display: flex; flex-direction: column;
}
.dsh-session-menu button {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 6px 10px; border: none; border-radius: 4px;
  background: transparent; color: var(--dsh-host-menu-fg, var(--dsh-host-fg));
  font: inherit; font-size: 12px; text-align: left; cursor: pointer;
}
.dsh-session-menu button:hover { background: var(--dsh-host-hover); }
.dsh-session-menu button svg { flex: none; color: var(--dsw-alias-label-tertiary, var(--dsh-host-fg)); }
.dsh-session-dialog-overlay {
  position: fixed; inset: 0; z-index: 902;
  background: color-mix(in srgb, var(--dsh-host-bg, #1e1e1e) 60%, transparent);
  display: flex; align-items: center; justify-content: center;
}
.dsh-session-dialog {
  width: 320px; max-width: calc(100vw - 32px); padding: 16px;
  background: var(--dsh-host-menu-bg, var(--dsh-host-bg));
  border: 1px solid var(--dsh-host-border, color-mix(in srgb, var(--dsh-host-fg) 15%, transparent));
  border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  display: flex; flex-direction: column; gap: 12px;
}
.dsh-session-dialog-title { font-size: 13px; font-weight: 600; color: var(--dsh-host-fg); }
.dsh-session-dialog input {
  width: 100%; box-sizing: border-box; padding: 7px 9px;
  background: var(--dsh-host-input-bg, var(--dsh-host-bg));
  color: var(--dsh-host-input-fg, var(--dsh-host-fg));
  border: 1px solid var(--dsh-host-border, color-mix(in srgb, var(--dsh-host-fg) 20%, transparent));
  border-radius: 6px; font: inherit; font-size: 12px; outline: none;
}
.dsh-session-dialog input:focus { border-color: var(--dsh-host-focus, var(--dsh-host-link)); }
.dsh-session-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }
.dsh-session-dialog-actions button {
  height: 26px; padding: 0 12px; border: none; border-radius: 6px;
  font: inherit; font-size: 12px; cursor: pointer;
}
.dsh-session-dialog-cancel { background: var(--dsh-host-hover); color: var(--dsh-host-fg); }
.dsh-session-dialog-ok {
  background: var(--dsh-host-button-bg, var(--dsh-host-accent)); color: var(--dsh-host-button-fg, #fff);
}
.dsh-session-dialog-ok:disabled { opacity: 0.5; cursor: default; }
.dsh-session-error-banner {
  margin: 8px; padding: 8px 10px; border-radius: 6px;
  background: color-mix(in srgb, var(--dsh-host-error) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--dsh-host-error) 40%, transparent);
  color: var(--dsh-host-error); font-size: 12px; word-break: break-word;
}

/* ---- 会话切换按钮:对话模式插入 session title 行内(与面包屑同行);
       空会话 hero 与 Workspaces 页用 fixed 悬浮(左上角) ---- */
.dsh-back-button {
  display: inline-flex; align-items: center; justify-content: center;
  flex: none; width: 26px; height: 26px; border-radius: 6px;
  border: none; background: transparent; color: var(--dsh-host-fg);
  cursor: pointer; padding: 0;
}
.dsh-back-button:hover { background: var(--dsh-host-hover); }
.dsh-back-button svg { width: 15px; height: 15px; }
.dsh-back-title { margin-right: 4px; }
.dsh-back-floating { position: fixed; top: 8px; left: 8px; z-index: 1000; }

/* ---- hero 背景光斑:上游 SVG 硬编码 #6187D8(去掉底色后仍透蓝光);
       CSS fill 覆盖为宿主前景色(透明度保留) ---- */
[class$="_heroGlow"] ellipse { fill: var(--dsh-host-fg) !important; }

/* ---- "Deep diving..."(turn 状态行)上游硬编码品牌蓝渐变:
       改为 VS Code 强调色渐变。注意:只用 background-image(background 简写会重置
       background-clip:text → 文字透明只剩色块),裁剪与 shimmer 动画保留 ---- */
[class$="_turnStatus"] {
  background-image: linear-gradient(
    90deg,
    var(--dsh-host-accent) 0%,
    var(--dsh-host-accent) 40%,
    color-mix(in srgb, var(--dsh-host-accent) 40%, transparent) 50%,
    var(--dsh-host-accent) 60%,
    var(--dsh-host-accent) 100%
  ) !important;
  background-clip: text !important;
  -webkit-background-clip: text !important;
}

/* ---- Phase 10 附着 UI(注入输入卡片内 textarea 上方 = "Message your agent" 位置;
       dsh-attachment-ui.js 渲染,shell.css 提供样式) ---- */
#dsh-attachment-root { position: relative; z-index: 30; }
body.dsh-sessions #dsh-attachment-root { display: none !important; }
.dsh-drop-overlay {
  position: fixed; inset: 0; z-index: 100; pointer-events: none;
  background: color-mix(in srgb, var(--dsh-host-link, #4daafc) 10%, transparent);
  display: none;
}
body.dsh-dragging .dsh-drop-overlay { display: block; }
.dsh-attach-toolbar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  padding: 4px 10px 0;
}
.dsh-attach-toolbar[hidden] { display: none; }
/* 活动文件 / 选区指示:存在 + 开启才渲染(无灰色禁用态);点击切换附着 */
.dsh-attach-indicator {
  display: inline-flex; align-items: center; gap: 5px;
  max-width: 280px; box-sizing: border-box;
  padding: 2px 10px; border-radius: 10px; cursor: pointer;
  border: 1px solid var(--dsh-host-link, var(--dsh-host-accent));
  color: var(--dsh-host-link, var(--dsh-host-accent));
  background: color-mix(in srgb, var(--dsh-host-link, #4daafc) 12%, var(--dsh-host-bg));
  font-size: 11px; line-height: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dsh-attach-indicator:hover {
  background: color-mix(in srgb, var(--dsh-host-link, #4daafc) 20%, var(--dsh-host-bg));
}
.dsh-attach-indicator[hidden] { display: none; }
.dsh-attach-indicator-icon { flex: none; display: inline-flex; }
.dsh-attach-files { display: inline-flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.dsh-attach-chip {
  display: inline-flex; align-items: center; gap: 4px;
  max-width: 240px; box-sizing: border-box;
  padding: 2px 8px; border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2, var(--dsh-host-border));
  background: var(--dsh-host-bg);
  color: var(--dsw-alias-label-secondary, var(--dsh-host-fg));
  font-size: 11px; line-height: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dsh-attach-file { max-width: 200px; }
.dsh-attach-file.warning { border-color: var(--dsh-host-warn); color: var(--dsh-host-warn); }
.dsh-attach-remove {
  border: none; background: transparent; color: inherit; cursor: pointer;
  font-size: 13px; line-height: 1; padding: 0 0 0 2px; opacity: 0.7;
}
.dsh-attach-remove:hover { opacity: 1; }
.dsh-attach-toast {
  position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%);
  z-index: 120; max-width: 86%;
  padding: 6px 12px; border-radius: 8px;
  background: var(--dsh-host-tooltip-bg); color: var(--dsh-host-error);
  border: 1px solid var(--dsh-host-error);
  font-size: 12px; line-height: 18px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
}
`;

const shortId = (id) => id.replace('@deepseek-ai/', '');

/**
 * 装配桥(静态,与 shell rev 绑定),职责:
 * 1. 首开会话:__DSH_BOOT_SESSION__ 仅在 localStorage 无 dsh.sessions.current 时写入
 *    (上游 attachPersistence 的恢复键;已有值则尊重用户上次会话);
 * 2. 主题同步:data-ds-dark-theme / color-scheme 始终跟随 VS Code 主题(matchMedia
 *    prefers-color-scheme;webview 内该媒体查询与 VS Code 主题联动),MutationObserver
 *    压过上游 ThemePresenter 按 web 偏好写的值(值变才写,防循环);
 * 3. 宿主类型:__DSH_HOST__(sidebar|panel)→ body[data-dsh-host](shell.css 主题变量切换);
 * 4. 视图:chat(对话)| sessions(独立会话管理页,web/SessionView.tsx React 视图)。
 *    对话模式:title 行左侧返回按钮(空会话 hero 用悬浮兜底);点击进入 sessions ——
 *    隐藏 #root、显示 #dsh-sessions-root(扩展自有页面,非侧边栏拉伸);会话页 header
 *    自带返回(经 __dshBridge.setView 切回)。视图偏好持久化(dsh.ui.view);
 * 5. 会话跳转桥:webview 内打开会话(React 页写 localStorage + 回传 switch-session:applied)
 *    → chat-panel 重注入 html 完成重载;扩展侧 dsh:switch-session / dsh:bootstrap-session
 *    消息 → 写 localStorage → 回 post 'switch-session:applied'(同一路径)。
 * 无 acquireVsCodeApi 的环境(纯浏览器调试/冒烟)下静默,不影响 UI。
 */
const BRIDGE_JS = `(() => {
  'use strict';
  const BOOT_SESSION_KEY = 'dsh.sessions.current';
  const VIEW_KEY = 'dsh.ui.view';
  // 消息回传宿主:VS Code webview 用 acquireVsCodeApi(官方通道);无该 API 的
  // headless/调试环境回退 window.parent.postMessage
  let vscodeApi = null;
  try { vscodeApi = window.acquireVsCodeApi(); } catch (err) { vscodeApi = null; }
  const postToHost = (message) => {
    if (vscodeApi !== null && vscodeApi !== undefined) {
      try { vscodeApi.postMessage(message); return; } catch (err) {}
    }
    try { window.parent.postMessage(message, '*'); } catch (err) {}
  };
  // 诊断:捕获上游 console(accept/adopt 注入日志)→ 回传扩展写文件
  const origLog = console.log.bind(console);
  const origError = console.error.bind(console);
  const forwardConsole = (kind, args) => {
    try {
      const text = args.map((a) => typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()).join(' ');
      if (text.includes('[dsh-settings]') || text.includes('[dsh-locale]') || text.includes('dropping malformed')) {
        postToHost({ type: 'dsh:console', kind, text: text.slice(0, 500) });
      }
    } catch (err) {}
  };
  console.log = (...args) => { forwardConsole('log', args); origLog(...args); };
  console.error = (...args) => { forwardConsole('error', args); origError(...args); };
  // 会话气泡 icon(用户要求:不用箭头;空心底,不实心)
  const SESSIONS_ICON = '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"><path d="M2 2.75A1.75 1.75 0 0 1 3.75 1h8.5A1.75 1.75 0 0 1 14 2.75v5.5A1.75 1.75 0 0 1 12.25 10H8.1l-3.5 3.1a.6.6 0 0 1-1-.46V10H3.75A1.75 1.75 0 0 1 2 8.25v-5.5Z"/></svg>';

  // 1. 首开会话(仅在无已存会话时写入)
  const bootSession = window.__DSH_BOOT_SESSION__;
  if (bootSession !== null && typeof bootSession === 'object' && typeof bootSession.sessionId === 'string') {
    try {
      if (localStorage.getItem(BOOT_SESSION_KEY) === null) {
        localStorage.setItem(BOOT_SESSION_KEY, JSON.stringify({ sessionId: bootSession.sessionId }));
      }
    } catch (err) { console.error('[dsh-bridge] boot-session:', String(err)); }
  }

  // 2/3. 宿主类型 + 主题同步(值变才写,防 MutationObserver 自激循环);
  // 脚本位于 head,body 尚未解析 —— DOM 工作统一在 DOMContentLoaded 后做
  const applyTheme = () => {
    let dark = false;
    try { dark = window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (err) { dark = false; }
    const want = dark ? '' : null;
    const got = document.body.getAttribute('data-ds-dark-theme');
    if (dark && got !== '') document.body.setAttribute('data-ds-dark-theme', '');
    else if (!dark && got !== null) document.body.removeAttribute('data-ds-dark-theme');
    const scheme = dark ? 'dark' : 'light';
    if (document.documentElement.style.colorScheme !== scheme) {
      document.documentElement.style.colorScheme = scheme;
    }
  };
  const startThemeSync = () => {
    if (window.__DSH_HOST__ === 'panel' || window.__DSH_HOST__ === 'sidebar') {
      document.body.dataset.dshHost = window.__DSH_HOST__;
    }
    applyTheme();
    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(() => { applyTheme(); });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
      observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startThemeSync);
  else startThemeSync();

  // 4. 视图:chat ↔ sessions(独立会话管理页,非侧边栏拉伸)。sessions 模式隐藏上游
  //    #root(display:none,React 树保持挂载,store 不丢),显示扩展自有页面;
  //    React 页经 __dshBridge.setView 切回 chat。
  const setView = (view) => {
    const sessions = view === 'sessions';
    document.body.classList.toggle('dsh-sessions', sessions);
    const root = document.getElementById('root');
    const sessionsRoot = document.getElementById('dsh-sessions-root');
    if (root !== null) root.style.display = sessions ? 'none' : '';
    if (sessionsRoot !== null) {
      sessionsRoot.hidden = !sessions;
      if (sessions) {
        window.dispatchEvent(new CustomEvent('dsh:view', { detail: 'sessions' }));
      }
    }
    try { localStorage.setItem(VIEW_KEY, view); } catch (err) {}
    ensureBackButton();
  };
  // 会话管理页 header 自带返回按钮(React 视图),bridge 只负责对话模式按钮:
  // 插入 session title 行左侧(与面包屑同行对齐)。React 重渲染可能清除注入节点 →
  // rAF 级重插 + document capture 事件委托(按钮被移除瞬间点击仍能命中)。
  // 空会话 hero 无 title 行 → fixed 悬浮兜底。
  const ensureBackButton = () => {
    document.querySelectorAll('.dsh-back-button').forEach((n) => n.remove());
    if (document.body.classList.contains('dsh-sessions')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dsh-back-button';
    btn.innerHTML = SESSIONS_ICON;
    const titleRow = document.querySelector('[class$="_titleRow"]');
    const header = titleRow === null ? null : titleRow.closest('[class$="_header"]');
    const headerHidden = header !== null && header.getAttribute('aria-hidden') === 'true';
    if (titleRow !== null && !headerHidden) {
      btn.classList.add('dsh-back-title');
      btn.title = 'Sessions';
      btn.setAttribute('aria-label', btn.title);
      titleRow.insertBefore(btn, titleRow.firstChild);
    } else {
      // 空会话 hero:无 title 行,固定悬浮兜底
      btn.classList.add('dsh-back-floating');
      btn.title = 'Sessions';
      btn.setAttribute('aria-label', btn.title);
      document.body.appendChild(btn);
    }
  };
  let reinsertPending = false;
  const scheduleReinsert = () => {
    if (reinsertPending) return;
    reinsertPending = true;
    requestAnimationFrame(() => {
      reinsertPending = false;
      if (!document.body.classList.contains('dsh-sessions')) {
        const titleRow = document.querySelector('[class$="_titleRow"]');
        if (titleRow !== null && titleRow.querySelector('.dsh-back-title') === null) {
          ensureBackButton();
        }
      }
    });
  };
  // 点击委托(document capture):对话模式返回按钮 → 进入会话管理页。
  // 会话页内的交互(返回/会话行/新建)由 React 视图自行处理,桥不拦截。
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('.dsh-back-button') !== null) {
      event.stopPropagation();
      setView('sessions');
      return;
    }
  }, true);
  // 应用渲染后接管:轮询等 root 就绪 → 恢复视图偏好 → 持续观察 title 行子节点变化
  const startLayout = () => {
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if ((document.body !== null && document.getElementById('root') !== null) || attempts > 100) {
        window.clearInterval(timer);
        let view = 'chat';
        try { view = localStorage.getItem(VIEW_KEY) === 'sessions' ? 'sessions' : 'chat'; } catch (err) {}
        setView(view);
        // 语言对齐:boot 后 2s 立即尝试一次(优先 setLocale 桥),之后周期检测
        window.setTimeout(() => {
          const target = window.__DSH_LOCALE__;
          if (target !== 'zh' && target !== 'en') return;
          try {
            if (typeof window.__dshSetLocale === 'function') window.__dshSetLocale(target);
            else syncLocale();
          } catch (err) { console.error('[dsh-bridge] locale:', String(err)); }
        }, 2000);
        if (typeof MutationObserver !== 'undefined') {
          const observer = new MutationObserver(() => {
            scheduleReinsert();
          });
          observer.observe(document.body, { childList: true, subtree: true });
        }
      }
    }, 150);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startLayout);
  else startLayout();

  // 5. 语言对齐(boot 竞态修复):应用 boot 后 connection 就绪,读实例 locale.preference,
  // 与 __DSH_LOCALE__(VS Code 设置)不符则 settings.update 写回 —— 服务端推送
  // settings/document-updated → 上游 locale 插件 refresh → 热切换(无需 reload)。
  // 竞态场景:boot 时 connection 未就绪 → 上游 settings 快照未加载 → 语言=浏览器语言
  // (navigator.language),且实例值已等于目标时无推送可触发 → 用"双写对调值再写回"
  // 强制推送;UI 语言已正确(检测 tab 文本)则跳过,避免无谓闪动。
  const detectUiLocale = () => {
    // 1) 会话视图:tab 文本最精确(纯 UI 词,不受会话内容污染)
    const tabs = [...document.querySelectorAll('[class$="_tab"]')];
    const tabText = tabs.map((t) => t.textContent ?? '').join(' ');
    if (tabText.includes('对话') || tabText.includes('轨迹')) return 'zh';
    if (tabText.includes('Chat') || tabText.includes('Trajectory')) return 'en';
    // 2) hero(空会话无 tab):用 hero/输入占位词条(避开会话内容)
    const rootText = document.getElementById('root')?.textContent ?? '';
    const zhMarks = ['探索未至之境', '给智能体发消息', '选择一个工作区'];
    const enMarks = ['Into the Unknown', 'Describe what you want to build', 'Choose a workspace'];
    for (const mark of zhMarks) if (rootText.includes(mark)) return 'zh';
    for (const mark of enMarks) if (rootText.includes(mark)) return 'en';
    return undefined;
  };
  const updateLocale = (base, envelope, value) =>
    fetch(base + '/api/settings.update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: envelope('settings.update', { ns: 'locale', patch: { preference: value } }),
    });
  // rpcId 必须唯一:同 rpcId 的重复请求会被服务端忽略(双写第二笔会丢)
  const rpcId = () => 'bridge-locale-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const syncLocale = () => {
    const target = window.__DSH_LOCALE__;
    if (target !== 'zh' && target !== 'en') return;
    const base = window.__DSH_WEB_URL__;
    if (typeof base !== 'string' || base === '') return;
    const envelope = (method, payload) => JSON.stringify({ type: 'client-request', rpcId: rpcId(), method, payload });
    fetch(base + '/api/settings.describe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: envelope('settings.describe', {}),
    }).then((res) => res.json()).then(async (body) => {
      const namespaces = body?.result?.value?.namespaces;
      const current = Array.isArray(namespaces)
        ? namespaces.find((n) => n.ns === 'locale')?.value?.preference
        : undefined;
      const outcome = { at: Date.now(), target, current, ui: detectUiLocale() };
      if (detectUiLocale() === target) {
        outcome.done = true;
        window.dshDiag = outcome;
        postToHost({ type: 'dsh:diag', payload: { ...collectDiag(), syncOutcome: outcome } });
        return; // UI 已是目标语言,无需干预
      }
      if (current !== target) {
        await updateLocale(base, envelope, target); // 值不同:一次写即触发推送
        outcome.step = 'single-write';
      } else {
        // 值相同但 UI 不符(boot 快照未加载):双写对调值再写回,强制推送触发上游 refresh
        const other = target === 'zh' ? 'en' : 'zh';
        await updateLocale(base, envelope, other);
        await updateLocale(base, envelope, target);
        outcome.step = 'double-write';
      }
      outcome.done = false;
      window.dshDiag = outcome;
      postToHost({ type: 'dsh:diag', payload: { ...collectDiag(), syncOutcome: outcome } });
    }).catch((err) => {
      // 实例不可达:静默记录,下次周期重试
      const outcome = { at: Date.now(), target, error: String(err) };
      window.dshDiag = outcome;
      postToHost({ type: 'dsh:diag', payload: { ...collectDiag(), syncOutcome: outcome } });
    });
  };
  // 周期重试:每 5s 直到 UI 语言与目标一致(上限 6 次,避免无限打扰)
  let syncAttempts = 0;
  const syncTimer = window.setInterval(() => {
    syncAttempts += 1;
    const target = window.__DSH_LOCALE__;
    if (detectUiLocale() === target || syncAttempts > 6) {
      window.clearInterval(syncTimer);
      return;
    }
    syncLocale();
  }, 5000);
  // 语言硬切换主通道:直接驱动上游 setLocale(官方公共方法:立即切 UI + 写回实例),
  // 绕过 settings 快照/推送链(该链在 webview 环境实测不可靠)。周期检测 UI 语言,
  // 不符则调用,直到一致或达上限。会话管理页(sessions)无上游 tab/hero,跳过检测
  // (页面语言由 __DSH_LOCALE__ 直接决定,不需要驱动)。
  let localeChecks = 0;
  const localeCheckTimer = window.setInterval(() => {
    if (document.body.classList.contains('dsh-sessions')) return; // 会话页不驱动上游语言
    const target = window.__DSH_LOCALE__;
    if (target !== 'zh' && target !== 'en') { window.clearInterval(localeCheckTimer); return; }
    if (detectUiLocale() === target || localeChecks >= 10) { window.clearInterval(localeCheckTimer); return; }
    localeChecks += 1;
    try {
      if (typeof window.__dshSetLocale === 'function') {
        const result = window.__dshSetLocale(target);
        if (typeof result === 'string') console.error('[dsh-bridge] setLocale:', result);
      } else {
        syncLocale(); // 兜底:无桥时走写实例+推送
      }
    } catch (err) {
      console.error('[dsh-bridge] setLocale:', String(err));
    }
  }, 3000);

  // 5b. 自动诊断:应用 boot 后与视图切换时采集 webview 布局/语言事实,
  // 回传扩展写入本地文件(.dsh-webview-diag.json),便于排查环境差异。
  const collectDiag = () => {
    const frame = document.querySelector('[class$="_frame"]');
    const root = document.getElementById('root');
    const sessionsRoot = document.getElementById('dsh-sessions-root');
    return {
      viewport: window.innerWidth,
      frameWidth: frame === null ? null : Math.round(frame.getBoundingClientRect().width),
      frameGrid: frame === null ? null : getComputedStyle(frame).gridTemplateColumns,
      inSessions: document.body.classList.contains('dsh-sessions'),
      rootDisplay: root === null ? null : getComputedStyle(root).display,
      sessionsRootHidden: sessionsRoot === null ? null : sessionsRoot.hidden,
      navLang: navigator.language,
      dshLocale: window.__DSH_LOCALE__ ?? null,
      uiLocale: detectUiLocale(),
      viewKey: localStorage.getItem(VIEW_KEY),
      sessionRows: document.querySelectorAll('.dsh-session-item').length,
      bootSession: (() => { try { return localStorage.getItem(BOOT_SESSION_KEY); } catch (err) { return null; } })(),
    };
  };
  let lastDiag = '';
  const reportDiag = () => {
    try {
      const payload = collectDiag();
      const json = JSON.stringify(payload);
      if (json === lastDiag) return;
      lastDiag = json;
      postToHost({ type: 'dsh:diag', payload });
    } catch (err) {}
  };
  // 诊断观察需 body 已存在(bridge 位于 head,body 解析前 observe 会抛错并中断
  // 后续桥注册 —— 曾致 __dshBridge/switch-session 监听未注册);统一 DOMContentLoaded 后启动
  const startDiag = () => {
    try {
      window.setTimeout(reportDiag, 3000); // boot 后
      if (typeof MutationObserver !== 'undefined' && document.body !== null) {
        const diagObserver = new MutationObserver(() => { reportDiag(); });
        diagObserver.observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: false });
      }
    } catch (err) { /* 诊断观察失败不影响主桥 */ }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startDiag);
  else startDiag();

  // 6. 会话跳转桥:扩展侧 dsh:switch-session / dsh:bootstrap-session → 写恢复键 →
  //    回传 applied(chat-panel 重注入 html 完成重载)。会话管理页(React 视图)直接
  //    写恢复键并回传 applied,走同一路径。
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg === null || typeof msg !== 'object') return;
    if (msg.type !== 'dsh:switch-session' && msg.type !== 'dsh:bootstrap-session') return;
    if (typeof msg.sessionId !== 'string') return;
    try {
      // 2026-08-20(问题 1 根因):切会话/新建会话时必须把视图偏好重置为 chat ——
      // 若停在 sessions 视图发起,重载后 bridge 读 dsh.ui.view 仍为 'sessions',
      // 会重新进入会话管理页,观感 = "新会话没打开"。先写两个键再回传 applied,
      // 保证 reload 时 boot 读到一致状态(会话行点击跳转在 React 页已显式写 view=chat)。
      localStorage.setItem(BOOT_SESSION_KEY, JSON.stringify({ sessionId: msg.sessionId }));
      localStorage.setItem(VIEW_KEY, 'chat');
      postToHost({ type: 'switch-session:applied', sessionId: msg.sessionId });
    } catch (err) {
      console.error('[dsh-bridge] switch-session:', String(err));
    }
  });
  // 供会话管理页(React 视图)使用:切视图 + 回传宿主
  window.__dshBridge = { setView, postToHost };
})();
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
  // 扩展自有 React 视图:会话管理页 bundle(web/session-view-main.tsx → dist/web/session-view.js,
  // 由 scripts/build.mjs 构建)。拷贝进 dsh-shell 并注入 index.html(独立于上游 #root 的页面)。
  const sessionViewSrc = join(repoRoot, 'apps', 'vscode', 'dist', 'web', 'session-view.js');
  if (!existsSync(sessionViewSrc)) {
    throw new Error(
      `会话管理页 bundle 缺失:${sessionViewSrc}(先跑 pnpm --filter dsh-for-vscode run build)`,
    );
  }
  cpSync(sessionViewSrc, join(dest, 'session-view.js'));
  // Phase 10 附着 UI bundle(web/dsh-attachment-ui.ts → dist/web/dsh-attachment-ui.js,
  // 由 scripts/build.mjs 构建):拷入 dsh-shell 并在 </body> 前注入(输入区上方工具栏)。
  const attachUiSrc = join(repoRoot, 'apps', 'vscode', 'dist', 'web', 'dsh-attachment-ui.js');
  if (!existsSync(attachUiSrc)) {
    throw new Error(
      `附着 UI bundle 缺失:${attachUiSrc}(先跑 pnpm --filter dsh-for-vscode run build)`,
    );
  }
  cpSync(attachUiSrc, join(dest, 'dsh-attachment-ui.js'));
  const shellHtml = join(dest, 'index.html');
  if (!existsSync(shellHtml)) throw new Error(`shell index.html 缺失:${shellHtml}`);
  // 绝对路径改相对;去掉 manifest/favicon(webview 内 404,同时不随 VSIX 分发);
  // 注入会话管理页挂载点(独立于上游 #root,默认 hidden,bridge 切换视图时显示);
  // 注入附着 UI 脚本(对话输入区上方工具栏 + 拖放监听)
  let html = readFileSync(shellHtml, 'utf8')
    .replace(/(src|href)="\//g, '$1="./')
    .replace(/<link rel="manifest"[^>]*>\s*/g, '')
    .replace(/<link rel="icon"[^>]*>\s*/g, '')
    .replace(/<\/body>/i, '<div id="dsh-sessions-root" hidden></div><script src="./session-view.js"></script><script src="./dsh-attachment-ui.js"></script></body>');
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
    // 适配缝 2:locale bundle 暴露 setLocale 桥 —— 语言硬切换通道(绕过 settings 快照/推送链,
    // 该链在 webview 环境实测不可靠:boot 快照加载与运行中推送均不触发语言更新)
    if (id === '@deepseek-ai/dsh-client-locale') {
      patchSetLocaleBridge(join(pluginDest, 'client.js'));
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
  // boot/bridge 放 head 开头(先于模块脚本执行);shell.css 放 </head> 前
  // (级联最后:覆盖上游设计平台 token —— 上游 ThemePresenter 会以 body 内联变量
  // 写主题 token,shell.css 用 !important 胜出)
  html = html.replace(/<head>/i, '<head><script src="./boot.js"></script><script src="./bridge.js"></script>');
  html = html.replace(/<\/head>/i, '<link rel="stylesheet" href="./shell.css" />\n</head>');
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