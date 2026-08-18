# ChatGPT 求助：M5 Generic compatibility layer 注意事项

## 背景

VS Code 扩展（dsh-for-vs-code）是上游 deepseek-harness 的薄客户端。M1-M4 已完成：基础设施、SkillEntry re-export、MuxFrame/HostFrame re-export、SessionEvent re-export。现在做 M5：处理 generic vs non-generic 类型差异。

## 核心差异

### ClientRequest
```typescript
// 上游（non-generic）
export interface ClientRequest {
  type: 'client-request'
  rpcId: RpcId
  method: string
  payload: unknown
}

// 扩展（generic）
export interface ClientRequest<P = unknown> {
  type: 'client-request'
  rpcId: RpcId
  method: string
  payload: P
}
```

### ServerResponse
```typescript
// 上游（non-generic）
export interface ServerResponse {
  type: 'server-response'
  rpcId: RpcId
  result: RpcResult<unknown>
}

// 扩展（generic）
export interface ServerResponse<T = unknown> {
  type: 'server-response'
  rpcId: RpcId
  result: RpcResult<T>
}
```

### ServerRequest
```typescript
// 上游（non-generic）
export interface ServerRequest {
  type: 'server-request'
  rpcId: RpcId
  method: string
  payload: unknown
}

// 扩展（generic）
export interface ServerRequest<P = unknown> {
  type: 'server-request'
  rpcId: RpcId
  method: string
  payload: P
}
```

## 扩展侧 generic 使用场景

### 1. runtime.ts — `request<T>()` 方法
```typescript
async request<T>(method: string, payload: unknown): Promise<RpcResult<T>> {
  const res = await fetch(`${this.baseUrl}/api/${method}`, {
    method: 'POST',
    body: JSON.stringify(encodeClientRequest(method, payload)),  // ← 构造 ClientRequest
  });
  return parseServerResponse<T>(await res.text()).result;  // ← 解析 ServerResponse<T>
}
```

调用方：
```typescript
const result = await this.runtime.request<{ accepted: true }>('session.prompt', { sessionId, ... });
const result = await this.runtime.request<{ items: SessionSummary[] }>('session.list', {});
```

### 2. rpc.ts — webview 侧 `postRpc()`
```typescript
export interface RpcResult {
  ok?: boolean;
  value?: unknown;
}
export interface RpcEnvelope {
  type: 'client-request';
  rpcId: string;
  method: string;
  payload: Record<string, unknown>;
}
export async function postRpc(baseUrl, method, payload): Promise<{ result?: RpcResult }> { ... }
```

这个 `RpcEnvelope` 是 `ClientRequest` 的子集（少了泛型），`RpcResult` 是上游 `RpcResult` 的宽松版。

### 3. encodeClientRequest / parseServerResponse
```typescript
export function encodeClientRequest(method: string, payload: unknown, rpcId: RpcId = createRpcId()): ClientRequest {
  return { type: 'client-request', rpcId, method, payload };
}
export function parseServerResponse<T = unknown>(text: string): ServerResponse<T> { ... }
```

## 我需要你帮我想的

### 问题1：是否需要 TypedClientRequest<P>？

ChatGPT 建议创建：
```typescript
type TypedClientRequest<P> = Omit<ClientRequest, 'payload'> & { payload: P }
```

但扩展的实际使用场景是：
- `encodeClientRequest()` 总是传 `payload: unknown`（运行时不知道具体类型）
- `request<T>()` 的泛型 T 只用于 **响应** 类型，不用于请求

也就是说，`ClientRequest<P>` 的泛型 P 在扩展里**实际上没有被利用**——所有构造都是 `ClientRequest`（default `unknown`）。

**是否可以直接 re-export 上游 non-generic `ClientRequest`，不创建 Typed 版本？**

### 问题2：ServerResponse<T> 是否真的需要？

`parseServerResponse<T>()` 返回 `ServerResponse<T>`，但调用链是：
```typescript
parseServerResponse<T>(text).result  // → RpcResult<T>
```

也就是说，`ServerResponse<T>` 的泛型只活在 `parseServerResponse` 内部，外部只消费 `result: RpcResult<T>`。

**是否可以直接 re-export 上游 non-generic `ServerResponse`，让 `parseServerResponse` 返回上游类型，调用方从 `.result` 拿 `RpcResult<T>`？**

### 问题3：rpc.ts 的 RpcEnvelope 和 RpcResult 怎么处理？

`rpc.ts` 定义了自己的 `RpcResult`（`{ok?: boolean, value?: unknown}`）和 `RpcEnvelope`（`ClientRequest` 的子集）。

这两个类型只在 webview 侧使用（session-view React 组件）。

选项：
- A）保留 rpc.ts 的本地类型（webview 不依赖上游）
- B）re-export 上游 `RpcResult` 替换本地版本（但 rpc.ts 的 `RpcResult` 没有 `error` 分支）
- C）创建兼容适配层

### 问题4：`encodeClientRequest` 返回类型

当前返回 `ClientRequest`（本地 generic 版本）。如果 re-export 上游 non-generic `ClientRequest`，返回类型自动变成上游类型。`payload` 从 `P` 变成 `unknown`。

这会影响调用方吗？目前所有调用都是：
```typescript
encodeClientRequest(method, payload)  // payload 已经是 unknown
```

所以应该没有影响。

### 问题5：M5 的实际改动量

如果结论是"直接 re-export 上游 non-generic 类型，不需要 Typed 版本"，那 M5 的改动可能非常小：
1. wire.ts 删除本地 `ClientRequest<P>`、`ServerResponse<T>`、`ServerRequest<P>`
2. wire.ts 添加 re-export
3. 验证 `encodeClientRequest` 和 `parseServerResponse` 编译通过

是这样吗？还是我遗漏了什么？
