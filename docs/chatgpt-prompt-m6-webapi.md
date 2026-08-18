# ChatGPT 求助：M6 WebApiClient + ConnectionController 迁移注意事项

## 背景

VS Code 扩展（dsh-for-vs-code）是上游 deepseek-harness 的薄客户端。M1-M5 已完成 wire type 迁移。M6 是最后一步：用上游 `WebApiClient` 替换扩展自有的 `rpc.ts`，用 `ConnectionController` 替换扩展自有的 `runtime.ts`。

可行性已验证：两个上游类均可独立于 Cordis context 构造。

## 当前架构

### rpc.ts（85 行）— webview 侧 RPC
```typescript
export async function postRpc(baseUrl: string, method: string, payload: Record<string, unknown>): Promise<{ result?: RpcResult }> {
  const envelope: RpcEnvelope = { type: 'client-request', rpcId: `vscode-${Date.now()}-...`, method, payload };
  const res = await fetch(`${baseUrl}/api/${method}`, { method: 'POST', body: JSON.stringify(envelope) });
  return (await res.json()) as { result?: RpcResult };
}

export interface RpcResult { ok?: boolean; value?: unknown; }
export interface RpcEnvelope { type: 'client-request'; rpcId: string; method: string; payload: Record<string, unknown>; }
```

调用方：
- `bootstrap.ts` — `listSessions(baseUrl)`, `ensureWorkspace(baseUrl, path)`
- `settings-bridge.ts` — `postRpc(baseUrl, 'settings.update', ...)`
- `extension.ts` — `postRpc(baseUrl, 'agentPreset.list', ...)`

### runtime.ts（262 行）— 扩展进程内传输层
```typescript
export class HarnessRuntime implements RuntimeApi {
  private baseUrl: string
  private muxWs?: WebSocket
  private hostWs?: WebSocket
  private generation = 0
  private statusListeners = new Set<(status: RuntimeStatus) => void>()
  private lastDescription?: HostDescription
  private lastError?: string
  private currentState: RuntimeState = 'idle'
  private readyResolvers: Array<(d: HostDescription) => void> = []

  async connect(): Promise<HostDescription> { ... }  // 双 WS 连接
  async request<T>(method: string, payload: unknown): Promise<RpcResult<T>> { ... }  // HTTP unary
  async respond(rpcId: RpcId, value: unknown): Promise<RpcResult<unknown>> { ... }
  rebase(baseUrl: string): void { ... }  // 切换目标实例
  dispose(): void { ... }
  subscribeStatus(listener: (status: RuntimeStatus) => void): () => void { ... }
}
```

## 上游类架构

### WebApiClient（~200 行）
```typescript
class WebApiClient extends AbstractApiClient {
  // doFetch() = globalThis.fetch
  // openMux() = WebSocket
  // openHost() = WebSocket
  // 所有 IApiClient 域方法：sessions.list, workspace.list, settings.update...
}

// AbstractApiClient.resolveBase() 问题：
// Node 环境返回 'http://dsh.internal'（假 authority），无法到达 127.0.0.1:3080
// 解决方案：子类覆盖 resolveBase()
```

### ConnectionController（~300 行）
```typescript
class ConnectionController {
  constructor(api: IApiClient, sinks: ConnectionSinks, config?: ConnectionConfig)
  start(): void   // 启动连接循环（通过 onConnected 回调通知）
  stop(): void    // 停止并 abort 当前代
}

// ConnectionSinks = {
//   onMuxEnvelope?: (envelope: RpcRequest<MuxFrame>) => void
//   onHostEnvelope?: (envelope: RpcRequest<HostFrame>) => void
//   onConnected?: (description: HostDescription) => void
//   onStateChange?: (state: 'connected' | 'reconnecting') => void
// }
```

## 我需要你帮我想的

### 问题1：M6 的范围到底是什么？

两个方向：

**方向 A：完整替换（~100 行 wrapper）**
- 创建 `DshWebApiClient` 子类（覆盖 resolveBase）
- 创建 `ConnectionWrapper`（包装 ConnectionController，补齐 rebase/subscribeStatus/lastError）
- 替换 extension.ts 中所有 `HarnessRuntime` 使用
- 删除 runtime.ts 和 rpc.ts

**方向 B：部分替换（最小改动）**
- 只在扩展进程内用 `DshWebApiClient` 替换 `rpc.ts` 的 `postRpc` 调用
- 保留 runtime.ts（ConnectionController 缺少 rebase/multi-subscribe/lastError）
- rpc.ts 的 webview 侧保留

你建议哪个方向？为什么？

### 问题2：ConnectionController 缺少的功能怎么补？

HarnessRuntime 有以下 ConnectionController 没有的：

| 功能 | HarnessRuntime | ConnectionController |
|------|---------------|---------------------|
| rebase(baseUrl) | ✅ 动态切换 | ❌ 无 |
| subscribeStatus() 多播 | ✅ Set<listener> | ❌ 单槽 onStateChange |
| lastError | ✅ 字段 | ❌ 无 |
| currentState getter | ✅ getter | ❌ 无 |
| connect() 返回 Promise | ✅ | ❌ start() void |
| description 缓存 | ✅ | ❌ |

这些功能在扩展中是必须的吗？如果是，怎么补？

### 问题3：webview 侧的 rpc.ts 怎么处理？

`rpc.ts` 同时被扩展进程和 webview 使用：

```typescript
// webview session-view.tsx 内联 RPC
const rpc = (method: string, payload: unknown) => {
  return fetch(base + '/api/' + method, { ... }).then(res => res.json());
};
```

webview 不能直接用 WebApiClient（bundling 环境不同）。

选项：
- A）保留 rpc.ts（webview 侧独立）
- B）用上游 `createWebConnectionRpc()`（浏览器安全）
- C）webview 通过 message passing 走扩展进程的 API client

你建议哪个？

### 问题4：迁移顺序

如果做方向 A（完整替换），应该：
1. 先创建 DshWebApiClient + ConnectionWrapper
2. 还是先逐个替换 rpc.ts 调用方？

### 问题5：回滚策略

M6 是最大改动。如果迁移后出问题，怎么快速回滚？是否应该 feature flag？

### 问题6：test 策略

runtime.ts 有 `test/runtime.test.ts`，rpc.ts 有 `test/rpc.test.ts`。

迁移后这些 test 怎么处理？用 mock WebApiClient 还是用 mock ConnectionController？
