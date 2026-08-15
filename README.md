# dsh-for-vs-code

DeepSeek Harness 的 VS Code 客户端。复用上游 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的 Agent Runtime / Cordis / Tools / Session / MCP / Skills,把浏览器 Web UI 换成 VS Code Extension + Webview,让 Agent 直接在 IDE 里工作。

## 当前状态

**Phase 0–3 完成,Phase 4 已实现;G2 交付门审查中。** 开发契约(红线、规范、协议、坑)见 [AGENTS.md](AGENTS.md);完整任务书见 [TASK.md](TASK.md);协议缺口与降级见 [docs/gaps.md](docs/gaps.md)。

实现路线:**路线 A** — VS Code ↔ HTTP ↔ `dsh web` Runtime:插件是**现有 dsh web 实例的客户端**(映射 127.0.0.1:3080 的同一 runtime,不另起实例、不内嵌 runtime)。

路线图:Phase 1 最小可用(chat / streaming / session / 读写文件 / diff / 跑命令)→ Phase 2 IDE-native(编辑器上下文 / diagnostics / git diff / apply patch / terminal / 审批)→ Phase 3 全能力(MCP / skills / subagents / session fork / sandbox / goals)→ Phase 4 VS Code 原生(ChatParticipant / code actions / 右键菜单)。

## 功能一览

- **Chat 面板**:流式回答、工具调用卡片、会话列表(新建/切换/fork ⧉)、停止
- **洞察面板**:技能目录 / 后台任务 / 子代理(可打断 continuable)/ Goals(创建/暂停/恢复/完成/清除)
- **编辑器上下文**:Ask 时自动注入当前文件/选区/诊断;问 git 时注入工作区改动摘要
- **改动审查**:agent 写盘被快照捕获 → diff 面板 → 一键回滚/接受(`DeepSeek Harness: Review Changes`)
- **审批**:工具请求执行时弹出原生通知(允许一次/拒绝)
- **终端**:面板内"终端"输入命令,输出可捕获回传 UI
- **原生入口**:VS Code Chat 面板(`@DeepSeek Harness` participant)、编辑器右键"dsh: 解释选中代码 / Ask to fix 诊断"、Code Actions
- **连接管理**:`DeepSeek Harness: 切换实例地址`(默认 http://127.0.0.1:3080)

## 安装与使用

前置:Node.js ≥ 22.19;dsh 0.1.0-rc.6(`npx @deepseek-ai/dsh web`,首次聊天前在 Settings → Models 配置模型与 API Key,或环境变量 `DEEPSEEK_API_KEY`)。

方式一(开发调试):克隆仓库 → `pnpm install` → VS Code 打开仓库 → F5(扩展开发宿主)。

方式二(VSIX):

```sh
cd apps/vscode && pnpm build && pnpm package   # 生成 dsh-for-vscode-0.0.1.vsix
code --install-extension dsh-for-vscode-0.0.1.vsix
```

激活后活动栏出现 DeepSeek 图标,自动连接 127.0.0.1:3080(健康检查失败会持续重连并在状态栏显示)。

## 架构

```
VS Code Extension (Route A 薄客户端)
├─ src/agent/      runtime.ts(薄桥:握手/双WS/重连) · session-manager.ts(事件缓冲) · controller.ts(状态机)
├─ src/webview/    chat 面板 + changes 面板(bridge.ts 白名单协议)
├─ src/vscode/     workspace 快照/回滚 · terminal(Pseudoterminal) · editor/diagnostics/git 上下文
├─ src/commands/   ask · agent · review · chat-participant · native(code actions)
└─ web/            React webview(只从 session/event 渲染,append-only 事件日志)
        │  HTTP POST /api/<method>(unary) + WS /api/events.{mux,host}(推送)
        ▼
dsh web 实例 @ 127.0.0.1:3080(同一 runtime,第 N 个 viewer)
```

关键约定(见 AGENTS.md 红线):不 fork 上游、不改 `packages/core`/`agent-loop`;`src/agent/runtime.ts` 只做传输;UI 只从 `session/event` 渲染;文件写走 WorkspaceEdit(快照 diff + 回滚);terminal 走 VS Code Terminal API。

## 已知限制

- **T-1(固有边界)**:agent 在 dsh 实例内直接写盘,扩展无法截获其写操作;审批采用"快照 diff + 一键回滚"最终形态(改动面板),而非逐写拦截。README/TASK 明示。
- MCP 服务器状态、job 取消、sandbox 状态无上游 API(见 [docs/gaps.md](docs/gaps.md)),按"文档化降级"处理,不造轮子。
- 协议锁 dsh 0.1.0-rc.6(见 [docs/versions.md](docs/versions.md));升级只做专项 + 全量回归。
- 服务仅绑定 127.0.0.1、无鉴权:请勿在共享环境暴露端口。

## 开发

先读 [AGENTS.md](AGENTS.md)。G0 提交门:`pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build`;集成测试(连 3080)标 `@live`,无服务可跳过。阶段进度见 TASK.md 顶部"进度快照"。

## License

[MIT](LICENSE)
