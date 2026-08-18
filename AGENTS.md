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
- 冒烟：`node apps/vscode/scripts/smoke-shell.mjs`（headless Chrome + Origin 中继，断言语义见脚本）
- 测试：连 3080 的集成测试标 `@live`（需 `LIVE_3080=1` 环境变量才跑），无服务/无 key 时可跳过且保持全绿
- git：只 `git add <具体路径>`，禁 `add .` / `-A`；commit 后立即 push；信息用 `feat|fix|chore|refactor|docs:` 前缀

## Pitfalls（实测）

- `dsh web` 不自动开浏览器，只打印 URL；前台进程，后台实例随会话结束而死
- headless/未配模型（`agent-default-model` / `DEEPSEEK_API_KEY`）退出码 1；headless 无 JSON 输出，stdout 即答案
- dev preview：上游 master（rc.5）与已装版本（rc.6）可能不一致，以 `dsh --version` 实测为准
- 上游约定：注册即 effect；model-visible ⟺ logged；插件而非改 loop；misconfiguration 启动即报错，不静默跳过
- `references/` 已 gitignore（本地才有设计草案），公开仓库见不到属正常；执行基准是 TASK.md
- **resolveBase 适配缝**（build-web-shell.mjs）：上游 connection 构建产物的 base 解析三元表达式被断言式替换为 `__DSH_WEB_URL__` 优先；改 vendor rev 后若构建报「适配缝失配」，说明产物文本已变，先看产物再更新缝（验证对象是 `plugins/@deepseek-ai/dsh-client-connection/client.js`，不是源码）
- **裁剪图参考**（`scripts/ref-graph-rc6.json`）：裁剪模式与参考集做精确断言；上游新增/改名 client 包会触发失败——有意变更则同步更新参考
- **mux 存在二进制帧**：上游客户端（rc.5/rc.6 一致）丢弃非文本帧，属已知行为非回归；UI 依赖的帧均为文本
- **vendor 类型导入基础设施**（2026-08-18）：tsconfig paths + esbuild alias 配置了 4 个 vendor 包的解析路径（dsh-host-apiproxy/api、dsh-client-connection/client、dsh-session/types、dsh-session），扩展侧代码可通过标准 import 引入上游类型。**当前 wire.ts 保留本地类型定义**（上游更精确：branded RpcId、非泛型 RpcResult、discriminated MuxFrame），仅记录映射关系；直接 re-export 会导致消费者类型不兼容。迁移策略见 docs/dedup-plan.md
- `/plugins/events`（HMR dev SSE）在无 dev server 时 404，无害
- 上游 rc.5 源码构建产物与 rc.6 npm 产物字节级一致（实测），UI 侧协议漂移风险低；升级仍须全量回归

- **webview 内「新会话」走扩展**：上游 startSession 落在最近 workspace（recentWorkspaceId），
  不保证链接 VS Code 目录；bridge 在 document capture 拦截 `[class$="_newSession"]`/logo
  wordmark（停止传播，上游不触发）→ postMessage dsh:new-session → 扩展 ensureFolderSession
  （当前目录）→ bootstrap-session → reload 进入；VIEW_KEY 置 chat 保证回到对话页

- **会话切换按钮插 title 行内**（用户要求，2026-08-18）：上游组件重渲染会清除注入节点 →
  MutationObserver（rAF）重插 + document capture 事件委托（按钮移除瞬间点击仍命中）；
  空会话 hero 无 title 行 → fixed 悬浮兜底；Workspaces 页顶部 fixed 返回

- **heroGlow 是硬编码 SVG 色**（#6187D8，不读 token）：去掉底色后仍透蓝光，shell.css 用
  `[class$="_heroGlow"] ellipse { fill: var(--dsh-host-fg) !important; }` 覆盖（fill 属性可被 CSS 覆盖）
- **主题 token 三层**：上游 ThemePresenter 会把主题 token 写成 body 内联变量（压过普通样式表），
  shell.css 的映射必须 `!important`；body 有 `data-ds-dark-theme` 属性选择器时映射要双写
- **会话历史里的错误卡片是数据**：smoke 的白屏检测看 rootChildren + pageerror，勿用 `[class*="error"]`
  判断 UI 故障（上游正确渲染会话内错误消息）
- 设置写回统一走 `settings.update({ns, patch})`（上游 store 同款）；`settings.mutate` 载荷不同，勿混用；
  permission 命名空间 schema 只有 `defaultPreset` 可写（`preference` 是运行态镜像，写了无效）
- **locale 由 settings 快照决定，但 boot 加载是竞态**（实测）：connection 未就绪时上游
  settings.describe 失败 → 快照 undefined → 语言 = navigator.language（中文系统=中文），且
  实例值已等于目标时无推送可触发 → 永不纠正。修复：注入 __DSH_LOCALE__（VS Code 设置），
  bridge 检测 UI 语言（tab 文本）→ 不符则写实例触发 settings/document-updated 推送 →
  上游 refresh → 热切换；值相同用「双写对调值再写回」强制推送
- **locale 运行中不热切换**（实测）：settings.update 写 locale.preference 后，已打开的 webview 界面
  语言不变（仅 boot 时应用）；扩展在写回成功后重载 webview（settings-bridge onLocaleApplied → chat-panel reload）；
  语言对齐主通道 = bridge 的 __DSH_LOCALE__ 同步（boot 后自动，无需 reload）
- **「Deep diving...」 状态行**：上游硬编码品牌蓝渐变（--dsw-static-deepseek-*）做 shimmer 文字；
  shell.css 覆盖为 `--dsh-host-accent` 渐变，但**必须用 background-image 而非 background 简写**
  （简写会重置 background-clip:text → 文字透明只剩色块）；background-clip/-webkit 前缀显式保留

- **会话管理页 = 扩展自有 React 视图**（2026-08-19 起，取代拉伸侧边栏）：上游没有独立
  会话管理页（WorkspaceBrowser 就是侧边栏），且其 store 在 React context 内不可外部调用；
  方案 = web/SessionView.tsx（esbuild IIFE → dist/web/session-view.js，由 build-web-shell.mjs
  拷入 dsh-shell 并注入 `#dsh-sessions-root` + script）：bridge 切 `chat`↔`sessions`
  （sessions 隐藏 #root=display:none 保 store、显示自有页；React 页经 `window.__dshBridge.setView`
  返回）。数据走 `__DSH_WEB_URL__` 代理调 session.list RPC（与上游同 wire；标题=
  projections.values.title，blank=新会话）；跳转 = 写 dsh.sessions.current（上游恢复键）+
  回传 switch-session:applied → chat-panel 重注入 html 重载 → boot 进入该会话（与
  dsh:bootstrap-session 同路径，无 setTimeout）。不再用任何 `dsh-workspaces` CSS/
  expandAllWorkspaces/chevron/workspace 行拦截（已删）。改 vendor rev 后若
  `#dsh-sessions-root` 注入或 session-view.js 拷贝失败，先看装配产物再更新脚本
  （验证对象：dist/web/dsh-shell/index.html 的 </body> 前）；2026-08-20 P1+P2：数据改拉 session.list + workspace.list
  并行（分组反向索引 / 未分组 / 已归档折叠默认收起 / 运行中状态点 + 「进行中」）；归档/子代理/
  非当前 blank 按上游 sessionVisible 语义隐藏；行结构/状态点/相对时间/文件夹/三角图标自上游
  ui-workspace Rows.tsx + ui-primitives 移植（不依赖 CSS Modules）；归档 RPC =
  workspace.archiveSession（右键菜单未做） → 2026-08-20 晚：改做完成 —— 子代理仅 origin==='subagent' 嵌套父行（递归折叠，
  默认展开；fork 子代维持顶层；父隐藏时提升未分组）；行尾 ⋯ 菜单 = 重命名/分叉/归档
  (session.rename / session.fork {sessionId} / workspace.archiveSession {sessionId};
  会话级无 delete，自绘 menu+Modal）；新建/切换会话时 bridge 同步写 dsh.ui.view=chat
  （否则从会话页新建后重载仍回会话页）

- **webview 内 acquireVsCodeApi 只能 acquire 一次**（2026-08-20 实测根因）：VS Code 预加载
  脚本（webview pre/index.html）对第二次调用抛 'An instance of the VS Code API has already
  been acquired'，且会 `window.parent = window` —— 二次 acquire 失败后的
  window.parent.postMessage 回退在真实 webview 是**自我投递（静默丢弃）**；headless 能过
  只因 harness 帧真的接收。自建 React 视图回传宿主必须走 `window.__dshBridge.postToHost`
  （bridge.js 在 head 持有唯一 acquire），不得自行二次 acquire

- **VS Code webview 默认样式给 body 注入 `padding: 0 20px`**（2026-08 实测）：
  `@layer vscode-default` 是 VS Code 在 webview 文档加载后插入的默认样式（背景透明、
  body 左右各 20px 内边距）。透明 padding 区会露出宿主深色背景 → 页面两侧「黑边」
  （headless 无此注入，复现必须模拟）。修复：shell.css 顶部 `body { padding: 0 !important; }`
  （unlayered 规则压过 layer）。改 `@layer` 里任何默认行为后，记得核对 vscode-default 全文
  (`/Applications/Visual Studio Code.app/.../webview/browser/pre/index.html`)。

- **注入脚本的 MutationObserver 必须防自激循环**（2026-08-21 实测）：观察 body 子树的
  MutationObserver 若在回调里**无条件重渲染**（即使 DOM 未变），渲染写入会再次触发 observer
  → rAF 级无限循环，主线程被打满（真实 webview 卡死，Playwright 动作超时挂起）。
  守卫：回调里只在「注入根丢失」（root 未 connected）时才重建+重渲染；根存在则直接跳过。
  附着 UI（web/dsh-attachment-ui.ts）即此范式；title 行注入只做幂等查询不写 DOM，不受影响。
- **Phase 10 附着协议**（2026-08-21）：Explorer→webview 拖放的标准 MIME 是 `text/uri-list`
  （每行一个 URI，非 JSON；`vscode.Resource` 不是公开合约）；OS 桌面拖入是 `Files`，webview 内
  取路径只能 feature-detect `globalThis.webUtils.getPathForFile`（Electron 能力，非 VS Code
  API 合约，拿不到就降级提示）；webview 只传 URI，内容一律扩展侧 `workspace.fs` 发送时读取
  （1 MiB 上限/二进制 NUL 检测/20k 截断/总量 100k/目录拒绝）。上游输入框冻结 → 附着 UI 走
  bridge 注入（dsh-attachment-ui.js，装配时拷入 dsh-shell 并注入 </body> 前），附着条注入输入
  composer 座位容器（[data-composer-seat]）最前 = 输入框正上方，**不触碰输入卡片内部**
  （上游 card 是 React 管理的 flex 布局，插入子节点会破坏 textarea 排版）；指示**存在即显示**
  （icon+文件名 / icon+N lines selected，无内容完全不显示，无禁用灰态；开关只决定是否随消息附着）；
  chip 文案 textContent 渲染（文件名转义）
- **DSH 侧附着插件 dsh-file-attach**（2026 创造模式，源码存盘 `dsh-file-attach/`）：把「文件/选区附着」
  系统性纳入 DSH 提示词体系，装配点 = **`agent/pre-step` waterfall**（对照 dsh-agent-loop 源码验证：
  waterfall 返回的 messages 既 `session.append("user/message")` 入持久日志，又 `deriveMessages()` 进模型请求，
  → model-visible ⟺ logged 由构造保证，不改 vendor/不重写 loop/不自维护 messages[]）。注入格式为地址索引
  prompt injection:`User attached file: '<path>'` / `User attached content from file '<path>': xxx`;
  注入消息 `source: {kind:'plugin', plugin:'dsh-file-attach'}`，仅当 claimed messages 含 user source 时注入；
  附着一次性消费：注入所在 step 的 step/end 后清空（turn/end 兜底），后续消息不重复注入，被拒绝的 step 不消费。
  检测器挂 composer 输入逻辑（无粘贴框）：document capture 级 paste/drop（`[data-composer-card]` 内）+ draft
  观察，粘贴路径自动附着 chips 并从 draft 移除（走官方 `inputActions.setDraft`）；**draft 检测 lookahead 只用
  `(?=\s)` 不用 `$`**（否则未闭合部分路径 `/Us…` 会被附着成垃圾 chip）。UI 注册 `conversation.input.dock`
  （order 5:todo 之后、goal/queue 之前；strip 套上游 dock 对齐公式与 chat message 同界）。
  **cordis Package 是完整快照：双半改动必须同包提交，只传 client 会丢 Host half**（pkg-2/3 教训）。
   **建议附着 API（需求 4/5）**：Host `dsh-file-attach:suggest/suggest-remove/suggest-clear`（按 session，
   建议不注入 prompt，add 命中同名建议自动移出，list 返回 attachments+suggestions）；Client 虚线建议
   chip + 「+」点击正式附着；页面级 `window.__dshFileAttach.suggest(paths)/clearSuggest()`；公开 wire
   通道 = **`dynamicCordisRunner.invoke` Remote**（pluginId/pluginRunId/method/args）可直达 harness.handle。
   扩展侧 active-file 指示**已弃用**（2026-08）：webview 内活动文件不再自绘 icon+文件名，
   由插件渲染「建议附着」虚线 chip（`dsh-attachment-ui.ts` `pushActiveFileSuggestion`；
   插件缺失时不显示）。**webview 对新开页面不会自动加载已运行插件的 client half**
   （client 激活仅由 `cordis/request-run` 事件或页面主动 startUserRun 驱动）——build-web-shell.mjs
   桥接缝 3 在 `dsh-cordis-client-runner` bundle 的 `ctx.provide("dynamicCordisRunner", face)` 后注入
   `window.__dshCordisEnsureClient({agentId,pluginId,packageId,mode})`（经 orchestrator.startUserRun →
   runHostHalf 直连手势**挂接已运行 run，宿主零重启** → getClientCode → 页面求值激活 client half）；
   扩展 host 侧经 wire `dynamicCordisRunner/inventory`（斜杠命名!`/api/<ns>/<method>`，`{"args":{...}}`
   包裹）解析插件身份（agentId/pluginId/activeRun.packageId，按包名 dsh-file-attach 匹配）推入
   `dsh:attachments:state.cordis`；webview 据此 ensure → 落地后委托 suggest。wire 斜杠 vs session.*
   点号命名是两类路由（gateway Remote vs 本地 RPC），勿混用。
   **扩展 host 代码不热重载**（2026-08 实测）：webview 的 shell（HTML/JavaScript/CSS）每次重载都读最新
   dist/web/dsh-shell，但扩展进程的 extension.js 只在 Reload Window 时重载 —— 改了 src/*.ts 后
   只重载 webview 不会生效（症状：webview 新 UI 无活动文件反应、粘贴路径留 raw text —— 即
   插件 client 无人激活）。dsh-attachment-ui.js 为此加了**自身兜底**：state.cordis 缺失时经
   `__DSH_WEB_URL__` 代理自行 fetch `dynamicCordisRunner/inventory` 解析插件身份（与扩展 host
   同逻辑；webview fetch 代理可行，bridge 的 syncLocale 同款），再走桥接缝 3 激活。
   **v12 建议同步协议（pkg-12，用户反馈）**：扩展与插件经 window 事件 `dsh:attachments:changed`
   双向同步 —— 扩展 `pushActiveFileSuggestion` 落地（host 已存）后 dispatch → 插件重拉 list；
   插件 X 掉已附着文件后 dispatch → 扩展重推当前浏览文件为建议（host 自动跳过仍附着的）→
   虚线 + 「+」恢复。插件**补发**：list 返回后若建议为空且 `window.__dshActiveFileFsPath`
   （扩展每次状态推送写入的浏览文件绝对路径）未附着，插件用 props.sessionId 自行 suggest ——
   不依赖 `currentSessionRef` 挂载时机，「有浏览文件即直显虚线框」。**动态 client half 禁原生
   setTimeout**（pkg-11 教训：render 崩溃）——定时器必须 `inject: ['timer']` 走 `ctx.timer.timeout`，
   React effect 返回其 disposer。
   **v13 交互（pkg-13，headless 实证）**：建议「+」按钮点击面积过小易落空 → 改为**整个虚线
   建议框可点击**（点击任意处即正式附着，加号纯装饰 span），`cursor:pointer`；加号样式与
   × 完全一致（font-weight 700/opacity .6/继承 12px）；`.dshfa-strip` 改 `row+wrap` ——
   建议区与附着区同一行，虚线建议永远在前（children 先 suggests）。headless 诊断法：
   vendor 的 playwright（`vendor/deepseek-harness/apps/web/node_modules/playwright`）+
   addInitScript 注入 `__DSH_WEB_URL__`（Origin 中继代理）+ `__DSH_BOOT_SESSION__`，可
   复现 webview 环境实测插件 UI（参考 scripts/smoke-shell.mjs 的环境搭建；注意用**独立
   测试会话** boot，避免与用户实时扩展的 suggest 相互污染）。
   **v14 事件自激循环（pkg-14，headless 复现「点×后加号点不动」）**：`dsh:attachments:changed`
   曾无来源标记 —— 扩展每次收到事件就 suggest、suggest 落地又 dispatch 同一事件 → 无限
   循环 → 建议框被持续重建、点击永远落空（headless 表现为 locator.click 超时）。修复：
   CustomEvent `detail.from` 来源标记，插件 removeItem 后 dispatch `{from:'plugin'}` 且
   onChanged 只响应 `{from:'extension'}`；扩展 suggest 落地 dispatch `{from:'extension'}`
   且监听只响应 `{from:'plugin'}` —— 自激闭环被来源过滤切断。**教训：跨端 window 事件
   同步必须带来源标记并只响应对方来源，否则双方互相触发即成循环。**
   **v15 选区建议（pkg-15，用户反馈）**：webview 的「N lines selected」指示同活动文件指示
   一样弃用自绘（dsh-attachment-ui.ts 不再渲染 indicator），改由插件渲染虚线建议框 ——
   **排在文件建议框之前**（client 渲染先 selection 建议后 file 建议；用户要求）。Host：
   建议/附着新增 kind 'selection'（path + ranges：[{startLine，endLine}] 1-based + lineCount），
   `suggest-selection` 替换式设置选区建议（保留文件建议；null 清除；同 path+同 ranges 已
   附着跳过）；add 时 `fs.readBytes`（1 MiB 上限）读文件按行区间抽取内容（20k 截断），注入行
   `User attached selected lines N-M from file '<path>': <content>`；**文件建议与选区建议
   互不压制**（suggest 只跳过 file 附着，suggest-selection 只跳过 selection 附着）。
   Client：扩展把当前选区声明写入 `window.__dshActiveSelection`（{path，ranges，lineCount} |
   null，每次状态推送，与 `__dshActiveFileFsPath` 同范式），插件据此**补发** suggest-selection；
   选区虚线框文本「N lines selected」（与旧指示一致），点击正式附着，X 后扩展重推恢复。
   注意：选区内容由 **host 读磁盘**（非扩展编辑器 buffer）—— 未保存（dirty）改动不反映在
   附着内容中，与文件附着同哲学（地址索引 + 模型自读）。
   **v16 无效路径静默拒绝（pkg-16，用户反馈「不用显示 not-a-real-file： //」）**：粘贴/输入
   中的注释行「//」被 split 成纯斜杠 token → 误识别为路径 → host add 验证失败回显
   `not-a-real-file: //`。修复两层：① client `toPath` 拒绝**纯斜杠序列**（`/^\/+$/`，
   `/`、`//`、`///`…，从源头不识别、也不进入 stash 剥离，不破坏 draft）；② host
   `addItems` 对 not-a-real-file **静默 continue**（不再 push 错误，与 suggest 静默语义
   一致）。教训：路径检测器对「以 / 开头的 token」太宽 —— 注释/纯斜杠是高频误报，识别
   前先排除纯斜杠序列；验证失败的拒绝对 UI **静默**（suggest 早已静默，add 也应对齐）。

- **目录选择走 native plugin，不走 browse**（2026-08-18 实测）：`conversation.hero.workspace.directoryFlow`
  slot 的 occupant 决定 "Add workspace..." 点击后的行为。上游有两个实现：
  `ui-directory-picker-browse`（renderful in-app 浏览器，调 `host.listDirectory`）和
  `ui-directory-picker-native`（renderless，调 `host.pickDirectory`）。
  Route A 排除 browse、保留 native；native occupant 不渲染任何 UI，直接调 `host.pickDirectory`
  RPC → proxy 拦截 → `vscode.window.showOpenDialog()` → 返回路径 → `onPicked(path)`。
  **不要拦截 `host.listDirectory`**（语义是列出目录内容，不是选择目录）。
  wire 响应格式：`{ type:'server-response', rpcId, result:{ ok:true, value:{ path:string|null } } }`

## 架构文档维护

- **ARCH.md 是唯一架构全图**（分层/模块地图/数据流/wire 协议/构建管线/文件→功能速查表），与 AGENTS.md 互补：本文件管**约束与规范**，ARCH.md 管**代码导航与结构**。
- 修改代码时，凡涉及以下任一 → 必须在**同一 commit** 内同步更新 [ARCH.md](ARCH.md) 对应章节：新增/删除模块（§3 目录地图 + §7 速查表）、新增命令、新增/修改 bridge 消息类型（§4.4）、新增 wire 帧类型（§5.1）、修改构建流程（§6）、修改状态机（§5.2/§5.3）。
- 更新后自查：新模块是否已出现在目录地图与速查表；被删模块是否已从两处移除；ASCII 图是否保持等宽对齐。
- 定位代码的固定流程：**ARCH.md 定位 → 本文件确认红线 → 修改 → 按本节同步维护 ARCH.md**。

## 执行

阶段计划与进度（Route A Phase 5–8:vendor 构建打通 → 定制适配 → 功能验证与清理 → 交付门）、每阶段 checklist、G0/G1/G2 Review 流程与记录模板、风险登记表、验收 Checkbox → **全部在 [TASK.md](TASK.md)**，按阶段推进，每完成一步在 TASK.md 打勾。
