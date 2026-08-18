/**
 * runtime @live 集成测试:连真实 127.0.0.1:3080 实例。
 * 服务不可达时自动跳过(保持 G0 全绿);DSH_LIVE=1 时强制运行。
 */
import { describe, expect, it } from 'vitest';
import { ConnectionWrapper } from '../src/api/connection-wrapper.js';

const BASE_URL = process.env.DSH_BASE_URL ?? 'http://127.0.0.1:3080';

async function isReachable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${BASE_URL}/`, { signal: controller.signal });
    clearTimeout(timer);
    return res.status === 200;
  } catch {
    return false;
  }
}

const live = (await isReachable()) || process.env.DSH_LIVE === '1';

describe.runIf(live)('ConnectionWrapper @live', () => {
  it('连接就绪:host.describe 返回 cwd/model,状态到 connected', async () => {
    const statuses: string[] = [];
    const runtime = new ConnectionWrapper({
      baseUrl: BASE_URL,
      backoffBaseMs: 100,
      backoffMaxMs: 300,
    });
    runtime.subscribeStatus((s) => statuses.push(s.state));
    const desc = await runtime.connect();
    expect(desc.cwd).toBeTruthy();
    expect(desc.provider).toBeTruthy();
    expect(desc.model).toBeTruthy();
    expect(statuses).toContain('connected');
    runtime.dispose();
  });

  it('HTTP unary:session.list 可读', async () => {
    const runtime = new ConnectionWrapper({ baseUrl: BASE_URL, backoffBaseMs: 100, backoffMaxMs: 300 });
    await runtime.connect();
    const result = await runtime.request<{ items: unknown[] }>('session.list', {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(Array.isArray(result.value.items)).toBe(true);
    runtime.dispose();
  });
});
