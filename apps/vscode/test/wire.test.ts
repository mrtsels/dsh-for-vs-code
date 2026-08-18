import { describe, expect, it } from 'vitest';
import {
  encodeClientRequest,
  parseServerRequestFrame,
  parseServerResponse,
  type RpcResult,
} from '../src/agent/wire.js';
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api';

describe('wire 编解码', () => {
  it('encodeClientRequest 产出完整信封', () => {
    const req = encodeClientRequest('session.list', { cursor: 'x' }, RpcId('rpc-1'));
    expect(req).toEqual({ type: 'client-request', rpcId: 'rpc-1', method: 'session.list', payload: { cursor: 'x' } });
  });

  it('parseServerResponse 解出 result 槽(成功)', () => {
    const raw = JSON.stringify({ type: 'server-response', rpcId: 'rpc-1', result: { ok: true, value: { items: [] } } });
    const res = parseServerResponse(raw);
    expect(res.type).toBe('server-response');
    expect(res.result.ok).toBe(true);
  });

  it('parseServerResponse 解出错误槽', () => {
    const raw = JSON.stringify({
      type: 'server-response',
      rpcId: 'rpc-1',
      result: { ok: false, error: { code: 'session-not-found', message: 'nope', details: { sessionId: 's' } } },
    });
    const res = parseServerResponse(raw);
    expect(res.result.ok).toBe(false);
    if (!res.result.ok) expect(res.result.error.code).toBe('session-not-found');
  });

  it('parseServerResponse 对非 JSON / 非信封显式抛错(不静默)', () => {
    expect(() => parseServerResponse('not json')).toThrow();
    expect(() => parseServerResponse(JSON.stringify({ hello: 1 }))).toThrow();
  });

  it('parseServerRequestFrame 解析 WS 帧信封', () => {
    const raw = JSON.stringify({
      type: 'server-request',
      rpcId: 'rpc-2',
      method: 'session/event',
      payload: { type: 'session/event', sessionId: 's', event: { type: 'turn/start', seq: 1, time: 0, data: {} } },
    });
    const frame = parseServerRequestFrame(raw);
    expect(frame.method).toBe('session/event');
    expect(frame.payload).toMatchObject({ type: 'session/event' });
  });
});
