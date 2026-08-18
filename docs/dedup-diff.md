# Vendor Export Diff: rc.5 (47f94385) → rc.7 (99f6f02)

> Generated: 2026-08-18. Scans current vendor files against `docs/vendor-export-catalog.md` (rc.5 baseline).

---

## 1. `host/apiproxy/src/api/` — Wire Protocol Types

### 1.1 Barrel (`index.ts`) — MASSIVE EXPANSION

The old catalog documented **3 domain files** (rpc.ts, events.ts, sessions.ts). rc.7 has **15+ domain files** with a comprehensive `ApiProxy` root interface.

**New root interface:**
| Export | Kind | Description |
|--------|------|-------------|
| `ApiProxy` | interface | Root API surface: `sessions`, `subagents`, `host`, `workspace`, `skills`, `agentPresets`, `events`, `goals`, `settings`, `credentials`, `llm`, `downloads`, `respond()` |

**New domain interfaces (all NEW):**
| Export | Kind | Source file |
|--------|------|-------------|
| `HostApi` | interface | `host.ts` |
| `WorkspaceApi` | interface | `workspace.ts` |
| `AgentPresetsApi` | interface | `agent-presets.ts` |
| `SkillsApi` | interface | `skills.ts` |
| `SubagentsApi` | interface | `subagents.ts` |
| `GoalsApi` | interface | `goals.ts` |
| `SettingsApi` | interface | `settings.ts` |
| `CredentialsApi` | interface | `credentials.ts` |
| `LlmApi` | interface | `llm.ts` |
| `DownloadsApi` | interface | `downloads.ts` |

**New payload/entity types (all NEW):**
| Export | Kind | Source file |
|--------|------|-------------|
| `DirectoryEntry` | interface | `host.ts` |
| `DirectoryListing` | interface | `host.ts` |
| `WorkspaceView` | interface | `workspace.ts` |
| `WorkspaceId` | branded type | `workspace.ts` |
| `AgentPresetEntry` | interface | `agent-presets.ts` |
| `SkillEntry` | interface | `skills.ts` |
| `SubagentListEntry` | type | `subagents.ts` |
| `SubagentAddress` | type | `subagents.ts` |
| `SubagentCatalog` | interface | `subagents.ts` |
| `SubagentPromptReceipt` | interface | `subagents.ts` |
| `SubagentInterruptReceipt` | interface | `subagents.ts` |
| `JobView` | interface | `jobs.ts` |
| `GoalId` | branded type | `goals.ts` |
| `GoalRef` | interface | `goals.ts` |
| `SettingsNamespaceView` | interface | `settings.ts` |
| `SettingsPathOpView` | type | `settings.ts` |
| `SettingsSecretView` | interface | `settings.ts` |
| `CredentialView` | interface | `credentials.ts` |
| `ConfigurableProviderView` | interface | `llm.ts` |
| `DiscoveredModelView` | interface | `llm.ts` |
| `ApprovalResponsePayload` | interface | `approvals.ts` |
| `QuestionResponsePayload` | interface | `questions.ts` |
| `HistoryEntry` | interface | `sessions.ts` |
| `SessionProjectionsBlock` | interface | `sessions.ts` |
| `PromptContentPart` | type | `sessions.ts` |
| `ModelSelection` | interface | `sessions.ts` |
| `ModelReasoning` | interface | `sessions.ts` |
| `ModelReasoningEffort` | interface | `sessions.ts` |
| `ModelCatalogModel` | interface | `sessions.ts` |
| `ModelProviderGroup` | interface | `sessions.ts` |
| `ModelCatalogFailure` | interface | `sessions.ts` |
| `SessionModels` | interface | `sessions.ts` |
| `QueueAction` | type | `sessions.ts` |
| `SessionListMetadata` | interface | `sessions.ts` |

**New schema/registry/constant exports (all NEW):**
| Export | Kind | Source file |
|--------|------|-------------|
| `clientRequestSchema` | const (Zod) | `rpc.schema.ts` |
| `serverRequestSchema` | const (Zod) | `rpc.schema.ts` |
| `serverResponseSchema` | const (Zod) | `rpc.schema.ts` |
| `Wire<T>` | type helper | `rpc.schema.ts` |
| `SESSION_SEARCH_RESULT_LIMIT` | const | `session-search.ts` |
| `SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS` | const | `session-search.ts` |
| `RequestPayload<K>` | type generic | `rpc-map.ts` |
| `ResponseValue<K>` | type generic | `rpc-map.ts` |
| `RpcMethodMap` | interface | `rpc-map.ts` |

### 1.2 `events.ts` — Changed Exports

| Change | Old (rc.5) | New (rc.7) | Impact |
|--------|-----------|-----------|--------|
| `MuxFrame` | 10 frame types | Same 10 + expanded docs for `session/queue`, `session/jobs`, `session/projection` | No new members, but docs clarify `session/projection` carries `{ key, value, seq }` |
| `HostFrame` | 8 frame types (listed in old catalog) | Added `host/workspace-order-changed`, `host/remote-event` | **2 NEW frame variants** — extension switch/if needs new branches |
| `QueuedInboxItem.placement` | `string` (implied) | `'queued' \| 'steering' \| 'context'` (explicit union) | Type narrows from generic to 3-member union |

### 1.3 `rpc.ts` — Changed Exports

| Change | Old (rc.5) | New (rc.7) | Impact |
|--------|-----------|-----------|--------|
| `RpcErrorDetailsMap` | "30+ error codes" | **~40 error codes** — added: `workspace-move-invalid`, `directory-picker-unavailable`, `agent-preset-read-only/locked/conflict/not-found/invalid`, `agent-busy`, `attachment-error`, `queue-item-not-found`, `steer-unavailable`, `command-error`, `unknown-command`, `settings-rejected/conflict`, `credential-rejected`, `model-discovery-failed`, `title-invalid`, `fork-unavailable`, `subagent-parent-unavailable/not-found/catalog-diagnostic/not-resumable/unauthorized/delivery-unavailable` | Extension error handling needs to cover new codes |
| `RpcReceipt` | `{ accepted: true } \| { accepted: false }` | `{ accepted: true } \| { accepted: false; reason: 'not-pending' \| 'bad-response' }` | More precise — `reason` field added to false branch |

### 1.4 `sessions.ts` — Changed Exports

| Change | Old (rc.5) | New (rc.7) | Impact |
|--------|-----------|-----------|--------|
| `SessionSummary` | `{ blank, running, cwd, projections }` | Added `sessionId`, `updatedAt`, `parentSessionId`, `origin`, `agentPreset` | More fields available for extension to consume |
| `HistoryEntry` | Not in old catalog | **NEW** `{ event: SessionEvent, view?: ToolEventView }` | Pagination payload entity |
| `SessionProjectionsBlock` | Not in old catalog | **NEW** `{ asOfSeq, values }` | Projection baseline for history tail page |
| `PromptContentPart` | Not in old catalog | **NEW** `{ type: 'text', text } \| { type: 'image', ... }` | Browser-submitted content |
| `ModelSelection` | Not in old catalog | **NEW** `{ provider, model, reasoningEffort? }` | Model route selection |
| `SessionModels` | Not in old catalog | **NEW** `{ current, routable, groups, failures }` | Model directory snapshot |
| `QueueAction` | Not in old catalog | **NEW** `{ kind: 'edit' \| 'remove' \| 'steer' }` | Queue mutation payload |

---

## 2. `client/connection` — Browser Wire Client

### 2.1 `client/index.ts` — Expanded re-exports

The old catalog listed a single re-export blob. rc.7 re-exports through a separate `api.ts` barrel file with many more types.

**New re-exports added (not in old catalog):**
| Export | Kind |
|--------|------|
| `ApiProxy` | interface |
| `SessionsApi` | interface |
| `SessionSearchItem` | interface |
| `PromptContentPart` | type |
| `HostApi` | interface |
| `EventsApi` | interface |
| `ApprovalResponsePayload` | interface |
| `QuestionResponsePayload` | interface |
| `HistoryEntry` | interface |
| `DirectoryEntry` | interface |
| `DirectoryListing` | interface |
| `WorkspaceApi`, `WorkspaceId`, `WorkspaceView` | interface/branded |
| `SkillsApi`, `SkillEntry` | interface |
| `ModelCatalogFailure`, `ModelCatalogModel`, `ModelProviderGroup` | interface |
| `ModelReasoning`, `ModelReasoningEffort`, `ModelSelection` | interface |
| `QueueAction`, `SessionModels` | type/interface |
| `SubagentsApi`, `SubagentAddress`, `SubagentCatalog`, `SubagentListEntry`, `SubagentPromptReceipt` | interface/type |
| `JobView` | interface |
| `GoalsApi`, `GoalRef` | interface |
| `SettingsApi`, `SettingsNamespaceView`, `SettingsPathOpView`, `SettingsSecretView` | interface/type |
| `CredentialsApi`, `CredentialView` | interface |
| `ConfigurableProviderView`, `DiscoveredModelView`, `LlmApi` | interface |
| `MessageId` | branded type |
| `SESSION_SEARCH_RESULT_LIMIT` | const |
| `ClientConnectionRpc` | type (from `../rpc.ts`) |

### 2.2 `client/api.ts` — NEW file

| Export | Kind | Description |
|--------|------|-------------|
| `resultOf<T>()` | function | Unwrap `RpcResponse<T>` → `RpcResult<T>` — **NEW utility** |
| `HostDescription` | type | Derived via `ResponseValue<'host.describe'>` — **more precise** than old manual type |
| `AbstractApiClient` | class | Re-exported from `@deepseek-ai/dsh-host-apiproxy/client` — **NEW re-export path** |
| `IApiClient` | interface | Re-exported from `@deepseek-ai/dsh-host-apiproxy/client` — **NEW re-export path** |

### 2.3 `ConnectionController` — Signature changed

| Change | Old (rc.5) | New (rc.7) | Impact |
|--------|-----------|-----------|--------|
| Constructor | `new ConnectionController(config, sinks)` | `new ConnectionController(api, sinks, config?)` | **Breaking**: now takes `IApiClient` as first arg |
| `start()` | `start(sinks)` | `start()` (sinks passed at construction) | **Breaking**: sinks moved to constructor |
| `streamOpenTimeoutMs` | Not in old catalog | New config field for strict readiness handshake | Extension's `HarnessRuntime` may need to set this |

---

## 3. `core/session` — Session Types & Store

### 3.1 New exports (not in old catalog)

| Export | Kind | Description |
|--------|------|-------------|
| `AssistantMessage` | type | Re-export from `@deepseek-ai/dsh-llm` |
| `ToolResultMessage` | type | Re-export from `@deepseek-ai/dsh-llm` |
| `UserMessage` | type | Re-export from `@deepseek-ai/dsh-llm` |
| `isJsonValue` | function | JSON losslessness check |
| `snapshotJsonValue` | function | Deep-clone + validate JSON |
| `interruptedTurnClosers` | const | Repair: turn-closing events for interrupted turns |
| `TOOL_NOT_STARTED` | const | Sentinel for incomplete tool calls |
| `TOOL_OUTCOME_UNKNOWN` | const | Sentinel for unknown tool outcomes |
| `decodeStorageRecord` | function | Chunk persistence decoding |
| `packChunkRuns` | function | Chunk persistence encoding |
| `SessionSurface` | interface | Ordered surface abstraction |
| `SurfaceFoldReplacement` | type | Surface fold replacement node |
| `SurfaceFoldResult` | type | Surface fold result |
| `isAppendSurfaceEvent` | type guard | Narrow to append surface event |
| `isReplacementSurfaceEvent` | type guard | Narrow to replacement surface event |
| `isSurfaceEligibleType` | type guard | Narrow to surface-eligible event type |
| `canonicalHeader` | function | Canonical session header |
| `foldRequestHeader` | function | Fold request header state |
| `headerEquals` | function | Structural header equality |
| `SessionPreparationOptions` | interface | Options for `SessionPreparation` |
| `CreateSessionOptions` | interface | Session creation options |
| `RestoredSessionOptions` | interface | Session restore options |
| `PrepareSessionOptions` | type | Union of create/restore options |
| `AgentCancelCause` | type | Cancellation cause: `'user' \| 'parent' \| { kind: 'hook', reason } \| 'disposed'` |
| `TurnEndCancelCause` | type | Extended cancel cause: `AgentCancelCause \| { kind: 'legacy' }` |
| `TurnEndReasonMap` | interface | Merge-extensible turn end reason map |
| `RequestHeaderReason` | type | `'initial' \| 'resume' \| 'change'` |
| `SurfaceIntent` | interface | Surface placement metadata for `Session.append()` |

### 3.2 Changed exports

| Change | Old (rc.5) | New (rc.7) | Impact |
|--------|-----------|-----------|--------|
| `TurnEndReason` | Simple union type | Now derived from `TurnEndReasonMap` interface (merge-extensible) | Same members, but extensible pattern |
| `SurfaceEvent` | `SessionEvent<SurfaceEventType> & { surfaceOp: SurfaceOp }` | Same shape, but now documented as requiring runtime type guard `isSurfaceEvent()` | Type guard is the recommended narrowing path |
| `SessionHeader` | Listed fields | Added `origin?: 'subagent'`, `delegationDepth?: number`, `agentPreset?: string` | More metadata on session headers |
| `RequestContext` | `{ provider, model, contextWindow? }` | Same shape, now documented as "Registration-bound metadata for one resolved model route" | No structural change |

---

## 4. `session/session-projection` — Session Projections

### 4.1 Renamed export

| Old (rc.5) | New (rc.7) | Impact |
|-----------|-----------|--------|
| `SessionProjectionService` | **`SessionProjectionRegistry`** | **Breaking rename** — extension's `session-manager.ts` imports this |

### 4.2 New exports

| Export | Kind | Description |
|--------|------|-------------|
| `SessionProjectionMap` | type re-export | Pure-type outlet from `./types.ts` — browser-importable without cordis |
| `ProjectionChangeListener` | type | Change callback: `(session, key, value, seq) => void` |
| `ProjectionSnapshot` | interface | `{ asOfSeq, values }` — one consistent cut |
| `ProjectionCheckpointRow` | interface | `{ ver, seq, val }` — persisted cache row |
| `ProjectionCheckpoint` | type | `Record<string, ProjectionCheckpointRow>` |

### 4.3 Changed exports

| Change | Old (rc.5) | New (rc.7) | Impact |
|--------|-----------|-----------|--------|
| `ProjectionDefinition` | Listed `key, schema, init, apply, view` | Added `stateVersion: number` field | **Breaking addition** — all definitions must now provide `stateVersion` |
| `SessionProjectionRegistry` methods | Not detailed in old catalog | Now has: `register()`, `onChanged()`, `snapshot()`, `checkpoint()`, `restoreFloor()`, `viewCheckpoint()`, `restore()` | 4 new public methods for persisted cache + cold read |

---

## 5. `client/ui-tool` — UI Tool Presentation

### 5.1 New exports (not in old catalog at all)

| Export | Kind | Description |
|--------|------|-------------|
| `apply` | function | Browser Tool plugin entry |
| `inject` | const array | Required services |
| `ToolCallOwnerProps` | type | Component props |
| `ToolCallViewProps` | type | Component props |
| `ToolDetailsProps` | type | Component props |
| `ToolTreeProps` | type | Component props |

---

## 6. Impact Summary for Extension Dedup

### Breaking changes (must fix):

1. **`SessionProjectionService` → `SessionProjectionRegistry`** — rename in any import
2. **`ProjectionDefinition` now requires `stateVersion`** — if extension registers projections
3. **`ConnectionController` constructor signature changed** — takes `IApiClient` as first arg
4. **`ConnectionController.start()` no longer takes sinks** — sinks move to constructor
5. **`HostFrame` has 2 new variants** (`host/workspace-order-changed`, `host/remote-event`) — switch statements need new branches

### New types the extension should consider using:

- **`ApiProxy`** — canonical root interface for the full API surface
- **`RpcMethodMap`** — method registry for type-safe RPC dispatch
- **`RequestPayload<K>` / `ResponseValue<K>`** — type-safe payload/result extraction
- **`resultOf()`** — utility to unwrap `RpcResponse` → `RpcResult`
- **`HistoryEntry`**, **`SessionProjectionsBlock`** — pagination/projection entities
- **`AgentCancelCause`**, **`TurnEndCancelCause`**, **`TurnEndReasonMap`** — richer error modeling
- **`SurfaceIntent`**, **`isAppendSurfaceEvent()`**, **`isReplacementSurfaceEvent()`** — surface operations
- **`ProjectionCheckpoint`**, **`ProjectionSnapshot`** — persisted cache types for session-projection

### Schema exports available for runtime validation:

- `clientRequestSchema`, `serverRequestSchema`, `serverResponseSchema` (Zod)
- `Wire<T>` type helper for schema matching with `exactOptionalPropertyTypes`
