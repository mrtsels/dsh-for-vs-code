# dsh-for-vs-code

DeepSeek Harness 的 VS Code 客户端。复用上游 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的 Agent Runtime / Cordis / Tools / Session / MCP / Skills,把浏览器 Web UI 换成 VS Code Extension + Webview,让 Agent 直接在 IDE 里工作。

## 当前状态

**设计阶段,尚无代码。** 架构方案见 [references/suggestions.md](references/suggestions.md);开发契约(环境、命令、约定、坑)见 [AGENTS.md](AGENTS.md)。

实现路线:

- **路线 A(MVP)** — VS Code ↔ HTTP ↔ `dsh web` Runtime,难度低
- **路线 B(终局)** — VS Code Extension 直接内嵌 Harness Runtime

路线图:Phase 1 最小可用(chat / streaming / session / 读写文件 / diff / 跑命令)→ Phase 2 IDE-native(编辑器上下文 / diagnostics / git diff / apply patch / terminal / 审批)→ Phase 3 全能力(MCP / skills / subagents / session fork / sandbox / goals)→ Phase 4 VS Code 原生(ChatParticipant / inline edit / CodeLens)。

## 怎么用

目前还没有可安装的扩展,这个仓库现在能做的两件事:

1. **看设计方案**:打开 `references/suggestions.md`。
2. **体验上游 Harness**(了解要嵌入的 Runtime 长什么样):

   ```sh
   npx @deepseek-ai/dsh web
   ```

   启动后访问 http://127.0.0.1:3080(需要 Node.js ≥ 22.19;首次聊天前在 Settings → Models 配置 DeepSeek API Key)。

脚手架完成后,这里会补上「构建 VSIX → 安装到 VS Code」和「F5 调试」的具体步骤。

## 开发

先读 [AGENTS.md](AGENTS.md)——它规定了本仓库的架构约束(不 fork 上游、不重写 agent-loop、UI 由 session event 驱动等)和已验证的坑。

## License

[MIT](LICENSE)
