import { describe, expect, it } from 'vitest';
import { SessionManager } from '../src/agent/session-manager.js';
import type { HarnessRuntime } from '../src/agent/runtime.js';
import type { SessionEvent } from '../src/agent/wire.js';

/** 协议边界窄化:测试用的假 runtime,只实现 request */
const mockRuntime = {
  request: async (method: string) => {
    if (method === 'session.list') return { ok: true as const, value: { items: [] } };
    if (method === 'session.create') return { ok: true as const, value: { sessionId: 'session-new' } };
    if (method === 'session.history') {
      return { ok: true as const, value: { events: [{ event: { type: 'turn/start', seq: 1, time: 1, data: {} } }] } };
    }
    return { ok: false as const, error: { code: 'internal', message: 'unexpected', details: {} } };
  },
} as unknown as HarnessRuntime;

const ev = (partial: Partial<SessionEvent> & { type: string }): SessionEvent => ({
  seq: 0,
  time: 0,
  data: {},
  ...partial,
});

describe('SessionManager 事件缓冲', () => {
  it('mux 帧按序追加,不丢不重', () => {
    const sm = new SessionManager(mockRuntime);
    sm.handleMuxFrame({ type: 'session/subscribed', sessionId: 's1', lastSeq: 0 });
    sm.handleMuxFrame({ type: 'session/event', sessionId: 's1', event: ev({ type: 'turn/start', seq: 1 }) });
    sm.handleMuxFrame({ type: 'session/event', sessionId: 's1', event: ev({ type: 'user/message', seq: 2 }) });
    const snapshot = sm.snapshot('s1');
    expect(snapshot.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('running 由 turn/start 置 true、turn/end 置 false', () => {
    const sm = new SessionManager(mockRuntime);
    sm.handleMuxFrame({ type: 'session/event', sessionId: 's1', event: ev({ type: 'turn/start', seq: 1, data: { turn: 1 } }) });
    expect(sm.isRunning('s1')).toBe(true);
    sm.handleMuxFrame({ type: 'session/event', sessionId: 's1', event: ev({ type: 'turn/end', seq: 2, data: { turn: 1 } }) });
    expect(sm.isRunning('s1')).toBe(false);
  });

  it('title 从 session/title 事件捕获', () => {
    const sm = new SessionManager(mockRuntime);
    sm.handleMuxFrame({ type: 'session/event', sessionId: 's1', event: ev({ type: 'session/title', seq: 1, data: { title: 'Hello' } }) });
    expect(sm.title('s1')).toBe('Hello');
  });

  it('seedHistory 用持久化历史重建缓冲', async () => {
    const sm = new SessionManager(mockRuntime);
    await sm.seedHistory('s1', 50);
    expect(sm.snapshot('s1').map((e) => e.type)).toEqual(['turn/start']);
  });

  it('onEvents 逐帧回调', () => {
    const received: Array<[string, SessionEvent[]]> = [];
    const sm = new SessionManager(mockRuntime, { onEvents: (sid, events) => received.push([sid, events]) });
    sm.handleMuxFrame({ type: 'session/event', sessionId: 's1', event: ev({ type: 'turn/start', seq: 1 }) });
    expect(received).toHaveLength(1);
    expect(received[0]![0]).toBe('s1');
    expect(received[0]![1]).toHaveLength(1);
  });
});
