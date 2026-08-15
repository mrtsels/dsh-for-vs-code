import { describe, expect, it } from 'vitest';
import { eventsToDisplay } from '../web/display.js';
import type { SessionEvent } from '../src/agent/wire.js';

const ev = (partial: Partial<SessionEvent> & { type: string }): SessionEvent => ({
  seq: 0,
  time: 0,
  data: {},
  ...partial,
});

describe('eventsToDisplay(黄金样本回放)', () => {
  it('user → chunks 累积 → assistant 消息,顺序正确', () => {
    const events: SessionEvent[] = [
      ev({ type: 'turn/start', seq: 1, data: { turn: 1 } }),
      ev({ type: 'user/message', seq: 2, data: { content: [{ type: 'text', text: 'hi' }] } }),
      ev({ type: 'assistant/chunk', seq: 3, data: { turn: 1, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } } }),
      ev({ type: 'assistant/chunk', seq: 4, data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'thinking…' } } }),
      ev({ type: 'assistant/chunk', seq: 5, data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 1, text: 'Hel' } } }),
      ev({ type: 'assistant/chunk', seq: 6, data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 1, text: 'lo' } } }),
      ev({ type: 'assistant/message', seq: 7, data: { content: [{ type: 'text', text: 'Hello' }] } }),
      ev({ type: 'turn/end', seq: 8, data: { turn: 1 } }),
    ];
    const items = eventsToDisplay(events);
    expect(items.map((i) => i.kind)).toEqual(['turn-sep', 'user', 'assistant-streaming', 'assistant']);
    const streaming = items[2] as Extract<(typeof items)[number], { kind: 'assistant-streaming' }>;
    expect(streaming.text).toBe('Hello');
    expect(streaming.reasoning).toBe('thinking…');
    const assistant = items[3] as Extract<(typeof items)[number], { kind: 'assistant' }>;
    expect(assistant.text).toBe('Hello');
  });

  it('tool/call 与 tool/result 成卡片', () => {
    const events: SessionEvent[] = [
      ev({ type: 'tool/call', seq: 1, data: { turn: 1, step: 1, tool: { name: 'read_file', args: { path: 'a.ts' } } } }),
      ev({ type: 'tool/result', seq: 2, data: { turn: 1, step: 1, tool: { name: 'read_file' }, result: { ok: true } } }),
    ];
    const items = eventsToDisplay(events);
    expect(items.map((i) => i.kind)).toEqual(['tool-call', 'tool-result']);
    expect(items[0]).toMatchObject({ tool: 'read_file' });
  });

  it('系统提醒(user/message 内嵌 <system-reminder>)不渲染为气泡', () => {
    const events: SessionEvent[] = [
      ev({ type: 'user/message', seq: 1, data: { content: [{ type: 'text', text: '<system-reminder>\n…' }] } }),
    ];
    expect(eventsToDisplay(events)).toEqual([]);
  });

  it('未知事件类型被忽略,不抛错', () => {
    const events: SessionEvent[] = [
      ev({ type: 'totally/unknown', seq: 1, data: { anything: true } }),
      ev({ type: 'session/title', seq: 2, data: { title: 'x' } }),
    ];
    expect(eventsToDisplay(events)).toEqual([]);
  });
});
