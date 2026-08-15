# Phase 4 Review(seq semantics)— 2026-08-19

- 范围:be57a56(Phase 4 VS Code 原生:ChatParticipant + code actions + 右键菜单),重点 P4-1 `askAndStream` 的 seq 语义
- 主题:**seq semantics check** — 事件日志水印消费的正确性 / 重复渲染面 / 结束与失败路径
- 结论:**PASS(修复后)**;P1 × 2(已修)、P2 × 3(记录)

## 语义基准(实测,rc.6)

docs/http-bridge.md goldenTimeline(probe.mjs 实采)per turn 事件顺序:

```
turn/start → step/start → user/message×N → session/title / request/* →
assistant/chunk(block-start reasoning → reasoning-delta×N →
            block-start text → text-delta×N → block-end×N → usage → finish) →
assistant/message → step/end → turn/end
```

- 正文全在 `text-delta`;live 流的 `assistant/message` 是**完成标记**(slim 记录无 contentLen ⇒ data 无 content);
  历史重建(seedHistory)的 `assistant/message` 才带 content(display.ts 的 `assistant` 分支就是为它准备的)。
- 水印语义:同一会话内 seq 单调递增,WS 帧按序到达;重连 = 重开流 + 重取历史(缓冲整体替换,非增量拼接)。

## 发现清单

### P1(已修,本次 round)

1. **断连/stream-error 后死等**:`askAndStream` 只在 `turn/end` 或 token 取消时退出。断连(WS 掉线→reconnecting,事件不可能再到达)、切换实例(rebase)、或 mid-turn 服务端 stream/error 后,轮询空转,chat 气泡永远"思考中"。→ 每轮检查 `ctx.runtime.currentState !== 'connected'` 即 flush 已累积文本并显式告知 UI(网络失败对 UI 可见),返回。
2. **message/块重复渲染面**:原实现把 `assistant/message` 的 content 与 `text-delta` 累积文本都渲染。rc.6 live 流 message 无 content,当前不重复;但一旦 wire 变化(或历史 content 混入 live 流),整段重复。→ 抽出纯逻辑 `chat-stream.ts`:同一 turn 已见 `text-delta` 则跳过 message 内容(正文只来自 chunks 时 message 即完成标记);仅当正文只来自 message 时才渲染。附带修复取消路径 `controller.stop` 未捕获的 rejection(记日志,不打断取消)。

### P2(记录,不改)

1. `session-manager.handleMuxFrame` 对 `session/event` 无条件 push,缓冲无 seq 单调守卫;单流内 WS 有序保证下安全,重放靠重连 re-seed 整体替换兜底。`state.lastSeq` 与 `session/subscribed` 的 lastSeq 写入无消费方(P1-5 已用 re-seed 实现,字段属遗留状态)。
2. **queue 模式的语义**:`session.prompt(mode: queue)` 在上一 turn 未结束时排队;`askAndStream` 从快照尾部起水印,会把上一 turn 的尾部增量(如残余 text-delta)渲染进本气泡。与 webview 行为一致(整个会话日志可见),属既有语义,非本次缺陷。
3. `registerChatParticipant` 收尾 `stream.markdown('')` 为空串占位;`request.references`(选中代码)未注入 prompt — P4-1 范围决策(不做双模型、不接管模型上下文),native.ts 路径已注入编辑器上下文。

## 修复内容

- 新增 `src/commands/chat-stream.ts`:seq 水印增量消费纯逻辑(零 vscode 依赖):`createChatStreamState` / `stepChatStream`
  — text-delta 累积、message 去重、turn/end 结束、其余事件只推进水印。
- `src/commands/chat-participant.ts`:`askAndStream` 改用 `stepChatStream`;断连显式收尾;stop 失败记日志。
- 新增 `test/chat-stream.test.ts`:8 例 — 水印跳过、块累积、message 去重、message-only、无 content、
  turn/end 收尾、黄金时间线回放(实测形状)、多轮推进 + 重放不重复。

## G0 gate(修复后重跑)

typecheck ✅ / lint ✅ 0w0e / test ✅ 48/48(含 8 例新 seq 语义单测)/ build ✅

## 遗留跟踪

- F17(ChatParticipant 人工验收)仍待 F5:气泡流式渲染、取消、断连提示、queue 排队时的上一 turn 尾部渲染观感。
- 若升级 dsh(R1),重跑 `node scripts/probe.mjs --write-doc` 核对 goldenTimeline:live `assistant/message` 是否仍无 content(若是,去重守卫可简化说明;若否,守卫正式生效)。
