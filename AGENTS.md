# AGENTS.md — dsh-for-vs-code

DeepSeek Harness(`dsh`)的 VS Code 客户端:复用上游 Agent Runtime / Cordis / Tools / Session / MCP / Skills,把浏览器 Web UI 换成 VS Code Extension + Webview。插件是**现有 `dsh web` 实例的客户端**——映射 127.0.0.1:3080 的同一 runtime,不另起实例、不内嵌 runtime。

**UI 路线(Route A,2026-08-17 起)**:UI = dsh 上游原生 React 组件,从锁定 rev 的 `vendor/deepseek-harness` 源码构建装配(`apps/vscode/scripts/build-web-shell.mjs` → `dist/web/dsh-shell/`),不 fetch 活实例产物、不注入 minified 产物。执行细节(阶段、checklist、Review 门、风险表)以 [TASK.md](TASK.md) 为准。

## 红线(违反即 Review FAIL)

- 不 fork 上游、不改 `vendor/deepseek-harness` 内任何源码、不改 `packages/core` / `agent-loop`;禁止 **Route B**(内嵌 runtime)与 **Route C**(重写 loop)(TASK §0.2)
- 新能力挂官方扩展点:UI → `ctx.agents` + `session/event`;tool → `ctx.tools`;shell → `ctx.shell`;fs → `ctx.fs`;model → `ctx.llm`
- `src/agent/runtime.ts` 只做传输:不缓存状态、不含业务逻辑(薄桥)
- UI 由上游组件 + 上游 connection 层驱动(事件模型在上游);扩展不自维护 messages[];model-visible ⟺ logged;自研 webview 仅限 changes 面板
- 文件写走 VS Code WorkspaceEdit(或 T-1 快照 diff + 回滚方案);terminal 走 VS Code Terminal API,禁裸 `child_process`(例外:只读 CLI 封装如 `git.ts` 的 `execFile` 仅用于查询类命令,须注释声明用途;agent 执行路径一律 Terminal API)

## 代码规范

- ESM everywhere(`"type": "module"`);TypeScript `strict`,协议边界窄化点注释,无 `any`
- **注册即 effect**:`ctx.on` / `onDid*` / 事件订阅必须返回 disposer;deactivate 全量清理;activate 幂等
- 错误处理:空 `catch` 写明吞掉什么(且 try 只包一条语句);网络路径(超时/断连/重连/退避)失败对 UI 可见;序列化/解析失败显式报错,不静默丢消息
- 开关判别用 discriminated union,收口 `assertNever`;在 parser/模型/wire/进程边界做校验,不信任类型系统之外的运行时防御
- 命名:标识符/命令英文,文档中文;命令与 view id 统一 `deepseekHarness.*` 前缀
- webview 安全:CSP 无 inline script(注入脚本用 nonce);postMessage 入参白名单结构校验;禁 `dangerouslySetInnerHTML`(markdown 白名单渲染);API key/credentials 不下发 webview、不进事件渲染

## 协议与版本

- **锁 dsh 版本**(运行时 0.1.0-rc.6 @ 3080;UI 源码锁 rc.5 = `47f94385`,记入 docs/versions.md);升级只做专项 + 全量回归(R1/R4)
- 端点 `POST /api/<method>`(裸 `/api` 404);信封 `{type:"client-request", rpcId, method, payload}` → `server-response`;WS 帧为 `server-request`(host→client)。协议细节见 docs/http-bridge.md
- 服务仅绑 127.0.0.1、无鉴权:禁 `--host 0.0.0.0`;信任栅栏 loopback / `trustedHosts`,失败 403
- 实例 cwd 绑定:握手后对比 `host.describe.cwd` 与工作区,不一致必须警告(P1-15)
- **Origin 栅栏**:webview 直连 3080 的 /api 一律 403(栅栏要求同源);扩展进程内 HTTP+WS 转发代理(`src/vscode/proxy.ts`,127.0.0.1 随机端口)改写 origin/host 为目标同源,webview 的 runtime 经 `__DSH_WEB_URL__` 连代理

## 工具链

- 环境:node `^22.19 || >=24`;本机 node v22.22.3 / pnpm 10.32.1(外层)/ corepack pnpm 11.7.0(vendor)/ dsh 0.1.0-rc.6
- 服务:`npx @deepseek-ai/dsh web` → http://127.0.0.1:3080;健康检查 `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3080/`(不靠浏览器)
- **G0 提交门**(commit 前全绿):`pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build`
- **vendor 构建**(在 `vendor/deepseek-harness/` 内执行,产物不入外层 workspace):
  `corepack pnpm install --ignore-scripts`(lefthook postinstall 在 submodule 下失败,与构建无关)→
  `corepack pnpm run build:lib:host`(typert 契约,client 类型依赖)→ `build:lib:client` + `build:web`;
  UI 装配:`pnpm --filter dsh-for-vscode run build:shell`(即 build-web-shell.mjs)
- 冒烟:`node apps/vscode/scripts/smoke-shell.mjs`(headless Chrome + Origin 中继,断言语义见脚本)
- 测试:连 3080 的集成测试标 `@live`(需 `LIVE_3080=1` 环境变量才跑),无服务/无 key 时可跳过且保持全绿
- git:只 `git add <具体路径>`,禁 `add .` / `-A`;commit 后立即 push;信息用 `feat|fix|chore|refactor|docs:` 前缀

## Pitfalls(实测)

- `dsh web` 不自动开浏览器,只打印 URL;前台进程,后台实例随会话结束而死
- headless/未配模型(`agent-default-model` / `DEEPSEEK_API_KEY`)退出码 1;headless 无 JSON 输出,stdout 即答案
- dev preview:上游 master(rc.5)与已装版本(rc.6)可能不一致,以 `dsh --version` 实测为准
- 上游约定:注册即 effect;model-visible ⟺ logged;插件而非改 loop;misconfiguration 启动即报错,不静默跳过
- `references/` 已 gitignore(本地才有设计草案),公开仓库见不到属正常;执行基准是 TASK.md
- **resolveBase 适配缝**(build-web-shell.mjs):上游 connection 构建产物的 base 解析三元表达式被断言式替换为 `__DSH_WEB_URL__` 优先;改 vendor rev 后若构建报"适配缝失配",说明产物文本已变,先看产物再更新缝(验证对象是 `plugins/@deepseek-ai/dsh-client-connection/client.js`,不是源码)
- **裁剪图参考**(scripts/ref-graph-rc6.json):裁剪模式与参考集做精确断言;上游新增/改名 client 包会触发失败——有意变更则同步更新参考
- **mux 存在二进制帧**:上游客户端(rc.5/rc.6 一致)丢弃非文本帧,属已知行为非回归;UI 依赖的帧均为文本
- `/plugins/events`(HMR dev SSE)在无 dev server 时 404,无害
- 上游 rc.5 源码构建产物与 rc.6 npm 产物字节级一致(实测),UI 侧协议漂移风险低;升级仍须全量回归
- **Phase 9 布局缝**(build-web-shell.mjs):对话模式 frame 网格强制 `0|1fr|0`(隐藏侧边栏/详情列,
  拖拽条一并隐藏);Workspaces 模式 = 独立页面的**全宽单栏**:`#root` 撑宽 `max(1100px,100vw)`
  (> SIDEBAR_AUTO_COLLAPSE=1024 → AppFrame 非窄布局 → 侧边栏渲染宽版浏览器),frame 网格
  `minmax(0,1fr) 0px 0px` 让侧边栏列占满整行,内容自适应窗口宽度;logo 行保留、仅隐藏折叠钮
- **返回按钮不可插入 React 子树**(实测):上游组件重渲染会清除外部注入节点,点击随即失效;
  改为 body 直接子元素的固定悬浮按钮(z-index 1000),title 行 `padding-left: 36px` 让位
- **heroGlow 是硬编码 SVG 色**(#6187D8,不读 token):去掉底色后仍透蓝光,shell.css 用
  `[class$="_heroGlow"] ellipse { fill: var(--dsh-host-fg) !important; }` 覆盖(fill 属性可被 CSS 覆盖)
- **主题 token 三层**:上游 ThemePresenter 会把主题 token 写成 body 内联变量(压过普通样式表),
  shell.css 的映射必须 `!important`;body 有 `data-ds-dark-theme` 属性选择器时映射要双写
- **会话历史里的错误卡片是数据**:smoke 的白屏检测看 rootChildren + pageerror,勿用 `[class*="error"]`
  判断 UI 故障(上游正确渲染会话内错误消息)
- 设置写回统一走 `settings.update({ns, patch})`(上游 store 同款);`settings.mutate` 载荷不同,勿混用;
  permission 命名空间 schema 只有 `defaultPreset` 可写(`preference` 是运行态镜像,写了无效)
- **locale 运行中不热切换**(实测):settings.update 写 locale.preference 后,已打开的 webview 界面
  语言不变(仅 boot 时应用);扩展在写回成功后重载 webview(settings-bridge onLocaleApplied → chat-panel reload)
- **"Deep diving..." 状态行**:上游硬编码品牌蓝渐变(--dsw-static-deepseek-*)做 shimmer 文字;
  shell.css 覆盖 background 为 `--dsh-host-accent`(--vscode-textLink-foreground)渐变,动画保留

## 执行

阶段计划与进度(Route A Phase 5–8:vendor 构建打通 → 定制适配 → 功能验证与清理 → 交付门)、每阶段 checklist、G0/G1/G2 Review 流程与记录模板、风险登记表、验收 Checkbox → **全部在 [TASK.md](TASK.md)**,按阶段推进,每完成一步在 TASK.md 打勾。
