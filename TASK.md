# TASK.md — dsh-for-vs-code 实施任务书

> **当前进度**：Phase 5–10 全部完成。UI 路线 = Route A（vendor 源码构建）。

## 0. 目标

VS Code 扩展作为 `dsh web`（127.0.0.1:3080）的第二个 viewer：
**UI = dsh 原生 React 组件（vendor 源码构建）**，布局与浏览器版一致。
不内嵌 runtime、不另起实例、API key 不进扩展。

### 路线 A（源码构建；替代旧 fetch+boot）

- **vendor/deepseek-harness**（submodule，只读，rev `99f6f02` = rc.7）
- **vendor 内独立 workspace 构建**：`build:lib:client` + `build:web`
- **装配脚本 build-web-shell.mjs**：拷贝 shell → 拷贝 client 插件 → 静态组图 → 自产 index.html → resolveBase 适配缝
- **运行时不变**：webview 经扩展侧 HTTP+WS 代理（Origin 栅栏绕行）

### 红线（与 AGENTS.md 一致）

- 不 fork 上游、不改 vendor 源码、不改 packages/core / agent-loop
- UI 由上游组件驱动；扩展不自维护 messages[]
- 文件写走 WorkspaceEdit；terminal 走 VS Code API；runtime.ts 只做传输

### 版本锁定

- 运行时：dsh 0.1.0-rc.7 @ 3080
- UI 源码：rc.7 = `99f6f02`（记入 docs/versions.md）
- 升级只做专项 + 全量回归

## 1. 技术基线

- 环境：node ≥ 22.19 / pnpm 10.32.1（外层）/ corepack pnpm 11.7.0（vendor）
- G0 提交门：`pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build`
- 冒烟：`node apps/vscode/scripts/smoke-shell.mjs`（headless Chrome，3 个并行子测试）
- 集成测试标 `@live`（`LIVE_3080=1` 才跑），无服务可跳过
- git：只 `git add <具体路径>`，commit 后立即 push，`feat|fix|chore|refactor|docs:` 前缀

## 2. 阶段进度

### Phase 5：vendor 构建打通 ✅

- [x] P5-1 submodule 锁定 → docs/versions.md
- [x] P5-2 vendor workspace 安装
- [x] P5-3 `build:lib:client` + `build:web` 产出验证
- [x] P5-4 装配脚本 build-web-shell.mjs（拷贝 + 组图 + index.html + resolveBase）
- [x] P5-5 面板接线 + headless E2E（smoke-shell.mjs）
- [x] P5-6 G0 四门 + 提交

### Phase 6：定制适配 ✅

- [x] P6-1 boot 图裁剪（39→31 插件，ref-graph 断言一致）
- [x] P6-2 侧边栏适配（shell.css 透明 + 窄布局原生可用）
- [x] P6-3 主题对齐（透明走静态 CSS，组件表面色由上游决定）
- [x] P6-4 扩展壳接线（`__DSH_WEB_URL__` 注入 + proxy.setTarget）
- [x] P6-5 G0 + smoke 通过

### Phase 7：功能验证与清理 ✅

- [x] P7-2 自研 UI 清理（web/* 聊天 UI 9 文件移除，G0 49 tests 绿）
- [x] P7-3 文档同步（AGENTS.md / README / gaps.md / versions.md）
- [x] P7-4 G0 + 手动测试清单
- [ ] P7-1 全功能回归（人工，待用户执行）

### Phase 8：交付门 ✅

- [x] P8-1 G1 审查 PASS（docs/reviews/phase-5.md）
- [ ] P8-2 G2 交付门（全量回归 + G0 + smoke）
- [ ] P8-3 tag + 发布文档

### Phase 9：UI/UX 定制 ✅

- [x] P9-1 布局（侧边栏隐藏，返回按钮 → Workspaces 独立页面）
- [x] P9-2 视图精简（VS Code 侧边栏只保留 Chat webview）
- [x] P9-3 主题同步（`--dsw-*` 全量映射 + heroGlow 覆盖）
- [x] P9-4 首开体验（`__DSH_BOOT_SESSION__` 自动进入当前工作区）
- [x] P9-5 设置映射（agentPreset / permission / locale / theme / busyEnter 双向同步）
- [x] P9-6 G0 + smoke + 三视图截图验证

### Phase 10：文件/选区附着 ✅

- [x] P10-1 高级模型规格询问（docs/prompt-attach-vscode-files.md）
- [x] P10-2 Explorer 文件原生拖入附着（text/uri-list + chip UI + 1MiB/20k/100k 上限）
- [x] P10-3 附着活动文件（设置 + 指示 + 发送瞬间快照）
- [x] P10-4 附着活动选区（设置 + 指示 + 多光标 + 整文件去重）
- [x] P10-5 G0 + smoke 扩展断言 + 手动清单

## 3. 阶段门

- **G0 提交门**：typecheck / lint / test / build 全绿
- **G1 阶段审查**：独立 reviewer 出具 PASS/FAIL
- **G2 交付门**：全量回归 + G0 + smoke + 手动清单
- Review 记录：`docs/reviews/phase-<n>.md`

## 4. 风险登记

| # | 风险 | 缓解 |
|---|------|------|
| R1 | vendor 升级导致协议漂移 | 锁 rev + 升级专项 + 全量回归 |
| R2 | resolveBase 适配缝随上游漂移 | 断言式替换，缺文本即构建失败 |
| R3 | 静态组图与上游不一致 | 与 ref-graph 断言集合核对 |
| R4 | 上游输入框冻结，附着 UI 只能桥注入 | 沿用 document capture + MutationObserver 模式 |
| R5 | webview 拖放可靠性 | document 级 capture + 降级入口（命令/QuickPick） |

## 5. 已退役方案（存档）

- **fetch+boot**（fetch-dsh-ui.mjs）：产物对着活 3080 抓取，不可复现；debugBridge 模板字符串注入 minified shell（转义坑两次咬人）；已被 Route A 取代（c9f0350 删除）
- **112GT 参考路线**（vendored runtime + spawn sidecar + 自研 chat UI）：违反红线（Route B 内嵌 runtime），不采纳
