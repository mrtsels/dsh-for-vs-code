# D2/D3 迁移可行性评估

## 概要

| 任务 | 上游类 | 能否独立构造 | 推荐迁移 | 难度 |
|------|--------|-------------|----------|------|
| D2: rpc.ts → WebApiClient | `WebApiClient` | ✅ 无 Cordis 依赖 | 部分替换（需 baseUrl 适配） | 中 |
| D3: runtime.ts → ConnectionController | `ConnectionController` | ✅ 无 Cordis 依赖 | 全量替换 | 中高 |

**核心发现：两个上游类均可独立于 Cordis context 构造，不需要任何 DI 框架。**

---

## D2: rpc.ts → WebApiClient

### 当前 rpc.ts 职责（85 行）

| 函数 | 用途 | 调用方 |
|------|------|--------|
| `postRpc(baseUrl, method, payload)` | 通用 RPC 信封 POST | bootstrap.ts, settings-bridge.ts, extension.ts |
| `listSessions(baseUrl)` | session.list RPC + 解析 | bootstrap.ts |
| `ensureWorkspace(baseUrl, path)` | workspace.list + workspace.create | bootstrap.ts |
| `SessionItem` 接口 | 会话列表项投影 | webview session-view |

### WebApiClient 架构分析

```
AbstractApiClient (abstract)
  ├── doFetch(): 平台传输（浏览器 vs Node）
  ├── resolveBase(): URL 基础（location.origin 或 http://dsh.internal）
  ├── callUnary(): 信封封装 + zod 校验 + 响应解包
  ├── readSse(): SSE 流读取
  └── 所有 IApiClient 域方法（sessions.list, workspace.list, ...）

WebApiClient extends AbstractApiClient
  ├── doFetch() = globalThis.fetch
  ├── openMux() = WebSocket（替代 SSE）
  └── openHost() = WebSocket
```

**无 Cordis 依赖。** `apply(ctx)` 函数在 `client/index.ts` 中是 Cordis 插件包装器，但 `WebApiClient` 类本身零依赖。

### 关键问题：baseUrl 适配

**问题**：`AbstractApiClient.resolveBase()` 在非浏览器环境下返回 `http://dsh.internal`（假 authority），但 VS Code 扩展需要连接 `http://127.0.0.1:3080`。

```typescript
// AbstractApiClient 中的 resolveBase()
protected resolveBase(): string {
  const loc = (globalThis as { location?: { origin?: string } }).location
  return loc?.origin !== undefined && loc.origin !== 'null' ? loc.origin : INTERNAL_BASE
  // Node 环境 → 'http://dsh.internal'  ← 无法到达 3080
}
```

**解决方案：创建子类覆盖 resolveBase()**

```typescript
// apps/vscode/src/agent/dsh-web-api-client.ts
import { WebApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'

export class DshWebApiClient extends WebApiClient {
  constructor(private readonly baseUrl: string) {
    super()
  }

  protected override resolveBase(): string {
    return this.baseUrl
  }
}

// 使用
const api = new DshWebApiClient('http://127.0.0.1:3080')
```

### postRpc → IApiClient 方法映射

| 当前 rpc.ts 调用 | IApiClient 等价 | 适配难度 |
|-----------------|----------------|----------|
| `postRpc(url, 'session.list', {})` | `api.sessions.list({})` | ⚠️ 响应结构不同 |
| `postRpc(url, 'workspace.list', {})` | `api.workspace.list({})` | ⚠️ 响应结构不同 |
| `postRpc(url, 'workspace.create', {path})` | `api.workspace.create({path})` | ⚠️ 响应结构不同 |
| `postRpc(url, 'session.create', {})` | `api.sessions.create({})` | ⚠️ 响应结构不同 |
| `postRpc(url, 'settings.update', {...})` | `api.settings.update({...})` | ⚠️ 响应结构不同 |
| `postRpc(url, 'settings.describe', {})` | `api.settings.describe({})` | ⚠️ 响应结构不同 |
| `postRpc(url, 'agentPreset.list', {})` | `api.agentPresets.list({})` | ⚠️ 响应结构不同 |

### ⚠️ 响应结构差异（核心适配缝）

**当前 rpc.ts** 返回原始 JSON：
```typescript
// postRpc 返回 { result?: RpcResult }
// RpcResult = { ok?: boolean; value?: unknown }
const body = await postRpc(baseUrl, 'session.list', {});
const items = body?.result?.value?.items;  // 需要手动解包
```

**IApiClient** 返回 zod 校验后的类型安全响应：
```typescript
// api.sessions.list() 返回 RpcResponse<ResponseValue<'session.list'>>
// = { rpcId, result: { ok: true, value: { items: SessionSummary[] } } }
const resp = await api.sessions.list({});
const items = resp.result.ok ? resp.result.value.items : [];  // 类型安全
```

**影响**：
- `rpc.ts` 返回 `{ result?: RpcResult }`（无 rpcId，无 zod 校验）
- `IApiClient` 返回 `RpcResponse<T>`（有 rpcId，有 zod 校验）
- 所有调用方需适配 `.result.value` 路径（而非 `.result?.value`）

### Webview SessionView 的 RPC

`SessionView.tsx`（webview 内）内联了简易 RPC 函数：
```typescript
const rpc = (method: string, payload: unknown) => {
  return fetch(base + '/api/' + method, { ... }).then(res => res.json());
};
```

**不能直接用 WebApiClient**（webview 环境无 Node.js 模块系统），但可以：
1. 保持内联 RPC（最简单，避免 bundling 问题）
2. 或用上游的 `createWebConnectionRpc()` — 它是浏览器安全的

### 能否完全替换 rpc.ts？

**部分可以**，但有阻碍：

| 方面 | 可替换 | 阻碍 |
|------|--------|------|
| postRpc 通用函数 | ✅ | 需要创建 baseUrl 子类 |
| listSessions | ✅ | 响应结构适配 |
| ensureWorkspace | ⚠️ | 链式调用（list → create）需两步 |
| SessionItem 接口 | ❌ | webview 独立 bundle，保持自有类型 |
| 超时控制 | ✅ | AbstractApiClient 有 30s 默认超时 |

**建议**：不完全替换 rpc.ts，而是：
1. 在扩展进程内用 `DshWebApiClient` 替代 `postRpc` 调用
2. 保留 rpc.ts 的 `SessionItem` 接口给 webview
3. webview session-view 保持内联 RPC（不引入上游 bundling 复杂度）

---

## D3: runtime.ts → ConnectionController

### 当前 HarnessRuntime 职责（263 行）

| 功能 | 实现 |
|------|------|
| 双 WS 连接循环 | openSockets() → Promise.all([mux, host]) |
| 指数退避重连 | backoffDelay()，500ms 起 ×2，上限 10s |
| generation 代隔离 | 每次 rebase/dispose 递增，旧代回调静默 |
| HTTP unary 请求 | request() → fetch POST |
| 帧分发 | onMuxFrame/onHostFrame 回调 |
| 状态多播 | subscribeStatus() + statusListeners Set |
| 动态 rebase | rebase(baseUrl) 切换目标实例 |
| 响应审批/问题 | respond(rpcId, value) |
| host.describe 握手 | loop 内首包校验 |

### ConnectionController 架构分析

```typescript
class ConnectionController {
  constructor(
    private readonly api: IApiClient,       // ← 注入，非 Cordis
    private readonly sinks: ConnectionSinks = {},
    config: ConnectionConfig = {},
  ) {}

  start(): void   // 启动连接循环
  stop(): void    // 停止并 abort 当前代
}
```

**无 Cordis 依赖。** 构造只需 `IApiClient` + `ConnectionSinks`。

### 精确构造签名（rc.7）

```typescript
new ConnectionController(
  api,          // IApiClient — WebApiClient 实例
  {             // ConnectionSinks
    onMuxEnvelope?: (envelope: RpcRequest<MuxFrame>) => void
    onHostEnvelope?: (envelope: RpcRequest<HostFrame>) => void
    onConnected?: (description: HostDescription) => void
    onStateChange?: (state: 'connected' | 'reconnecting') => void
  },
  {             // ConnectionConfig（可选）
    backoffBaseMs?: number    // 默认 500
    backoffFactor?: number    // 默认 2
    backoffMaxMs?: number     // 默认 10000
    streamOpenTimeoutMs?: number  // 默认 3000
  }
)
```

### 逐项对比

| 功能 | HarnessRuntime | ConnectionController | 差异 |
|------|---------------|---------------------|------|
| 构造 | `new HarnessRuntime({baseUrl})` | `new ConnectionController(api, sinks)` | RC 需要先创建 api |
| 启动 | `connect()` 返回 Promise<HostDescription> | `start()` void，通过 onConnected 回调 | ⚠️ API 不同 |
| 停止 | `dispose()` | `stop()` | ✅ 等价 |
| 状态订阅 | `subscribeStatus()` 返回 disposer | `onStateChange` 回调（单槽） | ⚠️ 多播需自建 |
| 帧回调 | `onMuxFrame`/`onHostFrame` 赋值 | `sinks.onMuxEnvelope`/`onHostEnvelope` | ✅ 等价 |
| rebase | `rebase(baseUrl)` 切换目标 | ❌ 无此方法 | ❌ 缺失 |
| respond | `respond(rpcId, value)` | 通过 `api.respond()` | ✅ 等价 |
| request | `request(method, payload)` | 通过 `api.sessions.list()` 等 | ✅ 等价（更强类型） |
| generation 代隔离 | ✅ 内置 | ✅ 内置（AbortController） | ✅ |
| 退避参数 | constructor options | ConnectionConfig | ✅ 等价 |
| lastError | ✅ 暴露 | ❌ 无 | ⚠️ 需自建 |
| currentState | ✅ getter | ❌ 无 | ⚠️ 需自建 |

### 问题 3：动态 target 切换（rebase）

**ConnectionController 不支持 rebase。** 构造时绑定 `api`，之后无法切换。

**HarnessRuntime.rebase()** 的用途：
```typescript
// extension.ts 中根据配置切换目标实例
runtime.rebase(newBaseUrl);
```

**解决方案**：创建新的 `ConnectionController` + `WebApiClient` 实例，stop 旧的，start 新的。

```typescript
// 替代 rebase
function rebaseTo(newBaseUrl: string): void {
  controller.stop();
  const newApi = new DshWebApiClient(newBaseUrl);
  controller = new ConnectionController(newApi, sinks, config);
  controller.start();
}
```

### 问题 4：多播状态订阅

**ConnectionController 只支持单槽 `onStateChange`**。HarnessRuntime 有 `statusListeners: Set`。

**解决方案**：在 sinks 外部包装多播：

```typescript
const stateListeners = new Set<(state: ConnectionState) => void>();
const controller = new ConnectionController(api, {
  onStateChange(state) {
    for (const listener of stateListeners) listener(state);
  },
  // ...
});
// 暴露多播接口
function subscribeState(listener: (state: ConnectionState) => void): () => void {
  stateListeners.add(listener);
  return () => { stateListeners.delete(listener); };
}
```

### 问题 6：HarnessRuntime 的 VS Code 特有逻辑

| 逻辑 | 位置 | 上游是否覆盖 | 迁移影响 |
|------|------|------------|----------|
| `lastError` 字段 | runtime.ts:78 | ❌ ConnectionController 无 | 需自建 wrapper |
| `currentState` getter | runtime.ts:80 | ❌ | 需自建 wrapper |
| `currentBaseUrl` getter | runtime.ts:85 | ❌ 且无 rebase | 需自建 wrapper |
| `description` 缓存 | runtime.ts:89 | ❌ | 需自建（onConnected 回调缓存） |
| `readyResolvers` Promise 缓存 | runtime.ts:57 | ❌ | 需自建（connect() 返回 Promise） |
| generation 代隔离 + started 标志 | runtime.ts:52-56 | ✅ 内置 | 直接用 |
| dispose 幂等 | runtime.ts:153 | ✅ stop() | 直接用 |

### 完整迁移方案

```typescript
// apps/vscode/src/agent/connection-wrapper.ts
import { ConnectionController, type ConnectionSinks, type ConnectionState } from '@deepseek-ai/dsh-client-connection'
import type { HostDescription, MuxFrame, HostFrame, IApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'

export interface RuntimeStatus {
  state: RuntimeState;
  attempt: number;
  error?: string;
}

export class ConnectionWrapper {
  private controller: ConnectionController | null = null;
  private api: IApiClient;
  private baseUrl: string;
  private stateListeners = new Set<(status: RuntimeStatus) => void>();
  private lastDescription?: HostDescription;
  private lastError?: string;
  private currentState: RuntimeState = 'idle';
  private readyResolvers: Array<(d: HostDescription) => void> = [];

  constructor(baseUrl: string, api: IApiClient) {
    this.baseUrl = baseUrl;
    this.api = api;
  }

  async connect(): Promise<HostDescription> {
    if (this.lastDescription) return this.lastDescription;
    return new Promise(resolve => this.readyResolvers.push(resolve));
  }

  rebase(baseUrl: string): void {
    this.controller?.stop();
    this.lastDescription = undefined;
    this.lastError = undefined;
    this.currentState = 'idle';
    this.readyResolvers = [];
    // 创建新 api + controller
    this.baseUrl = baseUrl;
    // 注意：需要创建新的 DshWebApiClient(baseUrl)
    this.startController();
  }

  private startController(): void {
    this.controller = new ConnectionController(this.api, {
      onMuxEnvelope: (envelope) => {
        this.onMuxFrame?.(envelope.payload, envelope.rpcId);
      },
      onHostEnvelope: (envelope) => {
        this.onHostFrame?.(envelope.payload, envelope.rpcId);
      },
      onConnected: (description) => {
        this.lastDescription = description;
        this.lastError = undefined;
        for (const r of this.readyResolvers.splice(0)) r(description);
      },
      onStateChange: (state) => {
        this.currentState = state === 'connected' ? 'connected' : 'reconnecting';
        const status: RuntimeStatus = {
          state: this.currentState,
          attempt: 0,
          error: state === 'reconnecting' ? this.lastError : undefined,
        };
        for (const listener of this.stateListeners) listener(status);
      },
    });
    this.controller.start();
  }

  subscribeStatus(listener: (status: RuntimeStatus) => void): () => void {
    this.stateListeners.add(listener);
    return () => { this.stateListeners.delete(listener); };
  }

  // ... respond, request 等方法委托给 api
}
```

### 能否完全替换 HarnessRuntime？

**可以**，但需要一个薄 wrapper 补齐：
1. `rebase()` — 重建 controller
2. `subscribeStatus()` — 多播适配
3. `lastError` / `currentState` / `description` — 缓存字段
4. `connect()` — Promise 缓存
5. `respond()` / `request()` — 委托给 api

**净减代码量**：263 行 → ~100 行 wrapper + 零自维护连接逻辑

---

## 综合评估

### D2 可行性：⚠️ 部分可行

**优势**：
- WebApiClient 零 Cordis 依赖，可独立构造
- 类型安全（zod 校验）
- 内置超时控制

**阻碍**：
- baseUrl 需要子类覆盖（创建 `DshWebApiClient`）
- 响应结构从 `{ result?: RpcResult }` 变为 `RpcResponse<T>`
- webview 侧（SessionView）不能直接用（bundling 限制）

**建议**：
1. 创建 `DshWebApiClient` 子类（~10 行）
2. 扩展进程内的 `postRpc` 调用替换为 `api.sessions.list()` 等
3. 保留 rpc.ts 的 `SessionItem` 接口给 webview
4. webview 保持内联 RPC（不引入上游 bundling）

### D3 可行性：✅ 可行（需 wrapper）

**优势**：
- ConnectionController 零 Cordis 依赖
- 连接循环、退避、generation 隔离均内置
- 构造只需 `IApiClient` + `ConnectionSinks`

**阻碍**：
- 无 `rebase()` — 需重建 controller
- 无 `subscribeStatus()` — 需自建多播
- 无 `lastError` / `currentState` — 需自建缓存
- `connect()` 返回 void 而非 Promise — 需自建 Promise 缓存

**建议**：
1. 创建 `ConnectionWrapper`（~100 行）补齐 HarnessRuntime 的公共 API
2. 内部委托 ConnectionController + WebApiClient
3. 删除 HarnessRuntime（263 行）+ wire.ts 中的 encode/parse 函数

### 依赖链

```
ConnectionWrapper (自建)
  └── ConnectionController (上游, 零 Cordis)
        └── DshWebApiClient (自建子类, ~10 行)
              └── AbstractApiClient (上游, 零 Cordis)
                    └── globalThis.fetch + location.origin
```

**总新增代码**：~110 行（DshWebApiClient 10 行 + ConnectionWrapper 100 行）
**总删除代码**：~263 行（HarnessRuntime）+ ~85 行（rpc.ts 的 postRpc 部分）
**净减**：~238 行

### 风险

| 风险 | 严重度 | 缓解 |
|------|--------|------|
| 上游 zod 校验失败（响应格式漂移） | 低 | 与上游同版本，格式一致 |
| rebase 重建 controller 导致帧丢失 | 中 | 重建前 stop，确保旧代完全终止 |
| webview session-view 不迁移 | 低 | 保持内联 RPC，避免 bundling 复杂度 |
| ConnectionController 的 `stream/error` 帧处理 | 低 | 上游已内置 break on stream/error |
