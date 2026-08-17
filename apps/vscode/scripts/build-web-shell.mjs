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
 * - Workspaces 模式(body.dsh-workspaces):#root 撑宽到 1100px(> SIDEBAR_AUTO_COLLAPSE=1024,
 *   让 AppFrame 判定非窄布局 → 侧边栏渲染宽版工作区浏览器),frame 网格强制 280|1fr|0,
 *   可视区恰为左侧 280px 侧边栏内容(原侧边栏内容的独立页面)。
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

/* ---- Workspaces 模式:原侧边栏内容整页呈现。
       窄 webview(<1100px,VS Code 侧边栏):root 撑宽到 1100(> SIDEBAR_AUTO_COLLAPSE,
       AppFrame 判定非窄布局 → 侧边栏渲染宽版浏览器),中心列 0 宽,可视区恰为
       280px 侧边栏(其余为宿主底色,无错位);
       宽 webview(≥1100px,编辑器面板):root 跟随 100vw,280px 侧边栏 + 中心列正常显示,
       等效浏览器布局,自适应窗口尺寸。 ---- */
body.dsh-workspaces { overflow: hidden !important; }
body.dsh-workspaces #root { width: max(1100px, 100vw) !important; }
body.dsh-workspaces [class$="_frame"] { grid-template-columns: 280px minmax(0, 1fr) 0px !important; }
@media (max-width: 1099px) {
  body.dsh-workspaces [class$="_frame"] { grid-template-columns: 280px 0px 0px !important; }
}
body.dsh-workspaces [class$="_logoRow"] { display: none !important; }

/* ---- 返回按钮:body 直接子元素的固定悬浮按钮(React 重渲染不清除,点击恒有效);
       对话模式位于左上角,title 行 padding 让位对齐;Workspaces 模式同位置返回 ---- */
.dsh-back-button {
  position: fixed; top: 8px; left: 8px; z-index: 1000;
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border-radius: 6px;
  border: none; background: transparent; color: var(--dsh-host-fg);
  cursor: pointer; padding: 0;
}
.dsh-back-button:hover { background: var(--dsh-host-hover); }
.dsh-back-button svg { width: 15px; height: 15px; }
.dsh-back-workspaces {
  background: var(--dsh-host-bg); border: 1px solid var(--dsh-host-border);
  box-shadow: 0 1px 4px color-mix(in srgb, #000 25%, transparent);
}
.dsh-back-workspaces:hover { background: var(--dsh-host-hover); }
[class$="_titleRow"] { padding-left: 36px !important; }

/* ---- hero 背景光斑:上游 SVG 硬编码 #6187D8(去掉底色后仍透蓝光);
       CSS fill 覆盖为宿主前景色(透明度保留) ---- */
[class$="_heroGlow"] ellipse { fill: var(--dsh-host-fg) !important; }
`;

const shortId = (id) => id.replace('@deepseek-ai/', '');

/**
 * 装配桥(静态,与 shell rev 绑定),五个职责:
 * 1. 首开会话:__DSH_BOOT_SESSION__ 仅在 localStorage 无 dsh.sessions.current 时写入
 *    (上游 attachPersistence 的恢复键;已有值则尊重用户上次会话);
 * 2. 主题同步:data-ds-dark-theme / color-scheme 始终跟随 VS Code 主题(matchMedia
 *    prefers-color-scheme;webview 内该媒体查询与 VS Code 主题联动),MutationObserver
 *    压过上游 ThemePresenter 按 web 偏好写的值(值变才写,防循环);
 * 3. 宿主类型:__DSH_HOST__(sidebar|panel)→ body[data-dsh-host](shell.css 主题变量切换);
 * 4. 布局:对话模式 → title 行左侧返回按钮(空会话 hero 用悬浮兜底);点击进入
 *    Workspaces 模式(原侧边栏内容整页,body.dsh-workspaces);工作区页点会话行/
 *    新建按钮自动返回;视图偏好持久化(dsh.ui.view);
 * 5. 会话切换桥(既有):'dsh:switch-session' → localStorage 写 dsh.sessions.current
 *    → 回 post 'switch-session:applied'(chat-panel 重注入 html 完成重载)。
 * 无 acquireVsCodeApi 的环境(纯浏览器调试/冒烟)下静默,不影响 UI。
 */
const BRIDGE_JS = `(() => {
  'use strict';
  const BOOT_SESSION_KEY = 'dsh.sessions.current';
  const VIEW_KEY = 'dsh.ui.view';
  const CHEVRON = '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="10,2 4,8 10,14"/></svg>';

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

  // 4. 布局:固定悬浮返回按钮(body 直接子元素 —— React 不管理 body 直接子节点,
  // 应用重渲染不会移除按钮,点击永远有效;位置由 shell.css fixed 定位 +
  // title 行 padding 让位对齐)。点击切换对话/Workspaces 视图。
  const makeButton = () => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dsh-back-button';
    b.innerHTML = CHEVRON;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      setView(document.body.classList.contains('dsh-workspaces') ? 'chat' : 'workspaces');
    });
    return b;
  };
  let backButton = null;
  const setView = (view) => {
    document.body.classList.toggle('dsh-workspaces', view === 'workspaces');
    try { localStorage.setItem(VIEW_KEY, view); } catch (err) {}
    if (backButton === null || !backButton.isConnected) {
      backButton = makeButton();
      document.body.appendChild(backButton);
    }
    const inWorkspaces = view === 'workspaces';
    backButton.classList.toggle('dsh-back-workspaces', inWorkspaces);
    backButton.title = inWorkspaces ? '返回对话' : 'Workspaces';
    backButton.setAttribute('aria-label', backButton.title);
  };
  // 应用渲染后接管:轮询等 body 就绪 → 恢复视图偏好(按钮与类即刻就位)
  const startLayout = () => {
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (document.body !== null && document.getElementById('root') !== null || attempts > 100) {
        window.clearInterval(timer);
        let view = 'chat';
        try { view = localStorage.getItem(VIEW_KEY) === 'workspaces' ? 'workspaces' : 'chat'; } catch (err) {}
        setView(view);
      }
    }, 150);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startLayout);
  else startLayout();

  // 5. Workspaces 页:点击会话行/顶部新建按钮 → 自动返回对话
  document.addEventListener('click', (event) => {
    if (!document.body.classList.contains('dsh-workspaces')) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const sessionRow = target.closest('[class$="_sessionRow"]');
    const newSession = target.closest('[class$="_newSession"]');
    if (sessionRow !== null || newSession !== null) {
      window.setTimeout(() => { setView('chat'); }, 150);
    }
  }, true);

  // 6. 会话切换桥(既有 + Phase 9 bootstrap:同一写入路径,不同消息名)
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg === null || typeof msg !== 'object') return;
    if (msg.type !== 'dsh:switch-session' && msg.type !== 'dsh:bootstrap-session') return;
    if (typeof msg.sessionId !== 'string') return;
    try {
      localStorage.setItem(BOOT_SESSION_KEY, JSON.stringify({ sessionId: msg.sessionId }));
      window.parent.postMessage({ type: 'switch-session:applied', sessionId: msg.sessionId }, '*');
    } catch (err) {
      console.error('[dsh-bridge] switch-session:', String(err));
    }
  });
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