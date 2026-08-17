import { describe, expect, it } from 'vitest';
import { HttpProxy } from '../src/vscode/proxy.js';

/**
 * @live 集成测试:连 127.0.0.1:3080(需要 dsh web 在跑)。
 * 验证代理:HTTP 转发(Origin 改写后通过信任栅栏)+ WS 握手(101)。
 */
const BASE = 'http://127.0.0.1:3080';

describe('HttpProxy @live', () => {
  it.skipIf(!process.env.LIVE_3080)('HTTP 转发:host.describe 经代理返回 ok', async () => {
    const proxy = new HttpProxy(BASE);
    const base = await proxy.start();
    try {
      const res = await fetch(`${base}/api/host.describe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 't-live-1', method: 'host.describe', payload: {} }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { result?: { ok?: boolean } };
      expect(body.result?.ok).toBe(true);
      // CORS 头:webview 跨源可读
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
    } finally {
      await proxy.stop();
    }
  });

  it.skipIf(!process.env.LIVE_3080)('WS 转发:events.mux 握手返回 101', async () => {
    const proxy = new HttpProxy(BASE);
    const base = await proxy.start();
    try {
      const wsUrl = base.replace(/^http/, 'ws') + '/api/events.mux';
      const ws = new WebSocket(wsUrl);
      const outcome = await new Promise<boolean>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('WS 握手超时')), 5000);
        ws.onopen = () => {
          clearTimeout(t);
          resolve(true);
        };
        ws.onerror = () => {
          clearTimeout(t);
          reject(new Error('WS 连接失败(代理转发/Origin 改写无效?)'));
        };
      });
      expect(outcome).toBe(true);
      ws.close();
    } finally {
      await proxy.stop();
    }
  });
});
