/**
 * bootstrap.ts — 首开会话(Phase 9):确保当前 VS Code 工作区文件夹在 dsh 实例有
 * workspace,复用其空白会话(上游 connectWorkspace 语义)或新建,返回 sessionId。
 * 由 extension 在首次激活 / 工作区文件夹切换时调用;结果持久化 globalState
 * (dsh.initialSessionId),经 __DSH_BOOT_SESSION__ 注入或 dsh:bootstrap-session 补发。
 */

import { DshWebApiClient } from '../api/dsh-web-api-client.js';
import { ensureWorkspace, listSessions } from '../rpc.js';

/**
 * 确保文件夹有会话:workspace.create(幂等)→ 复用空白会话 → 新建。
 * @param baseUrl - 实例地址。
 * @param folderPath - VS Code 工作区文件夹绝对路径。
 * @returns 目标会话 id;实例不可达/路径无效时 undefined(调用方静默)。
 */
export async function ensureFolderSession(
  baseUrl: string,
  folderPath: string,
): Promise<string | undefined> {
  const api = new DshWebApiClient(baseUrl);
  const workspaceId = await ensureWorkspace(api, folderPath);
  if (workspaceId === undefined) return undefined;
  // 复用:该 workspace 成员中已有 cwd 一致的空白会话(与上游 connectWorkspace 同规则)
  const members = await workspaceSessionIds(api, workspaceId);
  if (members !== undefined) {
    const sessions = await listSessions(api).catch(() => []);
    for (const item of sessions) {
      if (item.blank && item.cwd === folderPath && members.has(item.sessionId)) {
        return item.sessionId;
      }
    }
  }
  const created = await api.callMethod<{ sessionId?: string }>('session.create', { workspaceId });
  const sessionId = created.result.value?.sessionId;
  return typeof sessionId === 'string' ? sessionId : undefined;
}

/** workspace.list 中该 workspace 的 sessionIds 集合;失败 undefined。 */
async function workspaceSessionIds(api: DshWebApiClient, workspaceId: string): Promise<Set<string> | undefined> {
  try {
    const resp = await api.callMethod<{ items?: Array<{ workspaceId: string; sessionIds?: string[] }> }>('workspace.list', {});
    const items = resp.result.value?.items;
    const hit = items?.find((w) => w.workspaceId === workspaceId);
    return hit === undefined ? undefined : new Set(hit.sessionIds ?? []);
  } catch {
    return undefined;
  }
}
