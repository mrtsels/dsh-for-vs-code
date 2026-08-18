/**
 * DshWebApiClient — extension-process client for the dsh HTTP + WebSocket transport.
 *
 * Subclasses the upstream `WebApiClient` (browser-safe, zero Node deps) and
 * overrides `resolveBase()` so the carrier POSTs to the configurable dsh
 * instance URL (`http://127.0.0.1:3080` by default) instead of the inherited
 * `location.origin` (which is undefined in Node and falls back to a fake
 * authority that would fail every real request).
 *
 * M6.1 (dedup-plan): first step toward replacing the hand-rolled
 * `HarnessRuntime` RPC + dual-WebSocket loop with the upstream
 * `AbstractApiClient` protocol — connection management lives in
 * `ConnectionWrapper` (M6.1b).
 */

import { WebApiClient } from '@deepseek-ai/dsh-client-connection/client'

export class DshWebApiClient extends WebApiClient {
  /**
   * @param baseUrl - dsh instance root, e.g. `http://127.0.0.1:3080`.
   *                  Must be an absolute URL; WebSocket endpoints are derived
   *                  by swapping the `http` → `ws` scheme.
   * @param timeoutMs - per-unary-call deadline (ms); defaults to the upstream
   *                    30 000 ms. Streams and user-paced calls are exempt.
   */
  constructor(
    private readonly baseUrl: string,
    timeoutMs?: number,
  ) {
    super(timeoutMs)
  }

  /**
   * Anchor all HTTP/WS URLs to the configured instance address.
   *
   * The base class falls back to `globalThis.location.origin` in a browser
   * or `http://dsh.internal` in Node — neither is correct for the extension
   * process, which lives in a Node runtime and talks to a separate dsh
   * server on localhost.
   */
  protected override resolveBase(): string {
    return this.baseUrl
  }

  /**
   * Generic unary RPC — wraps the protected `callUnary` so that
   * `ConnectionWrapper.request<T>()` can dispatch any method by name
   * without knowing the typed IApiClient domain methods.
   */
  async callMethod<T = unknown>(
    method: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<{ result: { ok: boolean; value?: T; error?: { code: string; message: string; details: unknown } } }> {
    // callUnary is protected; this subclass can access it directly.
    // The method name must match a key in RpcMethodMap — upstream will
    // throw at runtime if it doesn't.  We use `as any` to bridge the
    // string→typed-method gap since the extension dispatches by runtime string.
    // @ts-expect-error UPSTREAM-MIGRATION(callUnary): method is runtime string, not compile-time key
    return this.callUnary(method as never, payload, signal) as Promise<{ result: { ok: boolean; value?: T; error?: { code: string; message: string; details: unknown } } }>
  }
}
