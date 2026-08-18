/**
 * wire-adapters.ts — upstream wire type 与 extension 之间的兼容层。
 *
 * 职责：
 *   1. branded type factory（createRpcId 等）
 *   2. 泛型兼容层（TypedClientRequest<P> 等，Phase M5 启用）
 *   3. 跨 union 合并类型（IncomingFrame，Phase M3 启用）
 *
 * 规则：
 *   - 不重新复制 upstream 类型，只做 adapter/factory
 *   - @ts-expect-error 标签格式：UPSTREAM-MIGRATION(类型名): 原因
 *   - 禁止 @ts-ignore
 */

import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api'

/**
 * 创建 branded RpcId。所有 rpcId 构造集中于此，
 * 上游改 RpcId 定义时只需修改这一处。
 */
export function createRpcId(): RpcId {
  return RpcId(crypto.randomUUID())
}
