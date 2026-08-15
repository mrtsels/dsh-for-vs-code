# Phase 4 Review + G2 交付门 — 2026-08-15

- 范围:HEAD be57a56(Phase 4 VS Code 原生:ChatParticipant + code actions + 右键菜单)
- 独立审查:hermes-subagent-reviewer(fresh context,最高标准,全仓库逐类核查)
- 审查基准:be57a56;其后主 agent 已提交 7e5df5c(Phase 2 G1 P1×4 修复)与本轮 G1/G2 修复

## G0 摘要(实际重跑,be57a56)

| 门 | 结果 | 说明 |
|---|---|---|
| typecheck | ✅ EXIT=0 | tsc --noEmit 0 错误 |
| lint | ⚠️ 1 warning | native.ts registerCodeActions ctx 未使用 → 已修(_ctx) |
| test | ✅ 40/40 | 含 runtime-live @live 连真实 3080 |
| build | ✅ | extension.js 60.5kb + web/index.js 599.7kb + changes.js 258.3kb |
| package | ✅ | VSIX 14 files;无 .map/src/web 泄露(审查时 tsconfig/vitest/oxlintrc 混入 → 已修) |

## §6.4 逐类核查(A~H)

- **A 架构** ✅:无 @deepseek-ai/* 依赖、无 fork;runtime.ts 纯薄桥;lockfile 已提交
- **B 会话/事件流** ✅:UI 零 messages[] 自维护;seq 单调去重;重连 re-seed;ChatParticipant 按 seq 增量取
- **C VS Code 集成** ⚠️→✅:C1/C2/C4/C5 ✅;C3 runtime.dispose 未入清理集 → 已修
- **D Webview 安全** ⚠️:D1/D2/D3/D5 ✅;D4 链接协议依赖 react-markdown 默认过滤(记录);style-src unsafe-inline(Phase 0 P2-2,已记 gaps)
- **E 类型/错误** ⚠️→✅:E1/E3/E4/E5 ✅;E2 handleRequest 顶层无 try/catch → 已由 panel.ts onRequest 调用点统一 catch 覆盖(P1-3 修复)
- **F 安全** ⚠️:F2/F3 ✅;F1 rollback path 无 workspace 内校验(记录,缓解存在)
- **G 工程** ✅:ESM/strict/测试覆盖齐;G5 lint warning → 已清
- **H 回归** ⚠️→✅:H1 ✅;H2 VSIX 混入配置文件 → 已修(.vscodeignore 补三项);H3 待 F5

## Phase 1 G1 P1×5 回退核查

P1-1 多播 ✅ / P1-2 seq 去重 ✅ / P1-3 display ✅ / P1-4 帧窄校验 ✅ / P1-5 重连 re-seed ✅ — **全部未回退**

## G2 结论与处置

审查结论:**FAIL(PASS WITH NOTES 差一步)** — 2 条 P1,均已在 HEAD 之后修复:

1. native.ts:33 ctx 未使用 → 已改 `_ctx`,lint 0 warning ✅
2. docs/reviews/phase-2.md/phase-3.md 缺失 → phase-2.md 已随 7e5df5c 落盘;phase-3.md 已落盘 ✅

**P1/P0 清零后,本交付门转 PASS。** 遗留 P2 见下节跟踪;F 类人工项(§7 F1~F18、Q6/Q7/Q8、PK2)待用户 F5。

## 遗留 P2 跟踪(归属 TASK §8 风险表)

| # | 项 | 归属 |
|---|---|---|
| 1 | runtime.request/respond 无 HTTP 超时(AbortController) | 下一迭代维护 |
| 2 | collectDiagnostics 无活动编辑器时收集全工作区 | 下一迭代维护 |
| 3 | patch.ts 死代码 / buildDiffText 与 util/diff.ts 重复 | 下一迭代维护 |
| 4 | snapshots/changes Map 无 GC | 下一迭代维护 |
| 5 | 多播监听器无异常隔离 | 下一迭代维护 |
| 6 | lastSeq 乱序帧错位(极小) | 下一迭代维护 |
| 7 | ChangesApp 消息处理无结构校验 | 下一迭代维护 |
| 8 | rollback/accept path 未校验在工作区内 | 下一迭代维护 |
| 9 | 多 workspace 仅取首个根 | 下一迭代维护 |
| 10 | git porcelain 引号转义路径未处理 | 下一迭代维护 |
| 11 | ChatView 链接协议无显式白名单 | 下一迭代维护 |
| 12 | style-src 'unsafe-inline' | 已记 gaps |
| 13 | probe-phase3.mjs 清理注释不实 | 下一迭代维护 |

## 交付门 Checkbox 状态(§7)

- 实测项:Q1 ✅ / Q2 ✅(修复后 0 warning)/ Q3 ✅ 48/48 / PK1 ✅ / PK3 ✅ / PK4 ✅ / D1~D7 ✅
- 人工项:F1~F18 + Q6/Q7/Q8 + PK2 → **待 F5**
