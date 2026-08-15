# dsh-for-vscode

DeepSeek Harness(`dsh`)的 VS Code 客户端:映射现有 `dsh web` 实例(127.0.0.1:3080)的 Agent UI,复用上游 Agent Runtime / Cordis / Tools / Session / MCP,把浏览器 UI 换成 VS Code Extension + Webview。

## 开发

```sh
pnpm install        # 根 workspace
pnpm build          # esbuild 双入口(extension + webview)
pnpm watch          # 增量构建
pnpm typecheck / lint / test / package
```

按 F5 启动 Extension Development Host(需要本机 `dsh web` 已在 3080 运行:`npx @deepseek-ai/dsh web`)。

## 设计

- 插件是**现有 dsh web 实例的客户端**,不内嵌 runtime、不另起实例(TASK §0.1)
- 协议:HTTP `POST /api/<method>` + WS `events.mux` / `events.host`,见 [docs/http-bridge.md](../../docs/http-bridge.md)
- 执行基准:[TASK.md](../../TASK.md)
