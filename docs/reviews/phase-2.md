# Phase 2 Review — 2026-08-15

- 范围:996aff9(Phase 2 IDE-native + Phase 1 G1 P1×5 修复,32 文件,+1371/-275)
- 独立审查:hermes-subagent-reviewer(fresh context,逐文件读 agent/vscode/webview/web/commands/extension.ts/build/test)
- 注:审查时工作区含未提交 Phase 3 预备(wire/session-manager/runtime + probe-phase3.mjs),非本次范围,已排除

## G0 摘要(实际重跑)

| 门 | 结果 | 说明 |
|---|---|---|
| typecheck | ✅ | tsc --noEmit(TS 5.7),0 error |
| lint | ✅ | oxlint 0 error / 3 warning(未使用 import,已随修复清理) |
| test | ✅ 36/36 | 10 文件全过;runtime-live @live 实际连真实 3080 |
| build | ✅ | extension.js + web/index.js + web/changes.js 三入口均产出 |

## Phase 1 五 P1 复检(逐条)

1. **P1-1 多播订阅 PASS** — runtime.ts subscribeStatus 用 Set 多播,controller 订阅 + extension onStatus 两路并存
2. **P1-2 UI seq 单调去重 PASS** — App.tsx 过滤 seq>尾部;session:open 无显式双推;重连 re-seed 安全
3. **P1-3 block-end 不重复 emit PASS** — display.ts 只切 mode,最终 flush 单次;回归样本断言只产 1 个流式气泡
4. **P1-4 WS 窄校验 PASS** — session-manager/controller 入口形状校验 + runtime pump try/catch 兜底
5. **P1-5 重连 re-seed PASS** — connected 且存在活动会话 → seedHistory

## 发现清单

### P0
无。

### P1(必须修,已全部修复,见"修复记录")

- [P1-1] workspace.ts 回滚不清理记录 + watcher 自记录翻转(回滚按钮实际不生效)
- [P1-2] 回滚已删除文件 → openTextDocument reject → unhandled rejection
- [P1-3] ask 失败路径无 error 回传 → webview pendingAsk 锁死,无法再发消息
- [P1-4] approval respond 错误路径未捕获;rpcId 缺失未实际应答

### P2(记录;已顺手修复带 ✅)

1. lint 未使用 import(git.ts/extension.ts)✅
2. runtime.request/respond 无 HTTP 超时(AbortController 建议)
3. 选区文本未限长 ✅(20k 截断)
4. collectDiagnostics 无活动编辑器时收集全工作区(行为易意外)
5. patch.ts 死代码 + changes-panel buildDiffText 与 util/diff.ts 重复
6. workspace snapshots/changes Map 无 GC
7. 多播监听器无异常隔离
8. session-manager lastSeq 乱序帧错位 + seedHistory 竞态(极小)
9. terminal child 'error' 后不 fire closeEmitter ✅
10. ChangesApp.tsx 消息处理无结构校验
11. changes:rollback/accept path 未校验在工作区内
12. 多 workspace 仅取首个根
13. git porcelain 引号转义路径未处理
14. Logger channel 未注册 dispose

## 修复记录(2026-08-15,commit 待提交)

- P1-1:rollback 成功后 changes.delete + snapshots 基线对齐为 before → watcher 事件对比无差异,不重入表/翻转 ✅
- P1-2:openTextDocument catch → 不存在则 workspace.fs.writeFile 重建 ✅
- P1-3:panel.ts onRequest 调用点 Promise.resolve().catch → post error;askWithContext 显式 try/catch → post error ✅
- P1-4:runtime.respond 加 res.status 检查显式抛错;handleApproval try/catch + rejected 兜底重试;rpcId 缺失提示 UI 不击穿 ✅

## 遗留跟踪

- P2 未修项(超时/GC/路径校验/porcelain 转义/diff 收敛)记入 docs/gaps.md 与 G2 交付门 P2 清单
- 修后验证:rollback → 条目消失且文件恢复;删除文件回滚可重建;停 3080 后 ask 有 error 且可继续发消息;approval + 杀 3080 无 unhandled rejection
