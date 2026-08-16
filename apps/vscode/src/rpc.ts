/**
 * rpc.ts — dsh 实例 RPC 信封公共模块。
 *
 * 信封协议(TASK §0.3):POST /api/<method>,body {type:'client-request', rpcId, method, payload}
 * → {type:'server-response', rpcId, result:{ok, value}}。仅 127.0.0.1 受信任。
 */

export interface RpcResult {
  ok?: boolean;
  value?: unknown;
}

export interface RpcEnvelope {
  type: 'client-request';
  rpcId: string;
  method: string;
  payload: Record<string, unknown>;
}

/** POST RPC 信封到 /api/<method>;网络/解析失败抛错(调用方决定兜底策略) */
export async function postRpc(
  baseUrl: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<{ result?: RpcResult }> {
  const envelope: RpcEnvelope = {
    type: 'client-request',
    rpcId: `vscode-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    method,
    payload,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as { result?: RpcResult };
  } finally {
    clearTimeout(timer);
  }
}

/** 会话列表项(来自 session.list 的 items 投影,只取 tree 需要的字段) */
export interface SessionItem {
  sessionId: string;
  updatedAt: number;
  running: boolean;
  blank: boolean;
  cwd: string;
  agentPreset: string;
  projections?: {
    values?: { title?: string | null; goal?: string | null; sessionStats?: { turns?: number } };
  };
}

/** 拉取会话列表;失败抛错 */
export async function listSessions(baseUrl: string): Promise<SessionItem[]> {
  const body = await postRpc(baseUrl, 'session.list', {});
  const value = body?.result?.value as { items?: SessionItem[] } | undefined;
  const items = value?.items;
  if (!Array.isArray(items)) throw new Error('session.list: 响应缺少 items');
  return items;
}
