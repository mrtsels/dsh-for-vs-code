# ChatGPT 求助：MuxFrame / HostFrame 拆分迁移注意事项

## 背景

VS Code 扩展（dsh-for-vs-code）是上游 deepseek-harness 的薄客户端。扩展通过两个 WebSocket 通道接收帧：

- `/api/events.mux` → `MuxFrame`（session 级事件）
- `/api/events.host` → `HostFrame`（host 级事件）

当前扩展的 `wire.ts` 把两个 union 都定义为本地宽松类型。目标是 re-export 上游精确类型。

## 核心问题

扩展的 `controller.ts` 里有一处 **跨 union 消费**：

```typescript
// controller.ts:47-52
handleMuxFrame(frame: MuxFrame): void {
  if (frame.type !== 'session/event' || frame.sessionId !== this.activeSessionId || !frame.event) return;
  // ...
  else if (frame.event.type === 'host/agent-error') this.setState('error');  // ← 这里
}
```

`frame.event.type === 'host/agent-error'` 检查的是 **SessionEvent 的 type 字段**，不是 MuxFrame 的 type 字段。但在本地宽松类型中，`SessionEvent.type` 是 `string`，所以能编译通过。

上游 `SessionEvent` 是精确 mapped type，`'host/agent-error'` 不是任何 SessionEvent 变体的 type——它是 **HostFrame 的 type**。这意味着这行代码实际上是在检查一个不可能的条件（永远 false），或者这里的逻辑应该处理的是 HostFrame 而不是 MuxFrame 内嵌的 SessionEvent。

## 上游精确类型

### MuxFrame（10 变体）
```typescript
type MuxFrame =
  | { type: 'session/event'; sessionId: SessionId; event: SessionEvent; view?: ToolEventView }
  | { type: 'session/subscribed'; sessionId: SessionId; lastSeq: number }
  | { type: 'approval/requested'; sessionId: SessionId; approvalId: ApprovalRequestId; toolName: string; callId?: CallId; reason?: string }
  | { type: 'approval/resolved'; sessionId: SessionId; approvalId: ApprovalRequestId; outcome: ApprovalOutcome }
  | { type: 'question/requested'; sessionId: SessionId; questions: AskUserQuestionItem[] }
  | { type: 'question/resolved'; sessionId: SessionId; questionRpcId: RpcId; outcome: 'answered' | 'cancelled' }
  | { type: 'session/queue'; sessionId: SessionId; items: QueuedInboxItem[] }
  | { type: 'session/jobs'; sessionId: SessionId; jobs: JobView[] }
  | { type: 'session/projection'; sessionId: SessionId; key: string; value: unknown; seq: number }
  | { type: 'stream/error'; error: RpcError }
```

### HostFrame（9 变体）
```typescript
type HostFrame =
  | { type: 'host/session-added'; sessionId: SessionId; blank: boolean; parentSessionId?: SessionId; origin?: 'subagent'; cwd?: string; agentPreset?: string }
  | { type: 'host/session-removed'; sessionId: SessionId }
  | { type: 'host/session-status'; sessionId: SessionId; running: boolean }
  | { type: 'host/agent-error'; sessionId: SessionId; message: string }
  | { type: 'host/workspace-changed'; workspace: WorkspaceView }
  | { type: 'host/workspace-removed'; workspaceId: WorkspaceView['workspaceId'] }
  | { type: 'host/workspace-order-changed'; workspaceIds: WorkspaceView['workspaceId'][] }
  | { type: 'host/archived-sessions-changed'; archivedSessionIds: SessionId[] }
  | { type: 'stream/error'; error: RpcError }
```

### 注意：`stream/error` 同时出现在两个 union 中

## 扩展侧消费者

### 1. runtime.ts — 帧分发（已经分开）
```typescript
// 两个独立回调，已经分开处理
onMuxFrame?: (frame: MuxFrame, rpcId?: RpcId) => void;
onHostFrame?: (frame: HostFrame, rpcId?: RpcId) => void;

// 分发逻辑
if (kind === 'mux') this.onMuxFrame?.(payload as MuxFrame, frame.rpcId);
else this.onHostFrame?.(payload as HostFrame, frame.rpcId);
```

### 2. session-manager.ts — 只处理 MuxFrame
```typescript
handleMuxFrame(frame: MuxFrame): void {
  if (frame.type === 'session/event') { ... }
  else if (frame.type === 'session/subscribed') { ... }
  switch (frame.type) {
    case 'session/projection': ...
    case 'session/jobs': ...
    case 'approval/requested': ...
    // ... 没有 host/* 变体
  }
}
```

### 3. controller.ts — 跨 union 问题
```typescript
handleMuxFrame(frame: MuxFrame): void {
  if (frame.type !== 'session/event' || ...) return;
  // ...
  else if (frame.event.type === 'host/agent-error') this.setState('error');  // ← 问题代码
}
```

这里 `frame.event.type` 是 SessionEvent 的 type，不是 MuxFrame 的 type。`'host/agent-error'` 作为 SessionEvent.type 在上游不存在。

### 4. extension.ts — 接线
```typescript
runtime.onMuxFrame = (frame, rpcId) => {
  sessions.handleMuxFrame(frame);
  controller.handleMuxFrame(frame);
};
runtime.onHostFrame = (frame) => { ... };
```

## 上游 MuxFrame vs 本地 MuxFrame 差异

| 字段 | 上游 | 本地 |
|------|------|------|
| sessionId | `SessionId` (branded) | `string` |
| event | `SessionEvent` (精确 mapped type) | `SessionEvent` ({type:string; data:EventData}) |
| view | `ToolEventView` | `unknown` |
| approvalId | `ApprovalRequestId` (branded) | `string` |
| callId | `CallId` (branded) | `string` |
| questions | `AskUserQuestionItem[]` | `unknown[]` |
| jobs | `JobView[]` (branded id) | `unknown[]` |
| error | `RpcError` (discriminated ~40 codes) | `RpcError` ({code:string}) |

## 我需要你帮我想的

### 问题1：controller.ts 的 `host/agent-error` 检查

这行代码 `frame.event.type === 'host/agent-error'` 到底应该：
- A）删掉（因为 `host/agent-error` 是 HostFrame 的 type，不是 SessionEvent 的 type，这个条件永远 false）
- B）移到 `handleHostFrame` 里处理（因为 `host/agent-error` 确实是 HostFrame 变体）
- C）保留但改成检查 HostFrame（需要 controller 同时接收 MuxFrame 和 HostFrame）

### 问题2：拆分策略

runtime.ts 已经分开 `onMuxFrame`/`onHostFrame`。session-manager.ts 只处理 MuxFrame。extension.ts 接线也是分开的。

在这种情况下，M3 的实际改动有多大？是不是只需要：
1. wire.ts re-export 上游 MuxFrame 和 HostFrame
2. controller.ts 的 `handleMuxFrame` 签名不变（它只处理 MuxFrame）
3. 把 `host/agent-error` 检查移到别处或删掉
4. 适配 branded SessionId → string 的消费点

### 问题3：`stream/error` 同时在两个 union 中

上游 MuxFrame 和 HostFrame 都有 `stream/error` 变体。扩展的 runtime.ts 已经分别构造：
```typescript
if (kind === 'mux') this.onMuxFrame?.({ type: 'stream/error', error });
else this.onHostFrame?.({ type: 'stream/error', error });
```

re-export 上游类型后，`{ type: 'stream/error', error }` 需要满足两个 union 的类型。这会不会有问题？还是说 TypeScript 会自动推导为 `MuxFrame | HostFrame`？

### 问题4： branded SessionId 的消费点

如果 re-export 上游 MuxFrame，`sessionId` 字段变成 `SessionId`（branded）。扩展里所有用 `frame.sessionId === someString` 的比较都需要适配。

有哪些地方需要改？最干净的适配方式是什么？

### 问题5：是否需要 `IncomingFrame = MuxFrame | HostFrame` 类型？

ChatGPT 建议定义 `type IncomingFrame = MuxFrame | HostFrame`。在扩展的实际架构中（runtime 已经分开两个回调），这个类型有用吗？还是说它只会增加混淆？
