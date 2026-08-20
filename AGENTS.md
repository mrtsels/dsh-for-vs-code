# AGENTS.md — dsh-for-vs-code

DeepSeek Harness（`dsh`）的 VS Code 客户端：复用上游 Agent Runtime / Cordis / Tools / Session / MCP / Skills，把浏览器 Web UI 换成 VS Code Extension + Webview。插件是**现有 `dsh web` 实例的客户端**——映射 127.0.0.1:3080 的同一 runtime，不另起实例、不内嵌 runtime。

**UI 路线（Route A，2026-08-17 起）**：UI = dsh 上游原生 React 组件，从锁定 rev 的 `vendor/deepseek-harness` 源码构建装配（`apps/vscode/scripts/build-web-shell.mjs` → `dist/web/dsh-shell/`），不 fetch 活实例产物、不注入 minified 产物。执行细节（阶段、checklist、Review 门、风险表）以 [TASK.md](TASK.md) 为准。

**架构导航（必读）**：本仓库的完整架构全图（分层、模块目录地图、数据流、wire 协议、构建管线、文件→功能速查表）在 **[ARCH.md](ARCH.md)**。coding agent 定位/修改代码的固定流程：**① 先读 ARCH.md 定位功能所属模块与首选文件 → ② 读本文件的红线/规范/pitfalls 确认约束 → ③ 动手修改 → ④ 修改涉及架构变更（新增/删除模块、命令、消息类型、帧类型、构建流程、状态机）时，在同一 commit 内按 ARCH.md §8 维护规则同步更新 ARCH.md**。

## 红线（违反即 Review FAIL）

- 不 fork 上游、不改 `vendor/deepseek-harness` 内任何源码、不改 `packages/core` / `agent-loop`；禁止 **Route B**（内嵌 runtime）与 **Route C**（重写 loop）（TASK §0.2）
- 新能力挂官方扩展点：UI → `ctx.agents` + `session/event`；tool → `ctx.tools`；shell → `ctx.shell`；fs → `ctx.fs`；model → `ctx.llm`
- `src/agent/runtime.ts` 只做传输：不缓存状态、不含业务逻辑（薄桥）
- UI 由上游组件 + 上游 connection 层驱动（事件模型在上游）；扩展不自维护 messages[]；model-visible ⟺ logged；自研 webview 仅限 changes 面板
- 文件写走 VS Code WorkspaceEdit（或 T-1 快照 diff + 回滚方案）；terminal 走 VS Code Terminal API，禁裸 `child_process`（例外：只读 CLI 封装如 `git.ts` 的 `execFile` 仅用于查询类命令，须注释声明用途；agent 执行路径一律 Terminal API）

## 代码规范

- ESM everywhere（`"type": "module"`）；TypeScript `strict`，协议边界窄化点注释，无 `any`
- **注册即 effect**：`ctx.on` / `onDid*` / 事件订阅必须返回 disposer；deactivate 全量清理；activate 幂等
- 错误处理：空 `catch` 写明吞掉什么（且 try 只包一条语句）；网络路径（超时/断连/重连/退避）失败对 UI 可见；序列化/解析失败显式报错，不静默丢消息
- 开关判别用 discriminated union，收口 `assertNever`；在 parser/模型/wire/进程边界做校验，不信任类型系统之外的运行时防御
- 命名：标识符/命令英文，文档中文；命令与 view ID 统一 `deepseekHarness.*` 前缀
- webview 安全：CSP 无 inline script（注入脚本用 nonce）；postMessage 入参白名单结构校验；禁 `dangerouslySetInnerHTML`（markdown 白名单渲染）；API key/credentials 不下发 webview、不进事件渲染

## 协议与版本

- **锁 dsh 版本**（运行时 0.1.0-rc.6 @ 3080；UI 源码 rev rc.7 = `99f6f02`，记入 docs/versions.md）；升级只做专项 + 全量回归（R1/R4）
- 端点 `POST /api/<method>`（裸 `/api` 404）；信封 `{type:"client-request", rpcId, method, payload}` → `server-response`；WS 帧为 `server-request`（host→client）。协议细节见 `docs/http-bridge.md`
- 服务仅绑 127.0.0.1、无鉴权：禁 `--host 0.0.0.0`；信任栅栏 loopback / `trustedHosts`，失败 403
- 实例 cwd 绑定：握手后对比 `host.describe.cwd` 与工作区，不一致必须警告（P1-15）
- **Origin 栅栏**：webview 直连 3080 的 /api 一律 403（栅栏要求同源）；扩展进程内 HTTP+WS 转发代理（`src/vscode/proxy.ts`，127.0.0.1 随机端口）改写 origin/host 为目标同源，webview 的 runtime 经 `__DSH_WEB_URL__` 连代理

## 工具链

- 环境：node `^22.19 || >=24`；本机 node v22.22.3 / pnpm 10.32.1（外层）/ corepack pnpm 11.7.0（vendor）/ dsh 0.1.0-rc.6
- 服务：`npx @deepseek-ai/dsh web` → http://127.0.0.1:3080；健康检查 `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3080/`（不靠浏览器）
- **G0 提交门**（commit 前全绿）：`pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build`
- **vendor 构建**（在 `vendor/deepseek-harness/` 内执行，产物不入外层 workspace）：
  `corepack pnpm install --ignore-scripts`（lefthook postinstall 在 submodule 下失败，与构建无关）→
  `corepack pnpm run build:lib:host`（typert 契约，client 类型依赖）→ `build:lib:client` + `build:web`；
  UI 装配：`pnpm --filter dsh-for-vscode run build:shell`（即 build-web-shell.mjs）
- **vendor 源码更新后必须 rebuild lib 产物**：`build-web-shell.mjs` 从 `vendor/lib/client.js` 拷贝插件，不从源码构建。只改 vendor 源码不 rebuild → shell 产物仍是旧版（已踩坑：rc.7 源码已 rename "code" → "PTC"，但 lib 产物仍是 "Code mode"）。正确流程：`corepack pnpm run build:lib:client` → `pnpm build:shell`
- 冒烟：`node apps/vscode/scripts/smoke-shell.mjs`（headless Chrome + Origin 中继，断言语义见脚本）
- 测试：连 3080 的集成测试标 `@live`（需 `LIVE_3080=1` 环境变量才跑），无服务/无 key 时可跳过且保持全绿
- git：只 `git add <具体路径>`，禁 `add .` / `-A`；commit 后立即 push；信息用 `feat|fix|chore|refactor|docs:` 前缀

## Pitfalls（实测）

### 基础环境
- `dsh web` 不自动开浏览器，只打印 URL；前台进程，后台实例随会话结束而死
- headless/未配模型（`agent-default-model` / `DEEPSEEK_API_KEY`）退出码 1；headless 无 JSON 输出，stdout 即答案
- dev preview：上游 master（rc.5）与已装版本（rc.6）可能不一致，以 `dsh --version` 实测为准
- 上游约定：注册即 effect；model-visible ⟺ logged；插件而非改 loop；misconfiguration 启动即报错，不静默跳过
- `references/` 已 gitignore（本地才有设计草案），公开仓库见不到属正常；执行基准是 TASK.md

### 构建产物
- **resolveBase 适配缝**（build-web-shell.mjs）
  - 上游 connection 构建产物的 base 解析三元表达式被断言式替换为 `__DSH_WEB_URL__` 优先
  - 改 vendor rev 后若构建报「适配缝失配」，说明产物文本已变，先看产物再更新缝
  - 验证对象是 `plugins/@deepseek-ai/dsh-client-connection/client.js`，不是源码
- **vendor lib 产物过期陷阱**（2026-08-18 实测）
  - vendor 源码更新后若只跑 `build:shell` 而不先 `build:lib:client`，shell 拷贝的插件仍是旧版 lib
  - 症状：源码已改名但 UI 显示不变
  - 排查：`grep presetCodeName vendor/.../lib/client.js` 对比源码
  - 正确流程：`corepack pnpm run build:lib:client` → `pnpm build:shell`
- **裁剪图参考**（`scripts/ref-graph-rc6.json`）
  - 裁剪模式与参考集做精确断言
  - 上游新增/改名 client 包会触发失败——有意变更则同步更新参考
- **mux 存在二进制帧**：上游客户端（rc.5/rc.6 一致）丢弃非文本帧，属已知行为非回归；UI 依赖的帧均为文本
- **vendor 类型导入基础设施**（2026-08-18）
  - tsconfig paths + esbuild alias 配置了 4 个 vendor 包的解析路径
  - 扩展侧代码可通过标准 import 引入上游类型
  - **当前 wire.ts 保留本地类型定义**（上游更精确：branded RpcId、非泛型 RpcResult、discriminated MuxFrame），仅记录映射关系
  - 直接 re-export 会导致消费者类型不兼容。迁移策略见 docs/dedup-plan.md
- `/plugins/events`（HMR dev SSE）在无 dev server 时 404，无害
- 上游 rc.5 源码构建产物与 rc.6 npm 产物字节级一致（实测），UI 侧协议漂移风险低；升级仍须全量回归

### Webview 桥接
- **webview 内「新会话」走扩展**
  - 上游 startSession 落在最近 workspace（recentWorkspaceId），不保证链接 VS Code 目录
  - bridge 在 document capture 拦截 `[class$="_newSession"]`/logo wordmark（停止传播，上游不触发）
  - → postMessage dsh:new-session → 扩展 ensureFolderSession（当前目录）→ bootstrap-session → reload 进入
  - VIEW_KEY 置 chat 保证回到对话页
- **会话切换按钮插 title 行内**（用户要求，2026-08-18）
  - 上游组件重渲染会清除注入节点 → MutationObserver（rAF）重插 + document capture 事件委托
  - 空会话 hero 无 title 行 → fixed 悬浮兜底
  - Workspaces 页顶部 fixed 返回
- **webview 内 acquireVsCodeApi 只能 acquire 一次**（2026-08-20 实测根因）
  - VS Code 预加载脚本对第二次调用抛 'An instance of the VS Code API has already been acquired'
  - 二次 acquire 失败后的 window.parent.postMessage 回退在真实 webview 是**自我投递（静默丢弃）**
  - headless 能过只因 harness 帧真的接收
  - 自建 React 视图回传宿主必须走 `window.__dshBridge.postToHost`（bridge.js 在 head 持有唯一 acquire）
- **VS Code webview 默认样式给 body 注入 `padding: 0 20px`**（2026-08 实测）
  - `@layer vscode-default` 是 VS Code 在 webview 文档加载后插入的默认样式
  - 透明 padding 区会露出宿主深色背景 → 页面两侧「黑边」（headless 无此注入，复现必须模拟）
  - 修复：shell.css 顶部 `body { padding: 0 !important; }`（unlayered 规则压过 layer）
  - 改 `@layer` 里任何默认行为后，记得核对 vscode-default 全文

### 上游 UI 定制
- **heroGlow 是硬编码 SVG 色**（#6187D8，不读 token）
  - 去掉底色后仍透蓝光，shell.css 用 `[class$="_heroGlow"] ellipse { fill: var(--dsh-host-fg) !important; }` 覆盖
- **主题 token 三层**：上游 ThemePresenter 会把主题 token 写成 body 内联变量（压过普通样式表），shell.css 的映射必须 `!important`；body 有 `data-ds-dark-theme` 属性选择器时映射要双写
- **会话历史里的错误卡片是数据**：smoke 的白屏检测看 rootChildren + pageerror，勿用 `[class*="error"]` 判断 UI 故障（上游正确渲染会话内错误消息）
- 设置写回统一走 `settings.update({ns, patch})`（上游 store 同款）；`settings.mutate` 载荷不同，勿混用；permission 命名空间 schema 只有 `defaultPreset` 可写（`preference` 是运行态镜像，写了无效）
- **「Deep diving...」 状态行**：上游硬编码品牌蓝渐变做 shimmer 文字
  - shell.css 覆盖为 `--dsh-host-accent` 渐变
  - **必须用 background-image 而非 background 简写**（简写会重置 background-clip:text → 文字透明只剩色块）
  - background-clip/-webkit 前缀显式保留
- **目录选择走 native plugin，不走 browse**（2026-08-18 实测）
  - `conversation.hero.workspace.directoryFlow` slot 的 occupant 决定 "Add workspace..." 点击后的行为
  - Route A 排除 browse、保留 native；native occupant 不渲染任何 UI，直接调 `host.pickDirectory` RPC
  - → proxy 拦截 → `vscode.window.showOpenDialog()` → 返回路径
  - **不要拦截 `host.listDirectory`**（语义是列出目录内容，不是选择目录）
- **会话管理页 = 扩展自有 React 视图**（2026-08-19 起，取代拉伸侧边栏）
  - 上游没有独立会话管理页（WorkspaceBrowser 就是侧边栏），且其 store 在 React context 内不可外部调用
  - 方案 = web/SessionView.tsx（esbuild IIFE → dist/web/session-view.js，由 build-web-shell.mjs 拷入 dsh-shell）
  - bridge 切 `chat`↔`sessions`（sessions 隐藏 #root=display:none 保 store、显示自有页）
  - 数据走 `__DSH_WEB_URL__` 代理调 session.list RPC；跳转 = 写 dsh.sessions.current + 回传 switch-session:applied
  - 子代理嵌套父行（递归折叠），行尾 ⋯ 菜单 = 重命名/分叉/归档
  - 改 vendor rev 后若注入或拷贝失败，先看装配产物再更新脚本（验证：dist/web/dsh-shell/index.html 的 `</body>` 前）

### Locale 同步
- **locale 由 settings 快照决定，但 boot 加载是竞态**（实测）
  - connection 未就绪时上游 settings.describe 失败 → 快照 undefined → 语言 = navigator.language
  - 且实例值已等于目标时无推送可触发 → 永不纠正
  - 修复：注入 `__DSH_LOCALE__`（VS Code 设置），bridge 检测 UI 语言 → 不符则写实例触发推送
  - 值相同用「双写对调值再写回」强制推送
- **locale 运行中不热切换**（实测）
  - settings.update 写 locale.preference 后，已打开的 webview 界面语言不变（仅 boot 时应用）
  - 扩展在写回成功后重载 webview（settings-bridge onLocaleApplied → chat-panel reload）
  - 语言对齐主通道 = bridge 的 `__DSH_LOCALE__` 同步（boot 后自动，无需 reload）

### 注入脚本陷阱
- **MutationObserver 必须防自激循环**（2026-08-21 实测）
  - 观察 body 子树的 MutationObserver 若在回调里无条件重渲染（即使 DOM 未变）→ rAF 级无限循环
  - 守卫：回调里只在「注入根丢失」（root 未 connected）时才重建+重渲染；根存在则直接跳过
  - 附着 UI（web/dsh-attachment-ui.ts）即此范式；title 行注入只做幂等查询不写 DOM，不受影响

### 附着系统（Phase 10）
- **拖放 MIME**
  - Explorer→webview 的标准 MIME 是 `text/uri-list`（每行一个 URI，非 JSON）
  - OS 桌面拖入是 `Files`，webview 内取路径只能 feature-detect `globalThis.webUtils.getPathForFile`（Electron 能力，非 VS Code API 合约，拿不到就降级提示）
  - webview 只传 URI，内容一律扩展侧 `workspace.fs` 发送时读取（1 MiB 上限/二进制 NUL 检测/20k 截断/总量 100k/目录拒绝）
- **注入位置**
  - 上游输入框冻结 → 附着 UI 走 bridge 注入（dsh-attachment-ui.js，装配时拷入 dsh-shell 并注入 `</body>` 前）
  - 附着条注入输入 composer 座位容器（`[data-composer-seat]`）最前 = 输入框正上方
  - **不触碰输入卡片内部**（上游 card 是 React 管理的 flex 布局，插入子节点会破坏 textarea 排版）
  - 指示**存在即显示**（无内容完全不显示，无禁用灰态；开关只决定是否随消息附着）
- **dsh-file-attach 插件**（2026 创造模式，源码存盘 `dsh-file-attach/`）
  - 装配点 = `agent/pre-step` waterfall（model-visible ⟺ logged 由构造保证）
  - cordis Package 是完整快照：双半改动必须同包提交，只传 client 会丢 Host half
  - **建议附着 API**：Host `dsh-file-attach:suggest/suggest-remove/suggest-clear`；Client 虚线建议 chip + 「+」点击正式附着
  - 公开 wire 通道 = `dynamicCordisRunner.invoke` Remote（pluginId/pluginRunId/method/args）
  - 扩展 host 代码不热重载——改了 src/*.ts 后只重载 webview 不会生效
  - dsh-attachment-ui.js 有自身兜底：state.cordis 缺失时经 `__DSH_WEB_URL__` 代理自行 fetch inventory
  - **动态 client half 禁原生 setTimeout**（pkg-11 教训：render 崩溃）——定时器必须 `inject: ['timer']` 走 `ctx.timer.timeout`
  - **跨端 window 事件同步必须带来源标记**（pkg-14 教训）——CustomEvent `detail.from` 区分 extension/plugin，只响应对方来源
  - draft 检测 lookahead 只用 `(?=\s)` 不用 `$`（否则未闭合部分路径会被附着成垃圾 chip）
  - 选区内容由 host 读磁盘（非扩展编辑器 buffer）——未保存改动不反映在附着内容中
  - 路径检测器对「以 / 开头的 token」太宽——纯斜杠序列（`//`）需前置排除，验证失败静默 continue

## 架构文档维护

- **ARCH.md 是唯一架构全图**（分层/模块地图/数据流/wire 协议/构建管线/文件→功能速查表），与 AGENTS.md 互补：本文件管**约束与规范**，ARCH.md 管**代码导航与结构**。
- 修改代码时，凡涉及以下任一 → 必须在**同一 commit** 内同步更新 [ARCH.md](ARCH.md) 对应章节：新增/删除模块（§3 目录地图 + §7 速查表）、新增命令、新增/修改 bridge 消息类型（§4.4）、新增 wire 帧类型（§5.1）、修改构建流程（§6）、修改状态机（§5.2/§5.3）。
- 更新后自查：新模块是否已出现在目录地图与速查表；被删模块是否已从两处移除；ASCII 图是否保持等宽对齐。
- 定位代码的固定流程：**ARCH.md 定位 → 本文件确认红线 → 修改 → 按本节同步维护 ARCH.md**。

## 执行

阶段计划与进度（Route A Phase 5–8:vendor 构建打通 → 定制适配 → 功能验证与清理 → 交付门）、每阶段 checklist、G0/G1/G2 Review 流程与记录模板、风险登记表、验收 Checkbox → **全部在 [TASK.md](TASK.md)**，按阶段推进，每完成一步在 TASK.md 打勾。
