# ChatGPT 求助：TypeScript branded type / precise union 与宽松本地类型的迁移策略

## 背景

我在做一个 VS Code 扩展（dsh-for-vs-code），它是上游开源项目 deepseek-harness 的薄客户端。上游有一套 wire protocol 类型定义在 `@deepseek-ai/dsh-host-apiproxy/api` 等包中，扩展目前用自己的宽松类型副本。目标是消除重复，改为直接使用上游类型。

**核心矛盾**：上游类型比扩展的更精确（branded string、discriminated union、non-generic），扩展的宽松设计是有意为之（消费方用 `switch/default:break`，webview 跨层传递不需要精确类型）。直接 re-export 上游类型导致消费者编译失败。

## 具体类型差异

### 差异1：branded vs plain string
```typescript
// 上游（精确）
export type RpcId = Branded<'rpc-id'>  // = string & { readonly [BRAND]: 'rpc-id' }
export function RpcId(id: string): RpcId { return id as RpcId }

// 扩展（宽松）
export type RpcId = string
// 消费方构造：const rpcId = crypto.randomUUID()  // 返回 string，不是 Branded<'rpc-id'>
```

### 差异2：non-generic vs generic
```typescript
// 上游（精确）
export interface ClientRequest {
  type: 'client-request'
  rpcId: RpcId
  method: string
  payload: unknown  // 非泛型
}
export interface ServerResponse {
  type: 'server-response'
  rpcId: RpcId
  result: RpcResult<unknown>  // 非泛型
}

// 扩展（宽松）
export interface ClientRequest<P = unknown> {
  type: 'client-request'
  rpcId: RpcId
  method: string
  payload: P  // 泛型，消费方用 ClientRequest<{sessionId: string}> 等
}
export interface ServerResponse<T = unknown> {
  type: 'server-response'
  rpcId: RpcId
  result: RpcResult<T>  // 泛型
}
```

### 差异3：discriminated union vs loose bag
```typescript
// 上游 RpcError（精确，~40 个错误码）
export type RpcError = {
  [K in keyof RpcErrorDetailsMap]: {
    code: K
    message: string
    details: RpcErrorDetailsMap[K]
  }
}[keyof RpcErrorDetailsMap]
// 即 code 只能是 'internal' | 'not-found' | 'settings-rejected' | ... 等具体字面量

// 扩展 RpcError（宽松）
export interface RpcError {
  code: string  // 任意字符串
  message: string
  details: unknown
}
// 消费方：{ code: 'internal', message: '...', details: {} }  ← code 是 string，不是字面量
```

### 差异4：MuxFrame 精度
```typescript
// 上游 MuxFrame（精确 discriminated union，10+ 变体）
export type MuxFrame =
  | { type: 'session/event'; sessionId: SessionId; event: SessionEvent<'turn/start' | 'turn/end' | ...>; ... }
  | { type: 'session/subscribed'; sessionId: SessionId; lastSeq: number }
  | ... // 10+ 变体，每个变体的字段类型精确

// 扩展 MuxFrame（宽松 union）
export type MuxFrame =
  | { type: 'session/event'; sessionId: string; event: SessionEvent; view?: unknown }
  | { type: 'session/subscribed'; sessionId: string; lastSeq: number }
  | ... // 字段用 string/unknown

// 消费方 switch：
switch (frame.type) {
  case 'session/event': /* 用 frame.event.data.turn */ break
  case 'host/agent-error': /* ⚠️ 上游 MuxFrame 没有这个变体！它是 HostFrame 的 */ break
  default: break
}
```

### 差异5：SessionEvent 映射类型
```typescript
// 上游 SessionEvent<T>（mapped type）
export type SessionEvent<T extends SessionEventType = SessionEventType> = {
  [K in SessionEventType]: {
    type: K
    seq: number
    time: number
    data: SessionEventMap[K]  // 每个事件类型的 data 不同
    ignorable?: true
  }
}[T]

// 上游 SessionEventMap
export interface SessionEventMap {
  'turn/start': { turn: number }
  'turn/end': { turn: number; reason: TurnEndReason }  // TurnEndReason = {kind:'completed'} | ...
  'user/message': { content: PromptContentPart[] }
  'assistant/chunk': { chunk: StreamChunk }
  // ...13+ 事件类型
}

// 扩展 SessionEvent（宽松）
export interface SessionEvent {
  type: string  // 任意字符串
  seq: number
  time: number
  data: EventData  // unknown bag
}
export interface EventData {
  turn?: number
  step?: number
  content?: PromptPart[]
  chunk?: Chunk
  title?: string
  reason?: string  // ← string，不是 TurnEndReason discriminated union
  source?: { kind: string; rpcId?: string }
  tool?: unknown
  [key: string]: unknown
}
```

## 实测遇到的编译错误

当我尝试 `export type { ClientRequest } from '@deepseek-ai/dsh-host-apiproxy/api'` 后：

**错误1**：`RpcResult<unknown>` 不能赋值给 `RpcResult<T>`
```
Type '{ ok: true; value: unknown; }' is not assignable to type '{ ok: true; value: T; }'
```
原因：上游 `RpcResult` 不是泛型，`result` 是 `RpcResult<unknown>`，但扩展代码用 `RpcResult<T>` 期望泛型。

**错误2**：`string` 不能赋值给字面量联合
```
Type 'string' is not assignable to type '"internal"'
```
原因：扩展代码构造 `{ code: 'internal', ... }` 但 `code` 类型是 `string`，上游 RpcError 要求精确字面量。

**错误3**：MuxFrame switch 分支不完整
```
This comparison appears to be unintentional because the types '...' and '"host/agent-error"' have no overlap
```
原因：扩展 switch 对 MuxFrame 比较 `'host/agent-error'`，但这是 HostFrame 的变体，不在上游 MuxFrame union 中。

**错误4**：SessionEvent 类型不兼容
```
Type '{ type: "turn/end"; data: { reason: TurnEndReason; }; }' is not assignable to type 'SessionEvent'
The types of 'data.reason' are incompatible: Type 'TurnEndReason' is not assignable to type 'string | undefined'
```
原因：上游 MuxFrame 的 event 字段是精确 SessionEvent，data.reason 是 TurnEndReason（discriminated union），但扩展的 SessionEvent.data.reason 是 string。

## 我需要你帮我想的方案

### 方案 A：保留本地类型，记录映射（已采用）
```typescript
// wire.ts 顶部注释记录上游对应关系
// 所有类型保留本地定义，不做 re-export
// 优点：零改动消费者，类型安全不降级
// 缺点：类型重复，vendor rev 升级时需手动比对
```

### 方案 B：re-export + 类型断言适配层
```typescript
import type { ClientRequest as Upstream } from '@deepseek-ai/dsh-host-apiproxy/api'

// 适配器：让上游类型兼容扩展的泛型用法
export type ClientRequest<P = unknown> = Omit<Upstream, 'payload'> & { payload: P }

// 适配器：RpcId 从 branded 降到 string
export type RpcId = string  // 保留本地定义，不 re-export

// 优点：类型来自上游，自动跟踪变更
// 缺点：适配层本身可能很复杂，某些差异无法桥接
```

### 方案 C：消费者逐步收窄后 re-export
```typescript
// 第一步：消费者全部改用精确类型
//   runtime.ts: rpcId 改用 RpcId('...') 工厂构造
//   session-manager.ts: switch 补齐所有 MuxFrame 变体
//   bridge.ts: SessionEvent.data.reason 改用 TurnEndReason
// 第二步：re-export 上游类型
// 优点：类型完全对齐上游
// 缺点：改动量大，涉及 6+ 文件的消费逻辑
```

### 方案 D：混合策略
```typescript
// 能直接 re-export 的就 re-export（RpcResult、JobView、SkillEntry）
// 不能的保留本地 + 记录映射（RpcId、MuxFrame、SessionEvent）
// 优点：渐进式，风险可控
// 缺点：两套策略并存，心智负担
```

**请评估这四个方案的优劣，并推荐一个。特别关注：**
1. TypeScript 的 branded type 到 plain string 的向下兼容有没有更优雅的方式？
2. discriminated union 的泛型参数能不能通过 `infer` 或 conditional type 桥接？
3. MuxFrame 扩展侧的 switch 用了 HostFrame 的变体（`host/agent-error`），这种跨 union 消费在 TypeScript 里有没有标准处理方式？
4. 如果选方案 C，有没有渐进式迁移的 TypeScript 技巧（比如 `@ts-expect-error` 标记过渡期）？
