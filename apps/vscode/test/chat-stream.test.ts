import { describe, expect, it } from 'vitest';
import { createChatStreamState, stepChatStream } from '../src/commands/chat-stream.js';
import type { SessionEvent } from '../src/agent/wire.js';

/** 测试 helper：用 as SessionEvent 绕过精确 mapped type，构造测试用事件 */
const ev = (partial: Record<string, unknown>): SessionEvent =>
  ({ seq: 0, time: 0, data: {}, ...partial }) as SessionEvent;

const chunk = (seq: number, c: { type: string; text?: string; blockType?: string }): SessionEvent =>
  ev({ type: 'assistant/chunk', seq, data: { turn: 1, step: 1, chunk: { index: 0, ...c } } });

describe('stepChatStream(seq 水印语义)', () => {
  it('水印:seq ≤ lastSeq 的事件全部跳过(重复推送安全),只推进水印', () => {
    const state = createChatStreamState(5);
    const actions = stepChatStream(state, [
      ev({ type: 'turn/start', seq: 3, data: { turn: 1 } }),
      ev({ type: 'user/message', seq: 4, data: { content: [{ type: 'text', text: 'old' }] } }),
      ev({ type: 'turn/start', seq: 5, data: { turn: 1 } }),
      ev({ type: 'step/start', seq: 6, data: { turn: 1, step: 1 } }),
      ev({ type: 'user/message', seq: 7, data: { content: [{ type: 'text', text: 'hi' }] } }),
    ]);
    expect(actions).toEqual([]);
    expect(state.lastSeq).toBe(7);
    expect(state.acc).toBe('');
    expect(state.sawTextDelta).toBe(false);
    expect(state.ended).toBe(false);
  });

  it('text-delta 累积进 acc,reasoning/block/usage/finish 块不产出文本', () => {
    const state = createChatStreamState(0);
    stepChatStream(state, [
      chunk(1, { type: 'block-start', blockType: 'reasoning' }),
      chunk(2, { type: 'reasoning-delta', text: '思考中…' }),
      chunk(3, { type: 'block-start', blockType: 'text' }),
      chunk(4, { type: 'text-delta', text: 'Hel' }),
      chunk(5, { type: 'text-delta', text: 'lo' }),
      chunk(6, { type: 'block-end' }),
      chunk(7, { type: 'usage' }),
      chunk(8, { type: 'finish' }),
    ]);
    expect(state.acc).toBe('Hello');
    expect(state.sawTextDelta).toBe(true);
    expect(state.ended).toBe(false);
  });

  it('去重:已有 text-delta 时,assistant/message 携带的内容不再渲染(避免整段重复)', () => {
    const state = createChatStreamState(0);
    const actions = stepChatStream(state, [
      chunk(1, { type: 'text-delta', text: '答案' }),
      ev({ type: 'assistant/message', seq: 2, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '答案' }] } } }),
    ]);
    expect(state.acc).toBe('答案');
    expect(actions).toEqual([]); // message 内容被跳过
  });

  it('无 text-delta 时,assistant/message 内容是唯一正文 → markdown 动作', () => {
    const state = createChatStreamState(0);
    const actions = stepChatStream(state, [
      ev({ type: 'assistant/message', seq: 1, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '完整回答' }] } } }),
    ]);
    expect(state.acc).toBe('');
    expect(state.sawTextDelta).toBe(false);
    expect(actions).toEqual([{ kind: 'markdown', text: '完整回答' }]);
  });

  it('assistant/message 无 content → 无动作', () => {
    const state = createChatStreamState(0);
    expect(stepChatStream(state, [ev({ type: 'assistant/message', seq: 1, data: { turn: 1, step: 1, message: {} } })])).toEqual([]);
  });

  it('turn/end → end 动作;其后事件在同一批内不再消费(调用方收到 end 即停止)', () => {
    const state = createChatStreamState(0);
    const actions = stepChatStream(state, [
      chunk(1, { type: 'text-delta', text: '收尾' }),
      ev({ type: 'turn/end', seq: 2, data: { turn: 1, reason: { kind: 'completed' } } }),
      ev({ type: 'assistant/message', seq: 3, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '不应出现' }] } } }),
    ]);
    expect(state.ended).toBe(true);
    expect(actions).toEqual([{ kind: 'end' }]);
    expect(state.acc).toBe('收尾'); // 调用方收到 end 后 flush 它
  });

  it('黄金时间线回放(实测形状,docs/http-bridge.md):只累积 text-delta,message 完成标记被跳过,end 收尾', () => {
    const state = createChatStreamState(3);
    const events: SessionEvent[] = [
      ev({ type: 'turn/start', seq: 4, data: { turn: 1 } }),
      ev({ type: 'step/start', seq: 6, data: { turn: 1, step: 1 } }),
      ev({ type: 'user/message', seq: 7, data: { content: [{ type: 'text', text: 'p' }] } }),
      ev({ type: 'user/message', seq: 8, data: { content: [{ type: 'text', text: 'p' }] } }),
      ev({ type: 'request/header', seq: 12, data: { header: {}, reason: 'initial' } }),
      ev({ type: 'request/context', seq: 13, data: { provider: 'test', model: 'test' } }),
      chunk(16, { type: 'block-start', blockType: 'reasoning' }),
      chunk(17, { type: 'reasoning-delta', text: '想' }),
      chunk(18, { type: 'reasoning-delta', text: '想' }),
      chunk(19, { type: 'block-start', blockType: 'text' }),
      chunk(20, { type: 'text-delta', text: '你' }),
      chunk(21, { type: 'text-delta', text: '好' }),
      chunk(22, { type: 'block-end' }),
      chunk(23, { type: 'usage' }),
      chunk(24, { type: 'finish' }),
      ev({ type: 'assistant/message', seq: 25, data: { turn: 1, step: 1, message: {} } }), // live 完成标记
      ev({ type: 'step/end', seq: 26, data: { turn: 1, step: 1 } }),
      ev({ type: 'turn/end', seq: 27, data: { turn: 1, reason: { kind: 'completed' } } }),
    ];
    const actions = stepChatStream(state, events);
    expect(state.acc).toBe('你好');
    expect(state.sawTextDelta).toBe(true);
    expect(state.lastSeq).toBe(27);
    expect(state.ended).toBe(true);
    expect(actions).toEqual([{ kind: 'end' }]); // 无 markdown:正文只来自 chunks
  });

  it('多轮推进:新 startSeq 只消费新事件,旧 turn 重复推送不重复渲染', () => {
    const state = createChatStreamState(0);
    stepChatStream(state, [chunk(1, { type: 'text-delta', text: '一' }), ev({ type: 'turn/end', seq: 2, data: { turn: 1, reason: { kind: 'completed' } } })]);
    expect(state.acc).toBe('一');
    state.acc = ''; // 调用方已 flush
    const actions = stepChatStream(state, [
      // 服务端重放旧事件(seq ≤ 水印)→ 跳过
      chunk(1, { type: 'text-delta', text: '一' }),
      ev({ type: 'turn/end', seq: 2, data: { turn: 1, reason: { kind: 'completed' } } }),
      // 新一轮
      ev({ type: 'turn/start', seq: 3, data: { turn: 2 } }),
      chunk(4, { type: 'text-delta', text: '二' }),
      ev({ type: 'assistant/message', seq: 5, data: { turn: 2, step: 1, message: {} } }),
      ev({ type: 'turn/end', seq: 6, data: { turn: 2, reason: { kind: 'completed' } } }),
    ]);
    expect(state.acc).toBe('二');
    expect(actions).toEqual([{ kind: 'end' }]);
  });
});
