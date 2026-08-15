# versions.md — 依赖版本锁定

> 规则(TASK §0.5.8):所有 `@deepseek-ai/*` 相关与关键工具链版本锁定;升级只做专项 + 全量回归。

## 运行环境(2026-08-15 实测)

| 项 | 版本 | 备注 |
| --- | --- | --- |
| node | v22.22.3 | 满足上游 `^22.19.0 || >=24.0.0` |
| pnpm | 10.32.1 | 本仓库 `packageManager` 字段锁定 |
| dsh(全局) | 0.1.0-rc.6 | `~/.npm-global`;协议契约见 TASK §0.3,**升级必须回归** |
| dsh web 实例 | http://127.0.0.1:3080 | cwd=`/Users/minimx/dsh-for-vs-code`;模型 deepseek-v4-flash |

## 扩展依赖(devDependencies,精确版见 pnpm-lock.yaml)

| 包 | 范围 | 用途 |
| --- | --- | --- |
| typescript | ^5.7.0 | 编译(strict) |
| esbuild | ^0.25.0 | 双入口打包(extension + webview) |
| @types/vscode | ^1.95.0 | VS Code API 类型(与 engines 对齐) |
| oxlint | ^0.15.0 | lint(G0 门) |
| vitest | ^3.0.0 | 单测(G0 门) |
| @vscode/vsce | ^3.0.0 | VSIX 打包 |
| react / react-dom | ^18.3.1 | webview UI(esbuild 打进 bundle,不进 VSIX node_modules) |
