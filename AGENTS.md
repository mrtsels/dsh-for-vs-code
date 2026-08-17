# AGENTS.md — dsh-for-vs-code

DeepSeek Harness(`dsh`)的 VS Code 客户端:复用上游 Agent Runtime / Cordis / Tools / Session / MCP / Skills,把浏览器 UI 换成 VS Code Extension + Webview。插件是**现有 `dsh web` 实例的客户端**——映射 127.0.0.1:3080 的同一 runtime,不另起实例、不内嵌 runtime。本文件只定开发规范;**执行细节(阶段、checklist、Review 门、风险表)以 [TASK.md](TASK.md) 为准**。

## 红线(违反即 Review FAIL)

- 不 fork 上游、不改 `packages/core` / `agent-loop`;禁止 **Route B**(内嵌 runtime)与 **Route C**(重写 loop)(TASK §0.1)
- 新能力挂官方扩展点:UI → `ctx.agents` + `session/event`;tool → `ctx.tools`;shell → `ctx.shell`;fs → `ctx.fs`;model → `ctx.llm`(TASK §0.5.9)
- `src/agent/runtime.ts` 只做传输:不缓存状态、不含业务逻辑(薄桥)
- UI 只从 `session/event` 渲染,**禁止自维护 messages[] 再同步**;model-visible 信息必须可从事件日志重建(TASK §0.5.3)
- 文件写走 VS Code WorkspaceEdit(或 T-1 快照 diff + 回滚方案);terminal 走 VS Code Terminal API,禁裸 `child_process`(例外:只读 CLI 封装如 `git.ts` 的 `execFile` 仅用于查询类命令,须注释声明用途;agent 执行路径一律 Terminal API)

## 代码规范

- ESM everywhere(`"type": "module"`);TypeScript `strict`,协议边界窄化点注释,无 `any`
- **注册即 effect**:`ctx.on` / `onDid*` / 事件订阅必须返回 disposer;deactivate 全量清理;activate 幂等
- 错误处理:空 `catch` 写明吞掉什么(且 try 只包一条语句);网络路径(超时/断连/重连/退避)失败对 UI 可见;序列化/解析失败显式报错,不静默丢消息
- 开关判别用 discriminated union,收口 `assertNever`;在 parser/模型/wire/进程边界做校验,不信任类型系统之外的运行时防御
- 命名:标识符/命令英文,文档中文;命令与 view id 统一 `deepseekHarness.*` 前缀
- webview 安全:CSP 无 inline script;postMessage 入参白名单结构校验;禁 `dangerouslySetInnerHTML`(markdown 白名单渲染);API key/credentials 不下发 webview、不进事件渲染

## 协议与版本

- **锁 dsh 版本**(现 0.1.0-rc.6,记入 docs/versions.md);升级只做专项 + 全量回归(R1/R4)
- 端点 `POST /api/<method>`(裸 `/api` 404);信封 `{type:"client-request", rpcId, method, payload}` → `server-response`;WS 帧为 `server-request`(host→client)。协议细节见 TASK §0.3,Phase 1 固化到 docs/http-bridge.md
- 服务仅绑 127.0.0.1、无鉴权:禁 `--host 0.0.0.0`;信任栅栏 loopback / `trustedHosts`,失败 403
- 实例 cwd 绑定:握手后对比 `host.describe.cwd` 与工作区,不一致必须警告(P1-15)

## 工具链

- 环境:node `^22.19 || >=24`;本机 node v22.22.3 / pnpm 10.32.1 / dsh 0.1.0-rc.6
- 服务:`npx @deepseek-ai/dsh web` → http://127.0.0.1:3080;健康检查 `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3080/`(不靠浏览器)
- **G0 提交门**(commit 前全绿,见 TASK §6.2):`pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build` —— 当前仓库尚无 package.json,Phase 0(P0-2~P0-8)落地后生效
- 测试:连 3080 的集成测试标 `@live`,无服务/无 key 时可跳过且保持全绿
- git:只 `git add <具体路径>`,禁 `add .` / `-A`;commit 后立即 push;信息用 `feat|fix|chore|refactor:` 前缀

## Pitfalls(实测)

- `dsh web` 不自动开浏览器,只打印 URL;前台进程,后台实例随会话结束而死
- headless/未配模型(`agent-default-model` / `DEEPSEEK_API_KEY`)退出码 1;headless 无 JSON 输出,stdout 即答案
- dev preview:上游 master(rc.5)与已装版本(rc.6)可能不一致,以 `dsh --version` 实测为准
- 上游约定:注册即 effect;model-visible ⟺ logged;插件而非改 loop;misconfiguration 启动即报错,不静默跳过
- `references/` 已 gitignore(本地才有设计草案),公开仓库见不到属正常;执行基准是 TASK.md

## 执行

阶段计划(Phase 0 脚手架 → 1 MVP → 2 IDE-native → 3 全能力 → 4 VS Code 原生)、每阶段 checklist、G0/G1/G2 Review 流程与记录模板、风险登记表(§8)、验收 Checkbox(§7)→ **全部在 [TASK.md](TASK.md)**,按阶段推进,每完成一步在 TASK.md 打勾。
