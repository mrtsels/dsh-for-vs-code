# 去重复计划：VS Code 扩展 → 直接依赖 vendor 源码

> **目标**：消除 `apps/vscode/src/` 中与 `vendor/deepseek-harness/` 上游源码重复的代码，改为直接 import 上游包，使 vendor rev 更新（git pull）时扩展自动获得最新类型/逻辑。
>
> **Vendor rev 更新记录**：2026-08-18 从 rc.5 (`47f94385`) 拉到 rc.7 (`99f6f02`)，经三路子代理验证：**方案完全有效**，唯一变化是 `settings-not-exposed` 错误码被删除（扩展不引用此码，零影响）。详细 diff 见 [dedup-diff.md](dedup-diff.md) / [dedup-plan-rc7-validity.md](dedup-plan-rc7-validity.md) / [dedup-file-diff.md](dedup-file-diff.md)。
>
> **约束**：不改 vendor 内任何源码（红线）；esbuild `bundle: true` + `external: ['vscode']` 可解析 vendor 包。

---

## 1. 扫描结论总览

扫描了 19 个上游 vendor 包和 36 个扩展源文件。扩展的 `src/agent/` 和 `src/rpc.ts` **零 vendor import**——所有类型和逻辑都是独立手写的。

### 重复度分级

| 级别 | 扩展文件 | 上游对应 | 重叠度 | 优先级 |
|------|---------|---------|--------|--------|
| **Tier 1** | `agent/wire.ts` (214行) | `host/apiproxy/src/api/` | **90%+** | P0 |
| **Tier 1** | `rpc.ts` (86行) | `client/connection/src/client/` | **80%+** | P0 |
| **Tier 2** | `agent/runtime.ts` (263行) | `client/connection/src/client/` | **60%** | P1 |
| **Tier 2** | `agent/session-manager.ts` (239行) | `session/session-projection/` | **40%** | P2 |
| **Tier 3** | `agent/controller.ts` (88行) | 无直接对应 | **0%** | 保留 |
| **Tier 3** | `agent/context.ts` (70行) | VS Code 特有 | **0%** | 保留 |
| **Tier 3** | `agent/git-parse.ts` (44行) | 无上游等价 | **0%** | 保留 |
| **Tier 3** | `agent/patch.ts` (98行) | 无上游等价 | **0%** | 保留 |
| **Tier 3** | `util/dispose.ts` | VS Code Disposable | **0%** | 保留 |
| **Tier 3** | `util/diff.ts` | 无上游等价 | **0%** | 保留 |
| **Tier 3** | `util/nonce.ts` | VS Code CSP | **0%** | 保留 |
| **Tier 3** | `vscode/*.ts` | VS Code API 封装 | **0%** | 保留 |
| **Tier 3** | `webview/*.ts` | webview bridge | **0%** | 保留 |

---

## 2. Tier 1：直接类型复用（P0，预期减少 ~300 行）

### 2.1 `wire.ts` → `@deepseek-ai/dsh-host-apiproxy/api`

**现状**：扩展手写了 214 行，定义了 `RpcId`、`ClientRequest`、`ServerResponse`、`ServerRequest`、`RpcError`、`RpcResult`、`MuxFrame`、`HostFrame`、`HostDescription`、`SessionEvent`、`SessionSummary` 等类型。全部是 `string`/`unknown` 宽类型。

**上游**：`vendor/deepseek-harness/packages/host/apiproxy/src/api/` 提供了：
- `rpc.ts`：`ClientRequest`、`ServerResponse`、`ServerRequest`、`ClientResponse`、`RpcId`（branded）、`RpcError`（30+ 错误码 union）、`RpcResult<T>`、`RpcMessage`、`transportError()`
- `events.ts`：`MuxFrame`（10+ 帧类型精确 union）、`HostFrame`（8 帧精确 union）、`ToolEventView`、`QueuedInboxItem`
- `sessions.ts`：`SessionSummary`（含 `blank`/`running`/`cwd`/`projections` 精确字段）
- `index.ts`：统一 re-export

**迁移方案**：
```typescript
// 替换整个 wire.ts 为：
export type {
  RpcId, ClientRequest, ServerResponse, ServerRequest,
  RpcError, RpcResult, RpcMessage, MuxFrame, HostFrame,
} from '@deepseek-ai/dsh-host-apiproxy/api'

// 如果需要 unbranded RpcId（string），加一个类型断言适配
export type RpcIdStr = string & { readonly __brand?: 'rpc-id' }
```

**风险**：
- 上游 `RpcId` 是 branded type (`Branded<'rpc-id'>`)，扩展用 plain `string`——需确认调用方是否做类型断言
- 上游 `MuxFrame`/`HostFrame` 是精确 discriminated union，扩展用 `Record<string, unknown>`——下游 switch/if 可能需要收窄
- 上游 `SessionEvent` 有 13+ 精确事件类型，扩展用 `EventData = { [key: string]: unknown }`——webview 侧消费可能需适配

**步骤**：
1. 在 `apps/vscode/package.json` 添加对 `@deepseek-ai/dsh-host-apiproxy` 的 workspace 引用（或用 tsconfig paths）
2. 用 `export type { ... } from '...'` 替换 wire.ts 全部手工类型
3. 适配 branded `RpcId`：在 runtime.ts/rpc.ts 的 `rpcId` 构造处加 brand 断言
4. 适配精确 `MuxFrame`/`HostFrame`：在 session-manager.ts 的帧分发处更新 switch 分支
5. 更新 `agent/wire.ts` 为纯 re-export barrel（或直接删文件，改 import 路径）
6. G0 四门验证

### 2.2 `rpc.ts` → `@deepseek-ai/dsh-client-connection` WebApiClient

**现状**：86 行，手写 `RpcEnvelope`、`RpcResult`、`postRpc()`、`listSessions()`、`ensureWorkspace()`。

**上游**：`client/connection/src/client/web-api-client.ts` 提供 `WebApiClient`（实现 `IApiClient` 接口），包含：
- `request(method, payload)` — 构造 RPC 信封 + HTTP POST
- `listSessions()`、`listWorkspaces()`、`getWorkspaceSessions()` — 完整 session/workspace RPC
- `host.describe()` — 握手

**迁移方案**：
```typescript
// 替换 rpc.ts 为薄封装：
import { WebApiClient } from '@deepseek-ai/dsh-client-connection/client'
// 或直接在 runtime.ts 中用 WebApiClient 替代手动 fetch
```

**风险**：
- `WebApiClient` 依赖 `ConnectionConfig`（含 `baseUrl`），需在 extension activate 时构造
- 上游 `IApiClient` 方法签名可能与扩展当前调用方式不完全一致——需逐一适配
- `listSessions()` 返回类型是 `SessionSummary[]`（上游精确类型），消费方需收窄

**步骤**：
1. 评估 `WebApiClient` 是否可独立使用（不依赖 Cordis runtime）
2. 如果可以：在 runtime.ts 中构造 `WebApiClient`，替换 `postRpc` 调用
3. 如果不行（需要 Cordis context）：保留 `postRpc` 但改用上游 `ClientRequest` 类型
4. 删 `rpc.ts` 或改为 re-export barrel

---

## 3. Tier 2：逻辑复用（P1-P2，预期减少 ~200 行）

### 3.1 `runtime.ts` → `ConnectionController`

**现状**：263 行，`HarnessRuntime` 实现了：
- 双 WS 连接（mux + host）
- 指数退避重连
- HostDescription 握手
- 帧分发（muxFrame/hostFrame 回调）

**上游**：`client/connection/src/client/connection.ts` 提供 `ConnectionController`：
- `ConnectionState`：idle → connecting → connected → reconnecting → disconnected
- `ConnectionSinks`：mux/host 帧回调
- `start(sinks)` — 启动重连循环
- `HostDescriptionSource`：可观察的 host 描述

**迁移方案**：
```typescript
// runtime.ts 简化为薄桥：
import { ConnectionController, type ConnectionSinks } from '@deepseek-ai/dsh-client-connection/client'

export class HarnessRuntime {
  private controller: ConnectionController

  constructor(baseUrl: string, sinks: ConnectionSinks) {
    this.controller = new ConnectionController({ baseUrl }, sinks)
  }

  start() { this.controller.start() }
  dispose() { this.controller.dispose() }
}
```

**风险**：
- 上游 `ConnectionController` 可能依赖 Cordis `Context`（需验证能否独立构造）
- 扩展的 `HarnessRuntime` 有 VS Code 特有逻辑（状态栏更新、logger 集成）——需保留为 wrapper
- 双 WS 路径（mux + host）的 URL 映射需与上游一致

**评估**：如果 `ConnectionController` 需要 Cordis context，则迁移收益有限——保留当前实现，只复用类型。

### 3.2 `session-manager.ts` → session-projection

**现状**：239 行，实现：
- 事件缓冲（append-only，按 seq 排序）
- 会话状态快照（`SessionState`：id/title/status/projections）
- mux 帧分发（session/event → 缓冲，session/projection → 更新）

**上游**：`session/session-projection/` 提供 `SessionProjectionService`（投影计算+缓存），`core/session/` 提供 `Session`（append-only 事件源）。

**评估**：扩展的 session-manager 是 **客户端侧的轻量投影**（只消费 WS 推送帧），上游的 session 是 **服务端侧的完整事件源**（含 append/deriveMessages）。两者职责不同，直接替换不可行。

**迁移方案**：保留 session-manager，但改用上游 `SessionEvent` 精确类型（来自 Tier 1），减少 `as unknown as` 断言。

---

## 4. Tier 3：保留不动

| 文件 | 行数 | 原因 |
|------|------|------|
| `controller.ts` | 88 | VS Code 状态机（idle/running/error/disconnected），无上游对应 |
| `context.ts` | 70 | VS Code 编辑器上下文格式化（选区/诊断/git 改动），纯 VS Code 特有 |
| `git-parse.ts` | 44 | `git status --porcelain` / `diff --numstat` 解析器，上游无等价物 |
| `patch.ts` | 98 | unified diff 解析/应用，上游无等价物 |
| `util/dispose.ts` | ~30 | VS Code `Disposable` 适配器，上游用 Cordis `ctx.effect()` |
| `util/diff.ts` | ~20 | 简单行 diff，装饰用 |
| `util/nonce.ts` | 6 | CSP nonce 生成 |
| `util/logger.ts` | ~40 | VS Code OutputChannel 日志 |
| `vscode/*.ts` | 各文件 | 全部是 VS Code API 封装（proxy/workspace/terminal/git/editor/diagnostics） |
| `webview/*.ts` | 各文件 | webview bridge/panel，扩展特有 |
| `commands/*.ts` | 各文件 | VS Code 命令注册 |
| `settings-bridge.ts` | ~200 | VS Code 设置 ↔ dsh 设置双向同步 |
| `sessions/bootstrap.ts` | ~60 | 会话启动（ensureFolderSession） |

---

## 5. 构建系统适配

### 5.1 import 路径方案

vendor 是嵌套 workspace（自带 `pnpm-workspace.yaml`），不能直接作为外层 pnpm dependency。**vendor rev 当前 `99f6f02` (rc.7)**。方案：

**方案 A：tsconfig paths + esbuild alias（推荐）**
```json
// apps/vscode/tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "@deepseek-ai/dsh-host-apiproxy/api": [
        "../../vendor/deepseek-harness/packages/host/apiproxy/src/api/index.ts"
      ],
      "@deepseek-ai/dsh-client-connection/client": [
        "../../vendor/deepseek-harness/packages/client/connection/src/client/index.ts"
      ],
      "@deepseek-ai/dsh-session/types": [
        "../../vendor/deepseek-harness/packages/core/session/src/types.ts"
      ]
    }
  }
}
```
```javascript
// apps/vscode/scripts/build.mjs — extension build
const extension = {
  // ...existing config...
  alias: {
    '@deepseek-ai/dsh-host-apiproxy/api': resolve(app, '../../vendor/deepseek-harness/packages/host/apiproxy/src/api/index.ts'),
    '@deepseek-ai/dsh-client-connection/client': resolve(app, '../../vendor/deepseek-harness/packages/client/connection/src/client/index.ts'),
    '@deepseek-ai/dsh-session/types': resolve(app, '../../vendor/deepseek-harness/packages/core/session/src/types.ts'),
  },
};
```

**方案 B：直接相对路径 import**
```typescript
// 在 wire.ts 中：
export type { ClientRequest, ServerResponse } from '../../../vendor/deepseek-harness/packages/host/apiproxy/src/api/rpc.ts'
```
简单但脆弱——vendor 内部结构变化会断 import。

**推荐方案 A**：tsconfig paths + esbuild alias，路径集中管理，vendor rev 升级时只改一处。

### 5.2 类型依赖链

上游包有内部依赖（`@deepseek-ai/dsh-brand`、`@deepseek-ai/dsh-llm` 等）。如果只 import 纯类型（`export type`），esbuild 会 tree-shake，不引入运行时依赖。如果 import 运行时代码（如 `WebApiClient`），需确保依赖链完整。

**关键**：Tier 1 只用 `export type`，零运行时依赖，最安全。

---

## 6. 迁移策略（2026-08-18 ChatGPT 方案 + 实测修正）

**总策略**：D（按 protocol/application boundary 分层）→ C（最终收敛到上游 exact type）。

核心原则：**按类型属于 protocol 还是 extension domain 决定保留/迁移，而非按难度。**

```
                 Upstream wire types
                       |
                       v
              +-----------------+
              | Transport layer |  wire.ts: re-export upstream exact types
              | runtime/proxy   |
              +--------+--------+
                       | exact
                       v
              +-----------------+
              | Adapter /       |  wire-adapters.ts: createRpcId(), TypedClientRequest<P>, IncomingFrame
              | normalization   |
              +--------+--------+
                       | app-friendly
                       v
              +-----------------+
              | Extension logic |  保留宽松类型的地方（仅 UI/webview DTO）
              | UI/session/etc. |
              +-----------------+
```

### Phase M1：基础设施 + 无冲突 re-export（2026-08-18 已完成）
- [x] tsconfig.json paths（4 vendor 包）
- [x] esbuild alias（4 vendor 包）
- [x] wire.ts 16 类型映射表（记录上游对应关系）
- [x] typecheck 通过
- [x] ARCH.md / AGENTS.md / versions.md 同步

### Phase M2：无冲突类型 re-export + createRpcId factory（2026-08-18 已完成 ✅）
- [x] M2-1：wire.ts re-export SkillEntry（上游 @deepseek-ai/dsh-host-apiproxy/api）
- [x] M2-2：wire-adapters.ts 创建 createRpcId(): RpcId factory
- [x] M2-3：wire.ts encodeClientRequest 默认 rpcId 改用 createRpcId()
- [x] M2-5：G0 typecheck 通过（仅既有 ContextAttachmentManager 参数错误）

> M2 实测：原计划 re-export RpcResult/JobView/SkillEntry，实测仅 SkillEntry 无冲突：
> - RpcResult ❌ — 引用上游 RpcError（discriminated union ~40 codes），与本地 {code:string} 不兼容
> - JobView ❌ — id 字段使用 branded JobId，与本地 string 不兼容
> - SkillEntry ✅ — readonly 修饰符兼容，无 branded 类型，字段形状一致
>
> tsconfig 新增 allowImportingTsExtensions（上游 .ts 扩展名导入需要）。

### Phase M3：MuxFrame / HostFrame 类型收紧（ChatGPT 方案确认）
- [ ] M3-1：wire.ts re-export 上游 MuxFrame + HostFrame（不再本地定义宽松 union）
- [ ] M3-2：controller.ts 新增 handleHostFrame(HostFrame) 方法
- [ ] M3-3：controller.ts handleMuxFrame 中 `frame.event.type === 'host/agent-error'` 移到 handleHostFrame
- [ ] M3-4：extension.ts onHostFrame 回调增加 controller.handleHostFrame(frame) 调用
- [ ] M3-5：适配 branded SessionId 消费点（frame.sessionId === string 比较）
- [ ] M3-6：runtime.ts onMuxFrame/onHostFrame 参数类型改为 upstream exact type
- [ ] M3-7：G0 typecheck 验证

> M3 决策（ChatGPT 确认）：
> - host/agent-error 是 HostFrame 变体，不是 SessionEvent type → 移到 handleHostFrame（选 B）
> - stream/error 同时在两个 union 中 → 合法，TypeScript 会分别检查，无需 as 断言
> - IncomingFrame 类型 M3 暂不引入（避免重新混 union，与架构拆分方向相反）
> - SessionId branded 优先在应用层保持 branded，仅 UI/storage 边界转 string
> - 这次 migration 的核心价值是暴露原来被宽松类型隐藏的逻辑错误（host/agent-error 就是一例）

### Phase M4：SessionEvent exact union 迁移
- [ ] M4-1：wire.ts re-export upstream SessionEvent、SessionEventMap、TurnEndReason
- [ ] M4-2：session-manager.ts 事件消费改用 narrowing（switch (event.type) 后 event.data.turn 等自动推导）
- [ ] M4-3：bridge.ts 中 SessionEvent import 更新
- [ ] M4-4：chat-stream.ts 中 SessionEvent import 更新
- [ ] M4-5：删除旧 EventData loose type
- [ ] M4-6：G0 typecheck 验证

> M4 策略：这是改动最大的一步。上游 SessionEvent<'turn/end'> 的 data.reason
> 是 TurnEndReason（discriminated union），不再是 string。消费方通过
> switch (event.type) 自动 narrowing，无需手动断言。

### Phase M5：Generic compatibility layer
- [ ] M5-1：wire-adapters.ts 定义 TypedClientRequest<P> 和 TypedServerResponse<T>
  （Omit<Upstream, 'payload'> & { payload: P } 等）
- [ ] M5-2：wire.ts re-export upstream ClientRequest、ServerResponse（non-generic）
- [ ] M5-3：runtime.ts 中需要泛型的地方改用 TypedClientRequest<P>
- [ ] M5-4：rpc.ts 中 postRpc 返回类型适配
- [ ] M5-5：删除旧 generic ClientRequest<P> / ServerResponse<T> local 定义
- [ ] M5-6：G0 typecheck 验证

> M5 策略：泛型兼容层命名为 TypedXxx（不叫 ClientRequest），语义清晰：
> ClientRequest = upstream wire protocol；TypedClientRequest<P> = extension typed helper。

### Phase M6：D2 rpc.ts -> WebApiClient + D3 runtime.ts -> ConnectionController
- [ ] M6-1：创建 DshWebApiClient 子类（覆盖 resolveBase()，~10 行）
- [ ] M6-2：扩展进程内 postRpc 调用 -> api.sessions.list() 等 typed 方法
- [ ] M6-3：创建 ConnectionWrapper（~100 行 wrapper 补齐 rebase/subscribeStatus/lastError）
- [ ] M6-4：HarnessRuntime -> ConnectionWrapper 替换
- [ ] M6-5：G0 四门验证 + smoke-shell 冒烟

> D2/D3 可行性详情见 dedup-d2-d3-feasibility.md

### 迁移工具约定
- @ts-expect-error 标签格式：// @ts-expect-error UPSTREAM-MIGRATION(类型名): 原因
- 优先级：narrowing > factory > satisfies > type assertion > @ts-expect-error
- 禁止：@ts-ignore、降级 branded type 到 string、在 wire.ts 重新复制 upstream 类型
- 债务追踪：rg "UPSTREAM-MIGRATION" src/ 可列出全部迁移债务

---

## 7. 实际收益（2026-08-18 实测）

| 指标 | 改动前 | 改动后 | 变化 |
|------|--------|--------|------|
| tsconfig paths | 无 | 4 个 vendor 包解析 | **+4 路径** |
| esbuild alias | 无 | 4 个 vendor 包别名 | **+4 别名** |
| wire.ts 上游映射 | 无 | 16 类型映射表（文档） | **+映射** |
| wire.ts 行数 | 214 | 260（+映射表注释） | +46（注释） |
| typecheck | ✅ | ✅ | 无回归 |
| vendor rev | rc.5 (47f94385) | rc.7 (99f6f02) | **+111 commits** |
| D2/D3 可行性 | 未知 | 已验证（均无 Cordis 依赖） | **+确定性** |

> **注意**：Phase D1 原计划 re-export 上游类型（预期 -194 行），实测发现上游类型更精确
> 导致消费者不兼容，改为"映射表 + 保留本地类型"策略。实际减代码量为零，但建立了
> 类型安全基础设施（tsconfig paths + esbuild alias）和完整的上游映射文档，为后续
> D2/D3 迁移铺路。

---

## 8. 风险登记

| # | 风险 | 影响 | 缓解 |
|---|------|------|------|
| D-R1 | branded `RpcId` 与 plain `string` 不兼容 | 编译错误 | 类型断言适配层 |
| D-R2 | 精确 `MuxFrame` union 导致 switch 不完整 | 编译警告 | 补 default 分支 + `assertNever` |
| D-R3 | 上游包内部依赖链过深 | esbuild bundle 膨胀 | 只用 `export type`（Tier 1 零运行时依赖） |
| D-R4 | vendor rev 升级后上游类型变了 | 编译错误 | 断言式 import + G0 门把关 |
| D-R5 | esbuild alias 不解析 .ts 源码 | 构建失败 | 验证 alias 路径存在 + 构建测试 |
| D-R6 | `WebApiClient` 依赖 Cordis context | D2/D3 迁移不可行 | 降级为类型复用（保留手工逻辑） |

---

## 9. 与现有架构的关系

- **红线不变**：不改 vendor、不 fork、不内嵌 runtime
- **Route A 不变**：UI 仍从 vendor 源码构建装配（build-web-shell.mjs）
- **薄桥原则强化**：runtime.ts 只做传输 → 更好地对齐上游 ConnectionController
- **model-visible ⟺ logged**：事件模型在上游，扩展不自维护 messages[] → 类型从上游来更安全

---

## 10. 附录：上游包导出速查

见 [vendor-export-catalog.md](vendor-export-catalog.md)（19 包完整导出目录）。
