# Dedup Plan Validity Report: rc.5 → rc.7

**Date**: 2026-08-18  
**Vendor rev**: `47f94385` (rc.5) → `99f6f02` (rc.7)  
**Conclusion**: **Plan is 99% valid. One minor error-code removal; no structural changes.**

---

## Summary of Findings

### 1. Build System / Package Structure ✅ No Change
- Package structure unchanged (same packages in `packages/`)
- No packages deleted; no new packages added (only minor internal files: `content.ts`, `safari.ts`, `useDismissOnOutsidePointer.ts`, `tab-store.ts` — none relevant to dedup)
- Package versions bumped (rc.7) but no entry-point or export-map changes in any package the plan references

### 2. `host/apiproxy/src/api/rpc.ts` — Wire Types ✅ Mostly Unchanged
**One change**: `RpcErrorDetailsMap` lost the `'settings-not-exposed'` error code:
- rc.5 had: `'settings-not-exposed': { ns: string }`
- rc.7: removed entirely
- **Impact on plan**: None. The plan doesn't reference `settings-not-exposed` — it works with `ClientRequest`, `ServerResponse`, `ServerRequest`, `RpcId`, `RpcError`, `RpcResult`, `RpcMessage`, `MuxFrame`, `HostFrame`. All of these are unchanged.

All other rpc.ts types (`RpcId`, `RpcError`, `RpcResult`, `ClientRequest`, `ServerResponse`, `ServerRequest`, `ClientResponse`, `RpcMessage`, `RpcReceipt`) are identical.

### 3. `host/apiproxy/src/api/events.ts` — Frame Types ✅ No Change
- `MuxFrame`: all 10+ discriminants identical
- `HostFrame`: all 8+ discriminants identical (including `host/workspace-order-changed` and `host/remote-event` which were already in rc.5)
- `ToolEventView`, `QueuedInboxItem`, `EventsApi`: unchanged

### 4. `client/connection/src/client/index.ts` — ConnectionController ✅ No Change
- `ConnectionController` constructor signature: `(api: IApiClient, sinks: ConnectionSinks, config?: ConnectionConfig)` — same
- `ConnectionSinks` interface: same (onMuxEnvelope, onHostEnvelope, onConnected, onStateChange)
- `ConnectionState`: `'connected' | 'reconnecting'` — same
- `ConnectionConfig`: same tunables (backoffBaseMs, backoffFactor, backoffMaxMs, streamOpenTimeoutMs)
- `HostDescriptionSource`, `ConnectionHandle`: unchanged
- Re-exports list in `index.ts`: identical (includes all the types the plan references)

### 5. `client/connection/src/client/api.ts` — IApiClient ✅ No Change
- `IApiClient` interface: identical method surface
- `HostDescription` type derivation: same
- Re-export list: unchanged

### 6. `core/session/src/types.ts` — SessionEvent Types ✅ No Change
- `SessionEventMap`: all 13+ event types identical
- `SessionEvent<T>` discriminated union: same shape (seq, time, data, ignorable?, sourceEventSeqs?, surfaceOp?)
- `SessionId`, `TurnEndReason`, `TodoItem`, `EpochHeader`, `RequestContext`: unchanged

### 7. `api-proxy.ts` — Server Implementation (Not Relevant to Plan)
- `WEB_SETTINGS_NAMESPACES` array removed (matches the `settings-not-exposed` error code removal)
- Some image-limit checks moved/refactored
- **These are server-side changes; the dedup plan only consumes client-side types**

---

## Plan Action Items

| Plan Section | Status | Action Needed |
|-------------|--------|---------------|
| §2.1 wire.ts → apiproxy/api | ✅ Valid | No change needed |
| §2.2 rpc.ts → WebApiClient | ✅ Valid | No change needed |
| §3.1 runtime.ts → ConnectionController | ✅ Valid | No change needed |
| §3.2 session-manager.ts → SessionEvent | ✅ Valid | No change needed |
| §5 Build system (tsconfig paths + esbuild alias) | ✅ Valid | No change needed |
| §6 Implementation phases | ✅ Valid | No change needed |
| §8 Risk register | ✅ Valid | No change needed |
| Vendor-export-catalog.md | ⚠️ Minor | Update line 4: "rev rc.5 = `47f94385`" → "rev rc.7 = `99f6f02`" |
| Vendor-export-catalog.md | ⚠️ Minor | Consider noting `settings-not-exposed` removal if catalog mentions it |

---

## Verdict

**The dedup plan is fully valid against rc.7.** The only change between rc.5 and rc.7 is the removal of the `settings-not-exposed` error code from `RpcErrorDetailsMap`, which doesn't affect any plan step. All types, interfaces, and APIs the plan targets for reuse are byte-identical between versions.

**Recommended action**: Update the vendor rev reference in `docs/vendor-export-catalog.md` from `47f94385` to `99f6f02`. No other plan changes needed.
