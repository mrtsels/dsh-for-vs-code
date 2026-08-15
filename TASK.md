# TASK.md — dsh-for-vs-code 实施任务书(2026-08-15 重写:UI 组件复用路线)

> 本版重写原因:**UI 路线更正**(2026-08-15):不再自研简化 webview UI,不再 iframe 内嵌 3080;
> 改为 **vendor 上游 client 源码 + 定制装配**——直接复用 dsh 浏览器端的原生 React 组件
> (packages/client/*),在扩展内用自定义 boot 图装配成 VS Code 侧边栏形态(对齐 claude code / codex 扩展做法)。
> 既有协议层(runtime/wire/session-manager/controller)全部保留复用。

## 0. 目标与路线

### 0.1 目标

VS Code 扩展作为本地 dsh web 实例(127.0.0.1:3080)的第二个客户端(映射同一 runtime,不另起实例)。
**UI = dsh 原生 React 组件**(packages/client/ui-*),布局与浏览器版一致但做侧边栏定制适配。

### 0.2 路线(与上游的关系)

- **UI 复用 = git submodule + pnpm workspace**:上游 deepseek-harness 以 submodule 引入
  (vendor/deepseek-harness,锁定 rev),扩展 webview 直接 import `@deepseek-ai/dsh-client-web`
  等 client 包;上游包全部进 workspace 解析,构建时打包进 webview bundle。
- **只读引用,不 fork 不改**:vendor 内不改任何上游源码;升级 = submodule update + 全量回归。
- **定制装配 = 自定义 boot 图**:`AppWebEntry(el).run()` 读 `window.__DSH_BOOT__` 决定装配——
  扩展构造自己的 boot 图:只装配侧边栏需要的插件子集(会话/聊天/工具/子代理/goals/jobs 等),
  排除宽屏设置面;ui-layout 官方 narrow-viewport 折叠链自动适配侧边栏宽度。
- **排除项(保持现状)**:changes 改动审查面板(扩展自研 WorkspaceEdit 回滚)继续用自研 webview;
  协议层(runtime/wire/session-manager/controller)保留。

### 0.3 与既有红线的关系(AGENTS.md 同步修订)

- "不 fork 上游、不改 packages/core/agent-loop" ✅ 保持(submodule 只读)
- "UI 只从 session/event 渲染" → 修订:UI 由上游组件 + 上游 connection 层驱动(上游自带事件模型,
  扩展不做自维护 messages[])
- "webview 安全:CSP 无 inline script;script-src 仅自身" ✅ 保持(client bundle 本地打包,不加载 remote script)

## 1. 技术基线

- 环境:node ^22.19 || >=24;本机 node v22.22.3 / pnpm 10.32.1 / dsh 0.1.0-rc.6 @ 3080
- 上游:deepseek-ai/deepseek-harness(monorepo),client 端 = `packages/client/*` + `apps/web`
- 协议:POST /api/<method> unary + WS /api/events.{mux,host}(文档见 docs/http-bridge.md)
- 测试:G0 = pnpm typecheck / lint / test / build;集成测试标 @live
- git:只 add 具体路径;commit 后立即 push;`feat|fix|chore|refactor:` 前缀

## 2. 阶段计划(重排)

### Phase 5:vendor 引入与构建打通(UI 组件复用基座)

- [ ] P5-1 submodule 引入:vendor/deepseek-harness @ master(锁定 rev;git add .gitmodules + 提交)
- [ ] P5-2 workspace 接入:pnpm-workspace.yaml 加入 vendor/deepseek-harness/packages/*
      + apps/web;安装依赖(cordis/react/vite 全家桶)
- [ ] P5-3 构建打通:build.mjs 新增 webview 入口——上游 vite 配置(复制 apps/web/vite.config.ts 模式)
      产出 dist/web/dsh-shell.js(含 AppWebEntry + client 包 bundle)
- [ ] P5-4 最小 boot:webview 加载 `new AppWebEntry(el).run()`,boot 图 = **全量插件**(与 3080 相同),
      connection 指向 http://127.0.0.1:3080 → 验证完整浏览器 UI 在侧边栏 view 中渲染(等同 3080 布局)
- [ ] P5-5 G0 四门 + 冒烟(活动栏 view 显示完整 UI)
- [ ] P5-6 记录 docs/versions.md 上游 rev

### Phase 6:定制适配(侧边栏形态)

- [ ] P6-1 定制 boot 图:插件子集(ui-layout/sidebar/conversation/primitives/slots/theme/tool/
      input-trigger/model-selection/jobs/subagent/goal/skill/user-questions/commands + runtime 链),
      排除 ui-settings*/plan/deliverables/workflow-run/agent-preset/permission-presets
- [ ] P6-2 侧边栏适配:验证 ui-layout narrow-viewport 折叠链;必要时注入侧边栏专用 CSS
      (VS Code 主题变量对齐:背景/前景/强调色)
- [ ] P6-3 主题对齐:webview body 背景 = --vscode-sideBar-background 等;iframe 移除(纯本地 bundle)
- [ ] P6-4 扩展壳接线:ChatViewProvider 加载 dsh-shell;连接状态/切换 baseUrl 注入 boot 图
- [ ] P6-5 G0 + 冒烟(侧边栏形态 UI,窄屏布局正常)

### Phase 7:功能验证与清理

- [ ] P7-1 全功能回归:会话新建/切换/fork、聊天流式、工具调用、审批、subagent 打断、
      goals、jobs、改动审查(自研面板仍工作)
- [ ] P7-2 自研 UI 清理:web/App.tsx、ChatView、SessionList、InsightsTabs、StatusBar、
      bridge-client、web/main.tsx 移除(dead code);bridge.ts 消息面按需保留(changes 面板)
- [ ] P7-3 文档同步:AGENTS.md(UI 红线修订)、README(架构图更新)、docs/gaps.md
- [ ] P7-4 G0 + 手动测试清单 docs/manual-tests/phase-5.md

### Phase 8:交付门

- [ ] P8-1 G1 审查(Phase 5+6)FAIL→修复
- [ ] P8-2 G2 交付门(全量回归 + §7 Checkbox 更新)
- [ ] P8-3 tag + 发布文档

## 3. 阶段门与验收(沿用)

- G0 提交门:typecheck / lint / test / build 全绿;集成测试 @live 可跳过
- G1 每阶段独立审查(独立 reviewer);P0/P1 未清即 FAIL
- G2 交付门:全量 §6.4 类核查 + §7 Checkbox
- Review 记录:docs/reviews/phase-<n>.md;进度快照更新于本文件顶部

## 4. 风险登记(§8 更新)

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | vendor 上游后上游大版本漂移 | 构建/协议破坏 | 锁 rev;升级只做专项 + 全量回归 |
| R2 | client 依赖闭包大(pnpm install 重) | 安装慢/冲突 | workspace 按需;pnpm 缓存 |
| R3 | 上游窄窗口布局不满足侧边栏 | 布局错乱 | ui-layout 官方折叠链 + 定制 CSS;兜底:布局参数注入 |
| R4 | 上游 boot 机制变更(AppWebEntry 签名) | 定制装配失效 | 锁 rev;升级专项 |
| R5 | 自研协议层与上游 connection 层重复 | 双通道漂移 | 评估:优先上游 connection(本地 bundle 直连 3080);自研层仅保留 changes 面板用途 |

## 5. 执行

按 Phase 5→8 顺序;每完成一步在 TASK.md 打勾;卡住即调整并记录原因。
