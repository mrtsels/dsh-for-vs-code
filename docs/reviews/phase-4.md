# Phase 4 Review — 2026-08-15

- 范围:be57a56(Phase 4 VS Code 原生:ChatParticipant + code actions + 右键菜单,8 文件 +308/-24)
- 独立审查:hermes-subagent-reviewer(fresh context)
- 结论:**FAIL(PASS WITH NOTES 差一步)→ 修复后转 PASS**(P1×2 已清,详见 [final.md](final.md) G2 交付门)

## G0(实际重跑,be57a56)

| 门 | 结果 |
|---|---|
| typecheck | ✅ 0 错误 |
| lint | ⚠️ 1 warning(native.ts ctx 未使用)→ 已修 `_ctx` |
| test | ✅ 40/40(含 @live 连真实 3080)|
| build/package | ✅ 三入口;VSIX 14 files 无源码泄露 |

## 逐类核查

- **A 架构** ✅ 无 fork/无内嵌 runtime;runtime.ts 纯薄桥
- **B 会话/事件流** ✅ UI append-only + seq 去重;ChatParticipant 按 seq 增量流式取
- **C VS Code 集成** ⚠️ C3 runtime.dispose 未入清理集 → 已修
- **D Webview 安全** ⚠️ D4 链接协议依赖 react-markdown 默认过滤(记录);style-src unsafe-inline(Phase 0 遗留)
- **E 类型/错误** ⚠️ E2 handleRequest 顶层无 try/catch → 已由 panel.ts 统一 catch 覆盖
- **F 安全** ⚠️ F1 rollback path 无 workspace 内校验(记录,缓解存在)
- **G 工程** ✅ G5 lint warning → 已清
- **H 回归** ⚠️ H2 VSIX 混入配置文件 → 已修(.vscodeignore 补三项)

## Phase 1 G1 P1×5 回退核查

P1-1 多播 ✅ / P1-2 seq 去重 ✅ / P1-3 display ✅ / P1-4 帧窄校验 ✅ / P1-5 重连 re-seed ✅ — 全部未回退。

## P1 清单(已修复)

1. native.ts:33 registerCodeActions 参数 ctx 未使用(lint 门不绿)→ `_ctx`
2. docs/reviews/phase-2.md 与 phase-3.md 缺失(Q4 不满足)→ 已落盘

## 遗留 P2

见 [final.md](final.md) 遗留 P2 跟踪表(13 项,归属下一迭代维护)。

## 后续提交闭环

- 7e5df5c:Phase 2 G1 P1×4 修复(回滚/ask 失败/approval)
- <本轮>:Phase 3 G1 P1×2(持久化死代码/投影竞态)+ G2 P1×2 + P2×7
- G0 全绿(48/48 测试)
