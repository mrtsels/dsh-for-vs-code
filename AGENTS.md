# AGENTS.md — dsh-for-vs-code

DeepSeek Harness 的 VS Code 客户端(IDE frontend)。复用上游 Harness 的 Agent Runtime / Cordis / Tools / Session / MCP / Skills,把浏览器壳(`apps/web`)换成 VS Code Extension + Webview。设计依据是 [references/suggestions.md](references/suggestions.md)(SSOT,先读它);上游仓库 https://github.com/deepseek-ai/deepseek-harness (MIT,developer preview)。

## 现状与路线

- 全新项目:尚无 package.json / 源码 / git 仓库。本文件是第一个写脚手架的人/agent 的契约,写完后按它落地。
- 路线(§18):MVP 走 **路线 A** — VS Code → HTTP → `dsh web` runtime(端口 3080,低难度);终局走 **路线 B** — Extension 直接内嵌 Harness runtime。**禁止路线 C**(重写 agent-loop)。
- 目标布局(§12):`apps/vscode/` 下 `src/extension.ts`、`src/agent/{controller,runtime,session-manager}.ts`、`src/vscode/{workspace,terminal,editor,git,diagnostics}.ts`、`src/webview/{panel,bridge}.ts`、`src/commands/{ask,agent,review}.ts`、`web/`(React webview)。
- package.json 贡献点(§13):`activationEvents` = `onStartupFinished` + `onView:deepseekHarness.chat`;命令 `deepseekHarness.open` / `deepseekHarness.ask`;activity bar 容器 `deepseekHarness` + view `deepseekHarness.chat`。

## 环境

- 本机:node v22.22.3、pnpm 10.32.1、`@deepseek-ai/dsh@0.1.0-rc.6`(全局,~/.npm-global)。上游要求 node `^22.19 || >=24`、pnpm 11.7.0(corepack 按 packageManager 字段取)。
- 跑上游:`npx @deepseek-ai/dsh web` → http://127.0.0.1:3080;源码方式:clone → `pnpm install` → `pnpm run build` → `pnpm dsh web`。
- 依赖 dsh 前先 `dsh --version` 记版本;dev preview 下 breaking change 频繁,必须锁版本。

## 构建与测试

- 本仓库:脚手架完成后补齐,至少:webview/extension 打包(esbuild/vite)、`F5` 启动 VSIX 调试、lint、test。
- 上游参考(在 deepseek-harness checkout 内):`pnpm run build` / `pnpm run typecheck` / `pnpm run lint`(oxlint)/ `pnpm run test`(vitest)/ `pnpm run test:e2e`(需 `DEEPSEEK_API_KEY`,无 key 自动跳过)。
- 验证 dsh 服务用 `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3080/`,不要靠浏览器。

## 约定

- 不 fork 上游、不改 `packages/core` / `agent-loop`;新能力挂官方扩展点:UI → `ctx.agents` + `session/event`;tool → `ctx.tools`;shell → `ctx.shell`;fs → `ctx.fs`;model → `ctx.llm`(§16)。
- Session 是 append-only event log(§10):UI 从 `session/event` 渲染,**禁止自维护一份 messages[] 再同步**。
- 写文件 / apply_patch 走 VS Code WorkspaceEdit(保留 undo + diff + 用户审批),不直接 `fs.writeFile` 覆盖(§7)。
- terminal 走 VS Code Terminal API,与用户 IDE 环境一致(§8);sandbox 可保留 Harness 自己的 provider。
- Editor 上下文(文件/选区/diagnostics)用 `agent.inject()` 注入 model-facing context,不把整个 workspace 打包给模型(§6)。
- UI 承载用 Webview(§5);第一版不用 VS Code Chat API(§14),Phase 4 才考虑 ChatParticipant。
- 开发顺序按 §17:Phase 1 最小可用(chat/streaming/session/read_file/write_file/diff/run command)→ Phase 2 IDE-native(context/diagnostics/git diff/apply patch/terminal/approval)→ Phase 3 全能力(MCP/skills/subagents/session fork/sandbox/goals)→ Phase 4 VS Code 原生。
- 方案 A 的 HTTP 桥要薄:`dsh web` 的端口/协议无稳定契约,升级 dsh 后必须回归。
- 文档用中文,代码标识符/命令用英文;git 只 add 具体路径,禁 `git add .` / `-A`,commit 后立即 push。

## Pitfalls

- `dsh web` 不会自动开浏览器,只打印 URL;前台进程,后台实例随会话结束而死。
- headless/profile 未配模型(`agent-default-model` 或 `DEEPSEEK_API_KEY`)时退出码 1,且无 JSON 输出模式,stdout 即答案。
- 上游 master 是 `0.1.0-rc.5`,本机装的是 `rc.6` — 以实际安装版本为准,别假设与 master 一致。
- 上游 .gitignore 忽略 `.vscode/`、`node_modules/`、`lib/`、`apps/web/dist/`;本仓库不提交 VSIX 产物。
- 上游约定(做集成时遵守):ESM everywhere;注册即 effect(`ctx.effect()` / `ctx.on()`,返回 disposer);model-visible ⟺ 可日志重建;插件而非改 loop。
