# Dedup File Diff: rc.5 → rc.7

**Vendor**: `47f94385` (rc.5) → `99f6f02` (rc.7)  
**Date**: 2026-08-18  
**Scope**: Extension source files vs upstream vendor packages

## Summary

The rc.5→rc.7 diff across the target files is **minimal**: only 3 files changed, all trivial:

| File | Change |
|------|--------|
| `api/rpc.ts` | Removed `'settings-not-exposed'` error code (6 lines) |
| `api/rpc.schema.ts` | Removed corresponding Zod schema branch (1 line) |
| `session-projection/package.json` | Version bump only (no type changes) |

**No new types were added.** No signatures changed. One error code was removed. The extension's `wire.ts` never referenced `settings-not-exposed` (it uses `code: string` for `RpcError`), so **no extension code needs updating**.

---

## File 1: `wire.ts` vs `packages/host/apiproxy/src/api/`

### Types Still Duplicated (no change since rc.5)

| Extension Type | Upstream Source | Notes |
|---|---|---|
| `RpcId = string` | `rpc.ts`: `RpcId = Branded<'rpc-id'>` | Extension uses plain string (brand erased at boundary) |
| `ClientRequest<P>` | `rpc.ts`: `ClientRequest` (non-generic, `payload: unknown`) | Extension adds generic parameter; upstream is non-generic |
| `RpcError` | `rpc.ts`: discriminated union by code | Extension uses `{ code: string; message: string; details: unknown }` (erased) |
| `RpcResult<T>` | `rpc.ts`: same `{ ok: true; value: T } \| { ok: false; error: RpcError }` | Identical shape; extension's RpcError is simpler |
| `ServerResponse<T>` | `rpc.ts`: non-generic | Extension adds generic parameter |
| `ServerRequest<P>` | `rpc.ts`: non-generic | Extension adds generic parameter |
| `JobView` | `jobs.ts` | **Matching** — same fields: `id`, `kind`, `label`, `status`, `detail?`, `startedAt`, `finishedAt?` |
| `SkillEntry` | `skills.ts` | **Matching** — same fields: `name`, `description`, `whenToUse?`, `modelInvocable` |
| `SubagentEntry` | `subagents.ts`: `SubagentListEntry` | Extension uses simplified union; upstream uses intersection with `mode` discriminated `label?: string` (one-shot) vs `label: string` (continuable) |
| `SessionSummary` | `sessions.ts` | Extension omits: `parentSessionId?`, `origin?` (subagent). Added in rc.5 already, no rc.7 change |
| `SessionHistoryResponse` | `sessions.ts` history response value | Extension uses inline `{ events: Array<{ event }>; hasMore; projections? }`; upstream uses `HistoryEntry[]` with `event` + optional `view` |
| `MuxFrame` | `events.ts` | Matching union shape. Extension uses loose types; upstream uses branded `SessionId`, `ApprovalRequestId`, etc |
| `HostFrame` | `events.ts` | Matching union. Extension omits: `host/workspace-order-changed`, `host/remote-event` (added in rc.5, unchanged in rc.7) |
| `HostDescription` | `api.ts` re-export of `ResponseValue<'host.describe'>` | Matches |

### Types with NEW Equivalents (didn't exist in rc.5)

**None.** No new types were added upstream between rc.5 and rc.7.

### Types with CHANGED Signatures

**None.** No type signatures changed between rc.5 and rc.7.

### Types REMOVED Upstream

| Removed Type | rc.5 Location | rc.7 Impact on Extension |
|---|---|---|
| `settings-not-exposed` (error code) | `rpc.ts` RpcErrorDetailsMap + `rpc.schema.ts` Zod branch | **None** — extension `RpcError` uses `code: string` (erased), never referenced this code |

### Extension-Only Types (no upstream equivalent)

| Type | Purpose |
|---|---|
| `TextPromptPart` | Simplified `PromptPart = TextPromptPart` (Phase 1 text only) |
| `PromptPart` | Union of prompt content parts |
| `EventData` | Loose bag `{ turn?; step?; content?; chunk?; title?; reason?; source?; tool?; [key: string]: unknown }` |
| `Chunk` | Assistant message chunk: `{ type; index; blockType?; text?; [key: string]: unknown }` |
| `GoalView` | Goal projection shape: `{ goal: { id; revision; objective; phase; maxGoalRounds? }; roundsStarted; createdAt; updatedAt }` |
| `DynamicCordisInventoryRow` | Cordis runner inventory row (extension-only protocol subset) |

---

## File 2: `rpc.ts` vs `packages/client/connection/src/client/`

### Types Still Duplicated (no change since rc.5)

| Extension Type | Upstream Source | Notes |
|---|---|---|
| `RpcResult` | `api.ts`: re-export from `api/rpc.ts` `RpcResult<T>` | Extension uses non-generic `{ ok?; value? }` (loosened); upstream is strict discriminated |
| `RpcEnvelope` | `api.ts`: maps to `ClientRequest` shape | Extension hardcodes `type: 'client-request'` and `rpcId: string`; upstream uses branded `RpcId` |
| `SessionItem` | Derived from `sessions.ts`: `SessionSummary` | Extension adds `projections.values.goal` field; upstream `SessionSummary.projections` uses `SessionProjectionsBlock` with typed `SessionProjectionMap` |

### Function Equivalents

| Extension Function | Upstream Equivalent | Notes |
|---|---|---|
| `postRpc()` | `AbstractApiClient` methods via `IApiClient` | Extension uses raw `fetch` + AbortController; upstream uses abstract client with typed methods |
| `listSessions()` | `SessionsApi.list()` | Extension parses raw JSON; upstream uses typed `RpcRequest`/`RpcResponse` |
| `ensureWorkspace()` | `WorkspaceApi.create()` + `WorkspaceApi.list()` | Extension does list+create inline; upstream separates into typed methods |

### Types with NEW Equivalents (didn't exist in rc.5)

**None.**

### Types with CHANGED Signatures

**None.**

### Types REMOVED Upstream

**None.**

### Extension-Only Types

| Type | Purpose |
|---|---|
| `RpcEnvelope` | Extension-specific HTTP envelope (subset of `ClientRequest`) |
| `SessionItem` | Extension-specific list item with projections.goal |

---

## File 3: `runtime.ts` vs `packages/client/connection/src/client/connection.ts`

### Types Still Duplicated (no change since rc.5)

| Extension Type | Upstream Equivalent | Notes |
|---|---|---|
| `RuntimeState` | `ConnectionState = 'connected' \| 'reconnecting'` | Extension has richer state: `'idle' \| 'connecting' \| 'connected' \| 'reconnecting' \| 'disconnected'` |
| `RuntimeStatus` | `ConnectionSinks.onStateChange` + `onConnected` | Extension bundles state+attempt+error into one object; upstream separates into sinks |
| `HarnessRuntimeOptions` | `ConnectionConfig` + `ConnectionSinks` + `api: IApiClient` | Extension takes `baseUrl` + callbacks; upstream takes abstract `IApiClient` + `ConnectionSinks` + `ConnectionConfig` |
| `HarnessRuntime` class | `ConnectionController` class | See method comparison below |

### Class Method Comparison

| Extension Method | Upstream Equivalent | Status |
|---|---|---|
| `connect()` → `Promise<HostDescription>` | `start()` (void) + `onConnected` callback | **Different pattern**: extension returns promise; upstream fires callback |
| `rebase(baseUrl)` | Not present (upstream uses abort+restart) | **Extension-only** — dynamic target switching |
| `request<T>(method, payload)` | `IApiClient` typed methods | **Different**: extension uses dynamic dispatch; upstream uses static typed methods |
| `respond(rpcId, value)` | Not present in `ConnectionController` (lives in business layer) | **Extension-only** — handles approval/question responses |
| `dispose()` | `stop()` | Same semantics, different name |
| `subscribeStatus()` | `ConnectionSinks.onStateChange` (single sink) | Extension uses multi-subscriber Set; upstream uses single callback |
| `lastError` property | No equivalent | Extension-only state for status bar |
| `currentState` getter | No equivalent | Extension-only |
| `currentBaseUrl` getter | No equivalent (upstream doesn't support rebase) | Extension-only |
| `description` getter | No equivalent (upstream passes via callback) | Extension-only |

### Types with NEW Equivalents (didn't exist in rc.5)

**None.**

### Types with CHANGED Signatures

**None.** `ConnectionController` was already present in rc.5; no signature changes in rc.7.

### Types REMOVED Upstream

**None.**

---

## File 4: `session-manager.ts` vs `packages/session/session-projection/`

### Architectural Difference

The extension's `session-manager.ts` is a **manual event buffer + projection cache** that reimplements what `session-projection` does server-side:

| Extension Concept | Upstream Equivalent |
|---|---|
| `SessionState.events: SessionEvent[]` | `Session` (host-side, in-memory) |
| `SessionState.projections: Map<string, {value, seq}>` | `SessionProjectionRegistry` watermark cache (per-session `UnitCell`) |
| `SessionState.jobs: JobView[]` | Pushed via `session/jobs` mux frame (host-side registry) |
| `SessionState.title: string` | Derived from `title` projection key |
| `SessionState.running: boolean` | Derived from `turn/start` / `turn/end` events |
| `SessionManager.handleMuxFrame()` | `SessionProjectionRegistry.drive()` (auto-driven by `session/event` subscription) |
| `SessionManager.seedHistory()` | `SessionProjectionRegistry.restore()` (checkpoint + tail replay) |
| `SessionManager.list()` | `SessionsApi.list()` (typed RPC) |
| `SessionManager.create()` | `SessionsApi.create()` (typed RPC) |
| `SessionManager.fork()` | `SessionsApi.fork()` (typed RPC) |
| `SessionManager.goalCreate/Control()` | `GoalsApi.create/pause/resume/complete/clear` (typed RPCs) |
| `SessionManager.listSkills()` | `SkillsApi.list()` (typed RPC) |
| `SessionManager.listSubagents()` | `SubagentsApi.list()` (typed RPC) |
| `SessionManager.interruptSubagent()` | `SubagentsApi.interrupt()` (typed RPC) |

### Types Still Duplicated (no change since rc.5)

| Extension Type | Upstream Equivalent | Notes |
|---|---|---|
| `SessionState` (interface) | Internal to `SessionProjectionRegistry` | Extension bundles all state; upstream separates `UnitCell`, `Registration`, `Session` |
| `isGoalView()` type guard | `ProjectionDefinition.schema.parse()` | Extension does manual shape check; upstream uses Zod schema |

### Types with NEW Equivalents (didn't exist in rc.5)

**None.**

### Types with CHANGED Signatures

**None.** The `session-projection` package was unchanged in rc.7 (only `package.json` version bump).

### Types REMOVED Upstream

**None.**

---

## rc.5 → rc.7 Change Log (Vendor Side)

### Removed Error Codes

| Error Code | rc.5 | rc.7 | Extension Impact |
|---|---|---|---|
| `settings-not-exposed` | Present in `RpcErrorDetailsMap` + `rpc.schema.ts` | **Removed** | **None** — extension uses `code: string` |

### Removed Schema Branches

| Schema | rc.5 | rc.7 | Extension Impact |
|---|---|---|---|
| `rpcErrorSchema` Zod discriminated union | Had `settings-not-exposed` branch | Branch removed | **None** — extension doesn't use Zod schemas |

---

## Conclusion

The rc.5→rc.7 vendor update introduced **zero new equivalences** and **zero signature changes** in the target files. The only change was removing the `settings-not-exposed` error code, which has no impact on the extension because:

1. The extension's `RpcError` uses `{ code: string; ... }` (erased — never references specific error codes)
2. The extension's `wire.ts` comment says "rc.6" but was actually synced against rc.5 vendor
3. The `session-projection` package had only a `package.json` version bump — no type changes

**No extension code changes required for the rc.5→rc.7 vendor update.**
