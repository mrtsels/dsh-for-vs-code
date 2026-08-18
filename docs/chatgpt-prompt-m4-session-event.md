# ChatGPT 求助：M4 SessionEvent exact union 迁移注意事项

## 背景

VS Code 扩展（dsh-for-vs-code）是上游 deepseek-harness 的薄客户端。M3 已完成 MuxFrame/HostFrame re-export 上游精确类型。现在要做 M4：把本地宽松 `SessionEvent` 也换成上游精确类型。

## 当前类型状态

### 本地 SessionEvent（wire.ts）
```typescript
export interface SessionEvent {
  type: string;
  seq: number;
  time: number;
  data: EventData;
}
export interface EventData {
  turn?: number;
  step?: number;
  content?: PromptPart[];
  chunk?: Chunk;
  title?: string;
  reason?: string;           // ← string，不是 TurnEndReason
  source?: { kind: string; rpcId?: string };
  tool?: unknown;
  [key: string]: unknown;    // ← catch-all
}
```

### 上游 SessionEvent（core/session/types.ts）
```typescript
type SessionEvent<T extends SessionEventType = SessionEventType> = {
  [K in SessionEventType]: {
    type: K
    seq: number
    time: number
    data: SessionEventMap[K]
    ignorable?: true
  }
}[T]

// 13+ 精确事件类型：
SessionEventMap = {
  'turn/start': { turn: number }
  'turn/end': { turn: number; reason: TurnEndReason }
  'step/start': { turn: number; step: number }
  'step/end': { turn: number; step: number }
  'user/message': UserMessage
  'assistant/chunk': { turn: number; step: number; chunk: StreamChunk }
  'assistant/message': { turn: number; step: number; message: AssistantMessage; usage?: TokenUsage }
  'tool/call': { turn: number; step: number; callId: CallId; name: string; arguments: string }
  'tool/result': { turn: number; step: number; message: ToolResultMessage; error?: ...; meta?: JsonValue }
  'todo/write': { todos: TodoItem[] }
  'request/header': { header: EpochHeader; reason: RequestHeaderReason }
  'request/context': RequestContext
  'session/end-seed': Record<string, never>
}
```

## 实际编译错误

### 错误1：上游 MuxFrame.event 类型 ≠ 本地 SessionEvent
```
session-manager.ts(63,27): Type 'SessionEvent' (upstream) is not assignable to
parameter of type 'SessionEvent' (local). The types of 'data.reason' are incompatible:
Type 'TurnEndReason' is not assignable to type 'string | undefined'.
```
上游 MuxFrame 的 `event` 字段是上游 `SessionEvent`，但 session-manager 把它 push 进本地 `SessionEvent[]` 数组。

### 错误2：`session/title` 不是上游事件类型
```
session-manager.ts(67,13): This comparison appears to be unintentional because
the types '"turn/start" | "turn/end" | ...' and '"session/title"' have no overlap.
```
`session/title` 在扩展中使用，但上游 SessionEventMap 里没有这个类型。

### 错误3：test 文件构造的 SessionEvent 类型不匹配
```
test/session-manager.test.ts(32,70): Type 'SessionEvent' (local) is not assignable
to type 'SessionEvent' (upstream).
```

## 扩展消费的事件类型

session-manager.ts 消费：
- `turn/start` → `state.running = true`
- `turn/end` → `state.running = false`
- `session/title` → `state.title = ...`（⚠️ 上游不存在）

controller.ts 消费：
- `turn/start` → setState('running')
- `turn/end` → setState('idle')

## 我需要你帮我想的

### 问题1：`session/title` 怎么处理？

扩展用了 `frame.event.type === 'session/title'` 来提取会话标题。但上游 SessionEventMap 里没有 `'session/title'`。

选项：
- A）检查上游：`session/title` 是不是通过 plugin extension point 注册的？上游实际会不会发这个事件？
- B）标题应该从 `SessionSummary.projections.values.title` 获取（不是从事件流）
- C）保留为本地扩展事件（不 re-export 上游 SessionEvent，而是 Omit + extend）

### 问题2：`data.reason` 类型差异

上游 `turn/end` 的 `data.reason` 是 `TurnEndReason`：
```typescript
type TurnEndReason = TurnEndReasonMap[keyof TurnEndReasonMap]
// = { kind: 'completed' } | { kind: 'aborted' } | { kind: 'blocked' }
// | { kind: 'error' } | { kind: 'max-tokens' } | { kind: 'interrupted' }
```

扩展的 `data.reason` 是 `string`。session-manager 里不直接使用 reason 值（只检查 type），所以类型差异不影响运行。但编译会报错。

建议：re-export 上游后，消费方通过 `switch (event.type)` narrowing 后 `event.data.reason` 自动推导为 `TurnEndReason`，不需要手动适配。

### 问题3：re-export 策略

如果 re-export 上游 `SessionEvent`，那么：
- `MuxFrame.event` 字段的类型自动对齐（都是上游 SessionEvent）
- session-manager 的 `state.events: SessionEvent[]` 需要改成上游类型
- 所有 `event.data.xxx` 访问需要 narrowing

但如果不 re-export，保持本地 `SessionEvent`，那 `MuxFrame.event`（上游类型）和本地 `SessionEvent` 之间的类型冲突怎么解决？

### 问题4：`SessionEvent` 作为 buffer 类型

session-manager 把 `frame.event` push 进 `state.events: SessionEvent[]`，后来通过 `onEvents` 回调传给 UI。

如果改成上游 `SessionEvent`，这个 buffer 的类型也跟着变。UI 消费端（bridge.ts、webview）能处理精确类型吗？还是说需要在 buffer 边界做 normalization？

### 问题5：是否需要同时 re-export `SessionEventMap`、`TurnEndReason` 等？

还是说只需要 re-export `SessionEvent`，其他类型由 TypeScript 自动推导？
