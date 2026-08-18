# Vendor Package Export Catalog

> Scanned from `vendor/deepseek-harness/packages/` (rev rc.7 = `99f6f02`)
> **Last verified**: 2026-08-18 against rc.7
> Extension source: `apps/vscode/src/`

---

## 1. `host/apiproxy` — Wire Protocol Types

**Package**: `@deepseek-ai/dsh-host-apiproxy`
**Entry**: `src/api/index.ts` → re-exports `rpc.ts`, `events.ts`, `sessions.ts`

### Key exports (from `src/api/rpc.ts`)

| Export | Kind | Description |
|--------|------|-------------|
| `RpcId` | branded type + factory | `Branded<'rpc-id'>` — message correlation id |
| `RpcError` | discriminated union | `{ code, message, details }` over `RpcErrorDetailsMap` keys |
| `RpcErrorCode` | type alias | `keyof RpcErrorDetailsMap` — closed error-code union |
| `RpcErrorDetailsMap` | interface | 30+ error codes with typed `details` payloads |
| `RpcResult<T>` | type | `{ ok: true; value: T } \| { ok: false; error: RpcError }` |
| `RpcRequest<P>` | interface | `{ rpcId, payload }` — signature-layer request |
| `RpcResponse<T>` | interface | `{ rpcId, result }` — signature-layer response |
| `ClientRequest` | interface | `{ type: 'client-request', rpcId, method, payload }` — wire full form |
| `ServerResponse` | interface | `{ type: 'server-response', rpcId, result }` — wire full form |
| `ServerRequest` | interface | `{ type: 'server-request', rpcId, method, payload }` — wire full form |
| `ClientResponse` | interface | `{ type: 'client-response', rpcId, result }` — wire full form |
| `RpcMessage` | type | Union of all 4 wire forms |
| `RpcReceipt` | type | Carrier receipt (`accepted: true/false`) |
| `transportError()` | function | Fold exception → `RpcResult` error branch |

### Key exports (from `src/api/events.ts`)

| Export | Kind | Description |
|--------|------|-------------|
| `MuxFrame` | discriminated union | `session/event`, `session/subscribed`, `approval/requested`, `approval/resolved`, `question/requested`, `question/resolved`, `session/queue`, `session/jobs`, `session/projection`, `stream/error` |
| `HostFrame` | discriminated union | `host/session-added`, `host/session-removed`, `host/session-status`, `host/archived-sessions-changed`, `host/agent-error`, `host/workspace-changed`, `host/workspace-removed`, `stream/error` |
| `ToolEventView` | type | `{ for: 'call'; view: ToolCallView } \| { for: 'result'; view: ToolResultView }` |
| `QueuedInboxItem` | interface | Pending inbox item with `id`, `placement`, `message` |
| `EventsApi` | interface | `mux()` + `host()` stream openers |

### Key exports (from `src/api/sessions.ts`)

| Export | Kind | Description |
|--------|------|-------------|
| `SessionSummary` | interface | Session list projection with `blank`, `running`, `cwd`, `projections` |
| `SessionSearchItem` | interface | Search result item |

### Key exports (from `src/api/index.ts`)

Re-exports `ToolCallView`, `ToolResultView` from `@deepseek-ai/dsh-tools/presentation`.

### ⚡ Extension duplication

| Extension file | Duplicated upstream type | Notes |
|----------------|--------------------------|-------|
| `agent/wire.ts` | `ClientRequest`, `ServerResponse`, `ServerRequest`, `RpcId`, `RpcError`, `RpcResult`, `SessionEvent`, `MuxFrame`, `HostFrame`, `HostDescription`, `SessionSummary` | **Major overlap** — extension redefines all core wire types with loose typing (e.g. `RpcId = string` vs branded `Branded<'rpc-id'>`; `SessionEvent.data` is `{ [key: string]: unknown }` vs typed `SessionEventMap` union) |
| `rpc.ts` | `RpcResult`, `RpcEnvelope` (=`ClientRequest`), `postRpc()` | Duplicates the RPC envelope construction and HTTP POST |
| `agent/session-manager.ts` | `SessionState`, event buffering | Partially duplicates session projection/event buffering from upstream `session-projection` + `session-persistence` |

---

## 2. `client/connection` — Browser Wire Client

**Package**: `@deepseek-ai/dsh-client-connection`
**Entry**: `src/index.ts` (host-side plugin) + `src/client/index.ts` (browser-side)

### Key exports (from `src/client/index.ts`)

| Export | Kind | Description |
|--------|------|-------------|
| `ConnectionHandle` | interface | `{ client, start(sinks) }` — wire root |
| `ConnectionConfig` | type | Connection configuration |
| `ConnectionSinks` | type | Callbacks for mux/host frames |
| `ConnectionState` | type | Connection lifecycle state |
| `HostDescriptionSource` | interface | Observable host description with `getSnapshot()` + `subscribe()` |
| `IApiClient` | interface | Full API surface: sessions, host, events, workspace, skills, models, settings, credentials, llm, subagents, goals |
| `AbstractApiClient` | class | Base API client with `fetch()` helper |
| `WebApiClient` | class | HTTP implementation of `IApiClient` |
| `ConnectionController` | class | Reconnection loop with exponential backoff |
| `createWebConnectionRpc()` | function | Creates RPC layer for connection |
| Re-exports | | All of `MuxFrame`, `HostFrame`, `SessionSummary`, `RpcId`, `ClientRequest`, `ServerResponse`, `ServerRequest`, `ClientResponse`, `RpcMessage`, `RpcReceipt`, `HostDescription`, `SessionId`, `SessionEvent`, `ContentBlock`, `StreamChunk`, `JobView`, etc. |

### Key exports (from `src/index.ts` — host-side)

| Export | Kind | Description |
|--------|------|-------------|
| `HostConnectionService` | class | Host-side connection service (extends `Service`) |
| `API_PATH` | const | `'/api'` |
| `HOST_EVENTS_PATH` | const | `'/api/events.host'` |
| `MUX_EVENTS_PATH` | const | `'/api/events.mux'` |

### ⚡ Extension duplication

| Extension file | Duplicated upstream | Notes |
|----------------|---------------------|-------|
| `agent/runtime.ts` | `ConnectionController`, `ConnectionState`, `HostDescriptionSource` | Extension's `HarnessRuntime` reimplements the reconnection loop with backoff, dual-WS management, and `HostDescription` — all of which upstream `ConnectionController` already provides |
| `agent/wire.ts` | `HostDescription` | Upstream already defines this type |

---

## 3. `core/session` — Session Types & Store

**Package**: `@deepseek-ai/dsh-session`
**Entry**: `src/index.ts`

### Key exports

| Export | Kind | Description |
|--------|------|-------------|
| `SessionId` | branded type + factory | `Branded<'SessionId'>` |
| `SESSION_FORMAT_VERSION` | const | `0` |
| `SessionHeader` | interface | `{ version, id, createdAt, cwd?, parentSession?, seedLength?, origin?, delegationDepth?, agentPreset? }` |
| `SessionEvent<T>` | discriminated union | Over `SessionEventMap` keys — `turn/start`, `turn/end`, `step/start`, `step/end`, `user/message`, `assistant/chunk`, `assistant/message`, `tool/call`, `tool/result`, `todo/write`, `request/header`, `request/context`, `session/end-seed` |
| `SessionEventMap` | interface | Merge-extensible event type map |
| `SessionEventType` | type | `keyof SessionEventMap` |
| `SurfaceEventType` | type | `'user/message' \| 'assistant/message' \| 'tool/result'` |
| `SurfaceOp` | type | `'append' \| { op: 'replace', start, end }` |
| `SurfaceEvent` | type | `SessionEvent<SurfaceEventType> & { surfaceOp: SurfaceOp }` |
| `TurnEndReason` | type | Union: `completed`, `aborted`, `blocked`, `error`, `max-tokens`, `interrupted` |
| `TodoItem` | interface | `{ content, status }` |
| `EpochHeader` | interface | `{ config, adapterDefaults?, system?, tools? }` |
| `RequestContext` | interface | `{ provider, model, contextWindow? }` |
| `Session` | class | Append-only event-sourced session with `append()`, `deriveMessages()`, `firstLiveSeq`, `lastSeq` |
| `SessionStore` | class | `ctx.sessions` — create, get, dispose sessions |
| `SessionPreparation` | class | Session preparation for agent loop |
| `adoptSessionEvent()` | function | Validate + freeze owned event |
| `snapshotSessionEvent()` | function | Detach + validate + freeze event |
| `deriveEventMessage()` | function | Surface event → LLM message |
| `foldSurface()` | function | Apply surface ops to get ordered surface |
| `isSurfaceEvent()` | type guard | Narrow to `SurfaceEvent` |
| `KNOWN_SESSION_EVENT_TYPES` | const | Set of all known event type strings |
| `JsonValue` | type | Lossless JSON payload type |
| `ChunkRow`, `StorageRecord` | types | Chunk persistence types |

### ⚡ Extension duplication

| Extension file | Duplicated upstream | Notes |
|----------------|---------------------|-------|
| `agent/wire.ts` `SessionEvent` | `SessionEvent` from `core/session` | Extension defines a loose `SessionEvent { type, seq, time, data: EventData }` where `EventData` is `{ [key: string]: unknown }`. Upstream has a precise discriminated union over 13+ event types with typed `data` per variant |
| `agent/wire.ts` `EventData` | `SessionEventMap` | Extension's catch-all `EventData` duplicates what upstream's `SessionEventMap` does with proper typing |

---

## 4. `core/agent` — Agent Types

**Package**: `@deepseek-ai/dsh-agent`
**Entry**: `src/index.ts`

### Key exports

| Export | Kind | Description |
|--------|------|-------------|
| `Agent` | class | Core agent with session, followup(), cancel() |
| `AgentHandle` | interface | `{ agent, dispose() }` — owned agent reference |
| `AgentOptions` | interface | Agent creation options |
| `AgentStatus` | type | `'idle' \| 'running'` |
| `AgentDispatch` | class | Agent dispatch mechanism |

---

## 5. `core/scope` — DI/Scope System

**Package**: `@deepseek-ai/dsh-scope`
**Entry**: `src/index.ts`

### Key exports

| Export | Kind | Description |
|--------|------|-------------|
| `Scoped<T>` | type | Scoped carrier for scope-filtered dispatch |
| `scopeOf()` | function | Get scope from carrier |
| `scopeTarget()` | function | Get scope target |
| `carrierKeyOf()` | function | Extract key from scoped carrier |
| `NamedEntries<V>` | class | Scoped named entry registry |
| `ScopeLayer` | interface | Scope layer definition |

---

## 6. `core/tools` — Tool Registry

**Package**: `@deepseek-ai/dsh-tools`
**Entry**: `src/index.ts`

### Key exports

| Export | Kind | Description |
|--------|------|-------------|
| `ToolRuntime` | class | `ctx.tools` — tool registry service |
| `ToolDefinition` | interface | `{ name, description, parameters, output, execute, presentCall?, presentResult? }` |
| `ToolExecution` | interface | Pending call identity with `callId`, `name`, `arguments`, `agent`, `signal` |
| `ToolRunContext` | interface | Runtime context with `deferContext()`, `concludeTurn()` |
| `ToolExecutionResult` | type | Settled result |
| `defineTool()` | function | Define a tool with typed schema |
| `ToolNotFoundError` | class | Unknown tool error |
| Presentation types | | `ToolCallView`, `ToolResultView`, `GenericCallView`, `TerminalCallView`, `DiffCallView`, `FileDiff`, `FileLocation`, etc. |

---

## 7. `core/agent-loop` — Agent Loop

**Package**: `@deepseek-ai/dsh-agent-loop`
**Entry**: `src/index.ts`

### Key exports

| Export | Kind | Description |
|--------|------|-------------|
| `AgentLoop` | class | The main agent loop |

---

## 8. `session/session-projection` — Session Projections

**Package**: `@deepseek-ai/dsh-session-projection`
**Entry**: `src/index.ts`

### Key exports

| Export | Kind | Description |
|--------|------|-------------|
| `SessionProjectionMap` | interface | Merge-extensible projection type table |
| `ProjectionDefinition<K, S>` | interface | Projection definition with key, schema, compute |
| `SessionProjectionService` | class | `ctx.sessionProjection` — compute and cache projections |

### ⚡ Extension duplication

Extension's `SessionState.projections` in `session-manager.ts` partially duplicates what this service provides.

---

## 9. `session/session-persistence` — Session Persistence

**Package**: `@deepseek-ai/dsh-session-persistence`
**Entry**: `src/index.ts`

### Key exports

| Export | Kind | Description |
|--------|------|-------------|
| `SessionPersistence` | interface | `list()`, `load()`, `save()`, `delete()` |
| `WriteBehindBuffer` | class | Buffered write-behind persistence |
| `RevisionTracker` | class | Track persistence revisions |

---

## 10. `terminal/terminal` — Terminal Service

**Package**: `@deepseek-ai/dsh-terminal`
**Entry**: `src/index.ts`

### Key exports

| Export | Kind | Description |
|--------|------|-------------|
| `TerminalSessionService` | class | `ctx.terminal` — spawn, send, read, close PTY sessions |
| `TerminalSessionId` | branded type + factory | `Branded<'TerminalSessionId'>` |
| `TerminalSessionStatus` | type | `'starting' \| 'running' \| 'exited' \| 'failed'` |
| `TerminalSpawnRequest` | interface | `{ type, name?, cwd?, env?, cols?, rows? }` |
| `TerminalSendRequest` | interface | `{ data, binary? }` |
| `TerminalReadRequest` | interface | `{ maxLength?, timeout? }` |
| `TerminalSessionSnapshot` | interface | Session state snapshot |
| `TerminalBackend` | interface | Backend abstraction: `{ type, spawn() }` |
| `TerminalBackendSession` | interface | Backend session: `{ send(), read(), resize(), signal(), close(), status }` |
| `TerminalError` | class | Error with code |
| `TerminalBackendCleanupError` | class | Cleanup failure aggregate |

### ⚡ Extension duplication

Extension's `vscode/terminal.ts` wraps VS Code Terminal API — different surface (no PTY, uses VS Code's terminal). Not a direct type overlap, but the extension could potentially use `TerminalSpawnRequest`/`TerminalSessionSnapshot` types for its own terminal management.

---

## 11. `workspace/workspace` — Workspace Registry

**Package**: `@deepseek-ai/dsh-workspace`
**Entry**: `src/index.ts`

### Key exports

| Export | Kind | Description |
|--------|------|-------------|
| `WorkspaceRegistry` | class | `ctx.workspaces` — create, attach, detach, order workspaces |
| `WorkspaceId` | branded type + factory | `Branded<'WorkspaceId'>` |
| `Workspace` | interface | `{ id, name, path, createdAt }` |
| `WorkspaceRecord` | interface | Storage record |
| `WorkspaceDomainState` | interface | Domain state with `workspaceIds`, `pendingMutation` |
| `workspaceDomainSpec` | const | Storage domain specification |
| `realpathNormalize()` | function | Normalize file paths |
| `WorkspaceMoveInvalidError` | class | Invalid move error |
| `WorkspaceUnknownSessionError` | class | Unknown session error |

---

## 12. `subagent/subagent` — Subagent Management

**Package**: `@deepseek-ai/dsh-subagent`
**Entry**: `src/index.ts`

### Key exports

| Export | Kind | Description |
|--------|------|-------------|
| `SubagentRunId` | branded type + factory | `Branded<'SubagentRunId'>` |
| `SubagentRunInfo` | interface | `{ id, provider, local, stopReason, lastAssistantMessage? }` |
| `SubagentRunEndInfo` | interface | End-of-run info |
| `SubagentStopReason` | type | Stop reason union |
| `SubagentDescriptorData` | interface | Descriptor for subagent |
| `AssistantOutputFold` | class | Fold assistant output |
| `finalAssistantOutput()` | function | Extract final assistant output |

---

## 13. `sdk/protocol` — SDK Wire Protocol

**Package**: `@deepseek-ai/dsh-sdk-protocol`
**Entry**: `src/index.ts`

### Key exports

| Export | Kind | Description |
|--------|------|-------------|
| `JsonRpcLineTransport` | class | Newline-delimited JSON-RPC stdio transport |
| `JsonRpcResponseError` | class | JSON-RPC error |
| `JsonRpcTransportPeer` | interface | Transport peer abstraction |
| `InitializeParams` | interface | `{ cwd, provider, model, maxTokens? }` |
| `InitializeResult` | interface | `{ serverInfo: { name, version } }` |
| `SessionPromptParams` | interface | `{ sessionId, contentBlocks }` |
| `SessionPromptResult` | interface | `{ messageId }` |
| `SessionEventNotification` | interface | `{ sessionId, event }` |
| `SessionStatusNotification` | interface | `{ sessionId, status }` |
| `SubagentStartedNotification` | interface | `{ parentSessionId, childSessionId }` |
| `SubagentFinishedNotification` | interface | Full subagent result |
| `HarnessSdkRequestMap` | interface | Client→server request methods |
| `HarnessSdkNotificationMap` | interface | Server→client notification methods |

---

## 14. `sdk/client` — SDK Client

**Package**: `@deepseek-ai/dsh-sdk-client`
**Entry**: `src/index.ts`

### Key exports

| Export | Kind | Description |
|--------|------|-------------|
| `DeepSeekHarness` | class | High-level SDK: owns runtime subprocess, `start()`, `session()`, `run()`, `close()`, `AsyncDisposable` |
| `HarnessSession` | class | One SDK session: `run(input, options?)` → `RunResult` |
| `HarnessClient` | class | Low-level JSON-RPC client: `start()`, `initialize()`, `prompt()`, `subscribe()`, `close()` |
| `RunResult` | interface | `{ sessionId, finalResponse, events, notifications }` |
| `RunOptions` | interface | `{ sessionId?, onNotification? }` |
| `HarnessClientOptions` | interface | Launch spec: `command`, `args?`, `cwd?`, `env?`, timeouts |
| `DeepSeekHarnessOptions` | interface | `{ launch, cwd?, provider?, model?, maxTokens? }` |
| `HarnessNotification` | interface | `{ method, params }` |
| `NotificationFilter` | type | Predicate for notification subscriptions |
| `NotificationSubscription` | interface | `AsyncIterable<HarnessNotification>` with `next()`, `tryNext()`, `close()` |
| `TransportClosedError` | class | Runtime gone |
| `RequestTimeoutError` | class | Request timed out |
| `SdkProtocolError` | class | Protocol violation |
| `disposeRuntimeProcess()` | function | EOF → SIGTERM → SIGKILL teardown ladder |
| `isRecord()` | function | JSON object type guard |
| `normalizeInput()` | function | String → content blocks |
| `finalResponse()` | function | Extract last assistant text from events |

---

## 15. `sdk/server` — SDK Server

**Package**: `@deepseek-ai/dsh-sdk-jsonrpc-server`
**Entry**: `src/index.ts`

### Key exports

| Export | Kind | Description |
|--------|------|-------------|
| `HarnessSdkJsonRpcServer` | class | Server over booted context + transport peer |
| `JsonRpcConfig` | interface | `{ maxTokensAsSuccess?, input?, output?, exit? }` |
| `apply()` | function | Cordis plugin: serve SDK requests over stdio |

---

## 16. `util/brand` — Brand Types

**Package**: `@deepseek-ai/dsh-brand`
**Entry**: `src/index.ts`

### Key exports

| Export | Kind | Description |
|--------|------|-------------|
| `Branded<B>` | type | `string & { readonly [BRAND]: B }` — zero-cost branded string |

---

## 17. `settings/settings` — Settings

**Package**: `@deepseek-ai/dsh-settings`
**Entry**: `src/index.ts`

### Key exports

| Export | Kind | Description |
|--------|------|-------------|
| `SettingsNamespace` | branded type | `Branded<'SettingsNamespace'>` |
| `SettingsUpdateSource` | type | `'update' \| 'provider'` |
| `settingsNamespace()` | factory | Brand a string |
| `SettingsRegisterOptions<T>` | interface | Registration options |
| `SettingsDescriptor` | interface | Descriptor |

---

## 18. `storage/storage` — Storage

**Package**: `@deepseek-ai/dsh-storage`
**Entry**: `src/index.ts`

### Key exports

| Export | Kind | Description |
|--------|------|-------------|
| `StorageBackend` | interface | Backend abstraction |
| `StorageRegistry` | class | Storage registry |

---

## 19. `util/atomic-write` — Atomic Write

**Package**: `@deepseek-ai/dsh-atomic-write`
**Entry**: `src/index.ts`

---

## Summary: Highest-Reuse Candidates

### Tier 1 — Direct type reuse (eliminate extension duplication)

| Upstream package | Export surface | Extension file to refactor |
|------------------|---------------|---------------------------|
| `host/apiproxy` → `api/rpc.ts` | `ClientRequest`, `ServerResponse`, `ServerRequest`, `RpcId`, `RpcError`, `RpcResult`, `RpcMessage`, `transportError()` | `agent/wire.ts`, `rpc.ts` |
| `host/apiproxy` → `api/events.ts` | `MuxFrame`, `HostFrame`, `ToolEventView`, `QueuedInboxItem` | `agent/wire.ts` |
| `core/session` → `types.ts` | `SessionEvent`, `SessionEventMap`, `SessionId`, `SessionHeader`, `TurnEndReason`, `TodoItem`, `JsonValue` | `agent/wire.ts` |
| `client/connection` → `client/` | `HostDescription`, `SessionSummary`, `ConnectionState`, `ConnectionController` | `agent/wire.ts`, `agent/runtime.ts` |

### Tier 2 — Logic reuse (replace extension implementations)

| Upstream package | What to reuse | Extension file to refactor |
|------------------|---------------|---------------------------|
| `client/connection` → `client/connection.ts` | Reconnection loop with backoff, dual-WS, `ConnectionController` | `agent/runtime.ts` (`HarnessRuntime`) |
| `client/connection` → `client/web-api-client.ts` | `WebApiClient` implementing `IApiClient` | `rpc.ts` (`postRpc`, `listSessions`, `ensureWorkspace`) |
| `sdk/client` → `dispose.ts` | `disposeRuntimeProcess()` EOF→SIGTERM→SIGKILL ladder | `util/dispose.ts` (if extending to process management) |
| `session/session-projection` | Projection service for title/stats | `agent/session-manager.ts` (projection tracking) |

### Tier 3 — Useful types for future features

| Upstream package | Export | Use case |
|------------------|--------|----------|
| `terminal/terminal` | `TerminalSessionService`, `TerminalSpawnRequest`, `TerminalSessionSnapshot` | If extension manages PTY sessions directly |
| `subagent/subagent` | `SubagentRunId`, `SubagentRunInfo`, `SubagentStopReason` | Subagent tree display |
| `workspace/workspace` | `WorkspaceId`, `Workspace`, `WorkspaceRegistry` | Workspace management UI |
| `core/tools` | `ToolCallView`, `ToolResultView`, presentation types | Tool call rendering in webview |
| `settings/settings` | `SettingsNamespace`, `SettingsRegisterOptions` | Settings bridge |

### Upstream dispose patterns

The vendor uses **Cordis-based disposal** (`ctx.effect()`, `ctx.on()` returns disposer, `Service` lifecycle) — NOT a `DisposableSet` pattern. The extension's `DisposableSet` in `util/dispose.ts` is a VS Code–specific adapter with no upstream equivalent. Keep it.

### Extension files with NO upstream equivalent (keep as-is)

| Extension file | Why unique |
|----------------|------------|
| `agent/context.ts` | VS Code–specific editor context formatting (selection, diagnostics, git changes) |
| `agent/patch.ts` | Unified diff parser + applier — no upstream equivalent found |
| `agent/git-parse.ts` | Git CLI output parsers (`status --porcelain`, `diff --numstat`) — no upstream equivalent |
| `util/diff.ts` | Simple line diff — no upstream equivalent |
| `util/dispose.ts` | VS Code `Disposable` adapter — VS Code–specific |
| `util/nonce.ts` | Webview CSP nonce — VS Code–specific |
| `vscode/*.ts` | All VS Code API wrappers — unique to extension |
| `webview/*.ts` | Webview bridge/panel — unique to extension |
