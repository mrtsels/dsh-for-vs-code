# Phase 3 Review — 2026-08-15

- 范围:6d4e489(Phase 3 Harness 全能力,15 文件,+1021/-143)
- 独立审查:hermes-subagent-reviewer(fresh context;审查时 HEAD 已漂移到 be57a56,结论以 6d4e489 为准)
- 补充实证:live 采集 58 帧 projection,确认 projection seq 与事件 seq 同域单调,higher-seq-wins 设计正确;session.history 响应含 `{events, hasMore, projections{asOfSeq, values}}`,投影 key 12 种(goal/title/permissions 等)

## G0 摘要(实际重跑)

| 门 | 结果 | 说明 |
|---|---|---|
| typecheck | ✅ | tsc --noEmit,0 错误 |
| lint | ✅ | oxlint 0 warnings / 0 errors(50 files) |
| test | ✅ 40/40 | 10 files;runtime-live @live 真实连 3080 |
| build | ✅ | extension.js + web/index.js 双入口 |

## 降级诚实性核查(全部通过)

- MCP 无 API 面(实测 mcp.list 404)→ 仅文档 + 工具卡前缀标注 ✅
- jobs 无 unary(实测 404)、无 cancel → 只读推送缓存 ✅
- sandbox 无 RPC → UI 只显示 projection currentValue ✅
- skill 启用无 API → 列表只读 ✅
- credentials 仅 refs 探测,webview 零凭据路径(红线 D5)✅

## 发现清单

### P0
无。

### P1(必须修,已全部修复)

- [P1-A] extension.ts globalState 持久化死代码:只有 get 无 update,重启恢复功能实际不存在 → 修复:rememberActiveSession 在 session:open/create/fork + askWithContext 创建处写入
- [P1-B] session-manager seedHistory 无条件覆盖 projections,把 live 更高 seq 帧降级回旧基线(goal 状态闪回)→ 修复:统一 higher-seq-wins(asOfSeq > prev.seq 才 set)

### P2(记录;修复状态见括号)

1. SessionList fork 前置条件未防护(blank/running 时 ⧉ 常亮)✅(running 禁用 + tooltip)
2. interrupt 成功提示误用 error 通道 ✅(改 refreshSubagents,失败才报错)
3. gaps #5 承诺未兑现(host/archived-sessions-changed 类型未补)— 审查时已存在 wire.ts:141 ✅
4. probe-phase3.mjs 清理注释不实(archive 不删除会话)— 待修注释
5. 被 higher-seq-wins 拒绝的旧投影仍触发 onMeta ✅(仅应用时通知)
6. runtime.respond 无 HTTP 状态检查 ✅(随 Phase 2 G1 P1-4 一并修复)
7. App.tsx 切换会话 meta 状态不重置 ✅(openSession 清空 skills/jobs/subagents/goal)

## 遗留跟踪

- P1-A/P1-B 已修复并随 commit <Phase 2+3+4 G1/G2 修复> 提交;重跑 G0 全绿(48/48)
- probe 清理注释修正归入后续维护
