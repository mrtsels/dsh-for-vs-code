# dsh-for-vs-code

DeepSeek Harness 的 VS Code 客户端。复用上游 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的 Agent Runtime / Cordis / Tools / Session / MCP / Skills,把浏览器 Web UI 换成 VS Code Extension + Webview,让 Agent 直接在 IDE 里工作。

## 当前状态

**Route A(源码构建)已落地:UI = dsh 上游原生 React 组件,从锁定 rev 的 vendor 源码构建装配(Phase 5–6 完成,Phase 7 清理/回归中)。** 开发契约(红线、规范、协议、坑)见 [AGENTS.md](AGENTS.md);完整任务书与进度见 [TASK.md](TASK.md);协议缺口与降级见 [docs/gaps.md](docs/gaps.md)。

实现路线:**插件是现有 `dsh web` 实例的客户端**(映射 127.0.0.1:3080 的同一 runtime,不另起实例、不内嵌 runtime)。UI 装配链:

```
vendor/deepseek-harness(submodule,锁 rev,只读)
  ├─ pnpm run build:lib:client   → 各 client 包 lib/client.js(插件 bundle)
  ├─ pnpm run build:web          → apps/web/dist(上游 shell)
  └─ build-web-shell.mjs         → dist/web/dsh-shell/(index.html + boot 图 + 插件 + shell.css)
                                        │
VS Code webview(chat-panel.ts:注入 CSP/base/__DSH_WEB_URL__)
        │  HTTP POST /api/<method> + WS /api/events.{mux,host}(经扩展侧代理,绕行 Origin 栅栏)
        ▼
dsh web 实例 @ 127.0.0.1:3080(同一 runtime,第 N 个 viewer)
```

## 功能一览

- **Chat 面板(上游原生 UI)**:流式回答、工具调用、会话/工作区选择、模型/权限状态;侧边栏形态(280px 布局 + 折叠)
- **改动审查**:agent 写盘被快照捕获 → diff 面板 → 一键回滚/接受(`DeepSeek Harness: Review Changes`)
- **编辑器上下文**:Ask 时自动注入当前文件/选区/诊断;问 git 时注入工作区改动摘要
- **审批**:工具请求执行时弹出原生通知(允许一次/拒绝)
- **终端**:面板内"终端"输入命令,输出可捕获回传 UI
- **原生入口**:VS Code Chat 面板(`@DeepSeek Harness` participant)、编辑器右键"dsh: 解释选中代码 / Ask to fix 诊断"、Code Actions
- **原生层会话/设置**:Sessions 树(新建/切换/刷新)、权限三档、语言/主题 follow-web
- **连接管理**:`DeepSeek Harness: 切换实例地址`(默认 http://127.0.0.1:3080;代理端口不变,转发重定向)

## 安装与使用

前置:Node.js ≥ 22.19;dsh 0.1.0-rc.6(`npx @deepseek-ai/dsh web`,首次聊天前在 Settings → Models 配置模型与 API Key,或环境变量 `DEEPSEEK_API_KEY`)。

方式一(开发调试,双击 `启动扩展.command` 或手动):

```sh
pnpm install
# vendor UI 源码构建(一次性;产物不入外层 workspace)
cd vendor/deepseek-harness
corepack pnpm install --ignore-scripts
corepack pnpm run build:lib:host && corepack pnpm run build:lib:client && corepack pnpm run build:web
cd ../..
pnpm build && pnpm build:shell   # 扩展 + dsh-shell 装配
code -n --extensionDevelopmentPath=$PWD/apps/vscode $PWD
```

方式二(VSIX):

```sh
cd apps/vscode && pnpm build && pnpm build:shell && pnpm package   # 生成 dsh-for-vscode-0.0.1.vsix
code --install-extension dsh-for-vscode-0.0.1.vsix
```

激活后活动栏出现 DeepSeek 图标,自动连接 127.0.0.1:3080(健康检查失败会持续重连并在状态栏显示)。

## 架构

```
VS Code Extension (Route A 薄客户端)
├─ src/agent/      runtime.ts(薄桥:握手/双WS/重连) · session-manager.ts(事件缓冲) · controller.ts(状态机)
├─ src/vscode/     proxy.ts(Origin 栅栏绕行:HTTP+WS 转发) · workspace 快照/回滚 · terminal · editor/git 上下文
├─ src/webview/    chat-panel.ts(dsh-shell 宿主:CSP/base/__DSH_WEB_URL__) · changes-panel.ts(自研审查面板)
├─ src/commands/   ask · agent · review · chat-participant · native(code actions)
├─ dist/web/dsh-shell/   上游原生 UI 构建产物(build-web-shell.mjs 装配)
└─ scripts/        build-web-shell.mjs(装配) · smoke-shell.mjs(headless E2E 冒烟)
```

关键约定(见 AGENTS.md 红线):不 fork 上游、vendor 只读锁 rev;`src/agent/runtime.ts` 只做传输;UI 由上游组件 + 上游 connection 层驱动(扩展不自维护 messages[]);文件写走 WorkspaceEdit(快照 diff + 回滚);terminal 走 VS Code Terminal API。

## 已知限制

- **T-1(固有边界)**:agent 在 dsh 实例内直接写盘,扩展无法截获其写操作;审批采用"快照 diff + 一键回滚"最终形态(改动面板),而非逐写拦截。
- **mux 二进制帧**:上游客户端(rc.5/rc.6 一致)丢弃非文本帧,属已知行为;UI 依赖的帧均为文本(见 gaps.md)。
- **`/plugins/events`(HMR dev SSE)无 dev server 时 404**,无害。
- **UI 源码锁 rc.5**(上游 master 无 rc.6 源码 rev);实测 rc.5 构建产物与 rc.6 npm 产物字节级一致,协议漂移风险低;升级仍只做专项 + 全量回归。
- MCP 服务器状态、job 取消、sandbox 状态无上游 API(见 [docs/gaps.md](docs/gaps.md)),按"文档化降级"处理。
- 服务仅绑定 127.0.0.1、无鉴权:请勿在共享环境暴露端口。

## 开发

先读 [AGENTS.md](AGENTS.md)。G0 提交门:`pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build`;集成测试(连 3080)标 `@live`(`LIVE_3080=1` 才跑),无服务可跳过。UI 冒烟:`node apps/vscode/scripts/smoke-shell.mjs`(headless Chrome + Origin 中继)。阶段进度见 TASK.md。

## License

[MIT](LICENSE)
