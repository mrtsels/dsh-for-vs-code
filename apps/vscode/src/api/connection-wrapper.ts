/**
 * ConnectionWrapper — VS Code adapter over upstream ConnectionController.
 *
 * Responsibilities (host-specific lifecycle that ConnectionController doesn't provide):
 *   - `connect(): Promise<HostDescription>` — Promise-based lifecycle via onConnected waiter
 *   - `rebase(baseUrl)` — stop old, create new api+controller, start
 *   - `subscribeStatus()` — multi-listener fan-out from single onStateChange sink
 *   - `currentState` / `lastError` / `description` — snapshot getters
 *   - `onMuxFrame` / `onHostFrame` — callback slots (same pattern as old HarnessRuntime)
 *
 * Does NOT modify upstream ConnectionController.
 */

import { ConnectionController, type ConnectionSinks, type ConnectionState } from '@deepseek-ai/dsh-client-connection/client'
import type { HostFrame, MuxFrame, RpcId } from '@deepseek-ai/dsh-host-apiproxy/api'
import { DshWebApiClient } from './dsh-web-api-client.js'

// ─── Types (mirroring old runtime.ts public API) ─────────────────────

export type RuntimeState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'disposed'

export interface RuntimeStatus {
  state: RuntimeState
  attempt: number
  error?: string
}

export interface HostDescription {
  cwd?: string
  model?: string
  provider?: string
  version?: string
  [key: string]: unknown
}

export interface ConnectionWrapperOptions {
  baseUrl: string
  backoffBaseMs?: number
  backoffFactor?: number
  backoffMaxMs?: number
  streamOpenTimeoutMs?: number
  timeoutMs?: number
}

// ─── ConnectionWrapper ───────────────────────────────────────────────

export class ConnectionWrapper {
  private api: DshWebApiClient
  private controller: ConnectionController | null = null
  private abortController: AbortController | null = null

  // Lifecycle state
  private _currentState: RuntimeState = 'idle'
  private _lastError?: string
  private _description?: HostDescription
  private _attempt = 0
  private readyResolvers: Array<(d: HostDescription) => void> = []

  // Multi-listener fan-out
  private statusListeners = new Set<(status: RuntimeStatus) => void>()

  // Callback slots (set by extension.ts)
  onMuxFrame?: (frame: MuxFrame, rpcId?: RpcId) => void
  onHostFrame?: (frame: HostFrame, rpcId?: RpcId) => void

  constructor(private readonly options: ConnectionWrapperOptions) {
    this.api = new DshWebApiClient(options.baseUrl, options.timeoutMs)
  }

  // ─── Public API (matches old HarnessRuntime signatures) ────────────

  /** Start connection loop. Returns a Promise that resolves on first successful connect. */
  async connect(): Promise<HostDescription> {
    if (this._description) return this._description
    if (this._currentState === 'disposed') throw new Error('runtime disposed')

    this.startController()
    return new Promise<HostDescription>((resolve) => {
      this.readyResolvers.push(resolve)
    })
  }

  /** Generic unary RPC — delegates to DshWebApiClient.callMethod. */
  async request<T>(method: string, payload: unknown): Promise<{ ok: true; value: T } | { ok: false; error: { code: string; message: string; details: unknown } }> {
    if (this._currentState === 'disposed') throw new Error('runtime disposed')
    const resp = await this.api.callMethod<T>(method, payload)
    return resp.result as { ok: true; value: T } | { ok: false; error: { code: string; message: string; details: unknown } }
  }

  /** Respond to a server-request frame (approval/question etc). */
  async respond(rpcId: RpcId, value: unknown): Promise<{ ok: true; value: unknown } | { ok: false; error: { code: string; message: string; details: unknown } }> {
    if (this._currentState === 'disposed') throw new Error('runtime disposed')
    await this.api.respond({ type: 'client-response', rpcId, result: { ok: true, value } })
    // RpcReceipt is fire-and-forget; the old HarnessRuntime returned RpcResult
    // but the server doesn't send a response to client-response frames.
    return { ok: true, value }
  }

  /** Switch target instance — stop old connection, create new api+controller, start. */
  rebase(baseUrl: string): void {
    this.stop()
    this._description = undefined
    this._lastError = undefined
    this._currentState = 'idle'
    this.readyResolvers = []
    this.api = new DshWebApiClient(baseUrl, this.options.timeoutMs)
    this.startController()
  }

  /** Subscribe to status changes. Returns disposer function. */
  subscribeStatus(listener: (status: RuntimeStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => { this.statusListeners.delete(listener) }
  }

  /** Stop and dispose. */
  dispose(): void {
    if (this._currentState === 'disposed') return
    this.stop()
    this._currentState = 'disposed'
    this.emitStatus()
  }

  // ─── Getters ───────────────────────────────────────────────────────

  get currentState(): RuntimeState { return this._currentState }
  get lastError(): string | undefined { return this._lastError }
  get description(): HostDescription | undefined { return this._description }

  // ─── Internal ──────────────────────────────────────────────────────

  private startController(): void {
    this.abortController?.abort()
    this.abortController = new AbortController()

    const sinks: ConnectionSinks = {
      onConnected: (desc) => {
        this._description = desc as unknown as HostDescription
        this._currentState = 'connected'
        this._attempt = 0
        this.emitStatus()
        // Resolve all pending connect() callers
        for (const r of this.readyResolvers) r(this._description)
        this.readyResolvers = []
      },
      onStateChange: (state) => {
        if (state === 'reconnecting') {
          this._currentState = 'reconnecting'
          this._attempt++
          this.emitStatus()
        }
      },
      onMuxEnvelope: (envelope) => {
        this.onMuxFrame?.(envelope.payload, envelope.rpcId)
      },
      onHostEnvelope: (envelope) => {
        this.onHostFrame?.(envelope.payload, envelope.rpcId)
      },
    }

    this._currentState = 'connecting'
    this.emitStatus()

    this.controller = new ConnectionController(this.api, sinks, {
      backoffBaseMs: this.options.backoffBaseMs,
      backoffFactor: this.options.backoffFactor,
      backoffMaxMs: this.options.backoffMaxMs,
      streamOpenTimeoutMs: this.options.streamOpenTimeoutMs,
    })

    this.controller.start()
  }

  private stop(): void {
    this.controller?.stop()
    this.controller = null
    this.abortController?.abort()
    this.abortController = null
  }

  private emitStatus(): void {
    const status: RuntimeStatus = {
      state: this._currentState,
      attempt: this._attempt,
      error: this._lastError,
    }
    for (const listener of this.statusListeners) {
      try { listener(status) } catch { /* swallow listener errors */ }
    }
  }
}
