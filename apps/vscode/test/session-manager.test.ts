import { describe, expect, it } from 'vitest';
import { SessionManager } from '../src/agent/session-manager.js';
import type { HarnessRuntime } from '../src/agent/runtime.js';
import type { MuxFrame, SessionEvent } from '../src/agent/wire.js';
/** 测试 helper: string → branded SessionId (cast for test) */
const sid = (s: string) => s as any;

/** 协议边界窄化:测试用的假 runtime,只实现 request */
const mockRuntime = {
  request: async (method: string) => {
    if (method === 'session.list') return { ok: true as const, value: { items: [] } };
    if (method === 'session.create') return { ok: true as const, value: { sessionId: sid('session-new') } };
    if (method === 'session.history') {
      return { ok: true as const, value: { events: [{ event: { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } } }] } };
    }
    return { ok: false as const, error: { code: 'internal', message: 'unexpected', details: {} } };
  },
} as unknown as HarnessRuntime;

/** 测试 helper：用 as SessionEvent 绕过精确 mapped type */
const ev = (partial: Record<string, unknown>): SessionEvent =>
  ({ seq: 0, time: 0, data: {}, ...partial }) as SessionEvent;

describe('SessionManager 事件缓冲', () => {
  it('mux 帧按序追加,不丢不重', () => {
    const sm = new SessionManager(mockRuntime);
    sm.handleMuxFrame({ type: 'session/subscribed', sessionId: sid('s1'), lastSeq: 0 } as unknown as MuxFrame);
    sm.handleMuxFrame({ type: 'session/event', sessionId: sid('s1'), event: ev({ type: 'turn/start', seq: 1, data: { turn: 1 } }) } as unknown as MuxFrame);
    sm.handleMuxFrame({ type: 'session/event', sessionId: sid('s1'), event: ev({ type: 'user/message', seq: 2, data: { content: [] } }) } as unknown as MuxFrame);
    const snapshot = sm.snapshot('s1');
    expect(snapshot.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('running 由 turn/start 置 true、turn/end 置 false', () => {
    const sm = new SessionManager(mockRuntime);
    sm.handleMuxFrame({ type: 'session/event', sessionId: sid('s1'), event: ev({ type: 'turn/start', seq: 1, data: { turn: 1 } }) } as unknown as MuxFrame);
    expect(sm.isRunning('s1')).toBe(true);
    sm.handleMuxFrame({ type: 'session/event', sessionId: sid('s1'), event: ev({ type: 'turn/end', seq: 2, data: { turn: 1, reason: { kind: 'completed' } } }) } as unknown as MuxFrame);
    expect(sm.isRunning('s1')).toBe(false);
  });

  it('seedHistory 用持久化历史重建缓冲', async () => {
    const sm = new SessionManager(mockRuntime);
    await sm.seedHistory('s1');
    expect(sm.snapshot('s1').map((e) => e.seq)).toEqual([1]);
  });

  it('畸形 session/event 帧(缺 event)被丢弃不外抛', () => {
    const sm = new SessionManager(mockRuntime);
    expect(() =>
      sm.handleMuxFrame({ type: 'session/event', sessionId: sid('s1'), event: undefined as any } as any),
    ).not.toThrow();
    expect(sm.snapshot('s1')).toEqual([]);
  });

  it('session/jobs 帧缓存并可查询(P3-4)', () => {
    const sm = new SessionManager(mockRuntime);
    const jobs = [
      { id: 'bash-1', kind: 'bash', label: 'pnpm test', status: 'running' as const, startedAt: 1 },
    ];
    sm.handleMuxFrame({ type: 'session/jobs', sessionId: sid('s1'), jobs } as unknown as MuxFrame);
    expect(sm.jobs('s1')).toEqual(jobs);
  });

  it('session/projection 帧 higher-seq-wins(P3-7)', () => {
    const sm = new SessionManager(mockRuntime);
    const goal = {
      goal: { id: 'g1', revision: 1, objective: '目标A', phase: 'active' },
      roundsStarted: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    sm.handleMuxFrame({ type: 'session/projection', sessionId: sid('s1'), key: 'goal', value: goal, seq: 10 } as unknown as MuxFrame);
    expect(sm.goal('s1')?.goal.objective).toBe('目标A');
    // 旧 seq 不覆盖
    sm.handleMuxFrame({ type: 'session/projection', sessionId: sid('s1'), key: 'goal', value: { goal: { id: 'g1', revision: 2, objective: '旧', phase: 'active' } }, seq: 5 } as unknown as MuxFrame);
    expect(sm.goal('s1')?.goal.revision).toBe(1);
    // 新 seq 覆盖
    sm.handleMuxFrame({ type: 'session/projection', sessionId: sid('s1'), key: 'goal', value: { goal: { id: 'g1', revision: 2, objective: '目标B', phase: 'paused' } }, seq: 11 } as unknown as MuxFrame);
    expect(sm.goal('s1')?.goal.phase).toBe('paused');
  });

  it('seedHistory 消费 projections 块恢复 goal 基线', async () => {
    const runtime = {
      request: async (method: string) => {
        if (method === 'session.history') {
          return {
            ok: true as const,
            value: {
              events: [],
              hasMore: false,
              projections: {
                asOfSeq: 99,
                values: {
                  goal: { goal: { id: 'g9', revision: 3, objective: '恢复目标', phase: 'active' }, roundsStarted: 1, createdAt: 1, updatedAt: 2 },
                },
              },
            },
          };
        }
        return { ok: false as const, error: { code: 'internal', message: 'unexpected', details: {} } };
      },
    } as unknown as HarnessRuntime;
    const sm = new SessionManager(runtime);
    await sm.seedHistory('s1');
    expect(sm.goal('s1')?.goal.objective).toBe('恢复目标');
  });

  it('onEvents 逐帧回调', () => {
    const received: Array<[string, SessionEvent[]]> = [];
    const sm = new SessionManager(mockRuntime, { onEvents: (sid, events) => received.push([sid, events]) });
    sm.handleMuxFrame({ type: 'session/event', sessionId: sid('s1'), event: ev({ type: 'turn/start', seq: 1, data: { turn: 1 } }) } as unknown as MuxFrame);
    expect(received).toHaveLength(1);
    expect(received[0]![0]).toBe('s1');
    expect(received[0]![1]).toHaveLength(1);
  });
});
