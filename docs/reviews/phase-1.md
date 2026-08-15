# Phase 1 Review — 2026-08-15

- 范围:e45038c(Phase 1 MVP,36 文件)+ 292e91c(Phase 0 修复复检)
- G0 gate(实际重跑):typecheck ✅ / lint ✅ 0w0e / test ✅ 23/23(含 @live 连真实 3080)/ build ✅
- 独立审查:reviewer hermes-subagent-reviewer(独立上下文,逐文件读 src/agent、src/webview、web、commands、util、test、probe、build、http-bridge 黄金样本)
- 发现:P0 × 0 / P1 × 5 / P2 × 7
- 结论:**FAIL**(P1×5 未清;P1-2/P1-3 为首次 F5 可见的功能性重复 bug,P1-1 状态不同步,P1-4 非法帧崩溃面,P1-5 重连事件缺口)
- Phase 0 三 P1 复检:nonce 单点 PASS / lockfile PASS / 骨架加载 PASS

## 发现清单

### P1

1. extension.ts:60 + controller.ts:23-32 | runtime.onStatus 单槽被 extension 覆盖,controller 状态机失效(断连不置 disconnected、重连不恢复)→ 改多播订阅或单点分发
2. App.tsx:33-41 + extension.ts:121,137-141 | seedHistory 全量历史重复追加;session:open 双推(seed onEvents + 显式 snapshot)→ UI 按 seq 单调去重或发 diff
3. display.ts:90-101,150 | block-end×2 + 最终 flush 各推一次累积文本;黄金时间线回放实测输出 3 个相同 streaming 气泡 → block-end 只切 mode 不 emit
4. runtime.ts:179-187 + session-manager.ts:33-36 | WS payload 未窄化强转 MuxFrame;畸形 session/event 在 onmessage 内抛未捕获 TypeError → 入口窄校验 + dispatch 兜底
5. extension.ts:60-79 | 重连只刷新列表不 re-seed 历史,断线期间事件缺口;session/subscribed 的 lastSeq 未消费 → connected 后重取活动会话历史

### P2

1. extension.ts:164 session.list 失败仅 debug 日志,UI 无提示
2. runtime.ts:37,40 streamOpenTimeoutMs 声明未使用;WS open 无超时
3. controller.ts:81-84 handleHostFrame 空操作死代码
4. bridge-client.ts:24-31 扩展消息仅有 'type' in data 弱校验
5. terminal.ts 未被引用且 Terminal 无 dispose
6. App.tsx ask 无 in-flight 防重
7. 继承 Phase0 P2-2 style-src 'unsafe-inline'

## 遗留跟踪

- P1-2 ↔ P1-5 互相关联:seq 去重落地后重连 re-seed 才安全,建议合并修
- 修复后重跑 G0 + 手动 F5 场景 1/3/4,回发 reviewer 复检

## 修复记录(2026-08-15,随 Phase 2 commit 提交)

- P1-1 runtime.onStatus 单槽 → 多播 `subscribeStatus`(runtime.ts);controller 改订阅 + 新增 dispose;extension 也订阅,两路并存 ✅
- P1-2 UI 按 seq 单调去重(web/App.tsx event case,跳过 seq ≤ 尾部);session:open 已无显式双推 ✅
- P1-3 display.ts block-end 只切 mode 不 emit,最终 flush 统一推一次;回归单测(真实双 block-end 样本)→ 36/36 ✅
- P1-4 runtime.pump dispatch 包 try/catch(坏帧按 stream/error 通知,不击穿宿主);session-manager/controller 入口窄校验(sessionId/event/seq 形状)✅
- P1-5 runtime connected → 若存在活动会话自动 re-seed 历史(依赖 P1-2 去重,重复推送安全)✅
- P2-1 session.list 失败 → UI error 提示 ✅
- P2-2 streamOpenTimeoutMs 落地:WS open 超时关闭并 reject ✅
- P2-3 handleHostFrame 死代码删除 ✅
- P2-4 bridge-client 扩展消息类型白名单 + 关键负载结构校验 ✅
- P2-5 terminal onDidCloseTerminal 自回收 dispose ✅
- P2-6 ask in-flight 防重(pendingAsk,事件/错误到达解锁)✅
- P2-7 style-src unsafe-inline:延后(React 内联 style 依赖,样式外置属重构,记入 gaps)
