/**
 * display.ts — 从 append-only 事件日志派生显示项(纯函数,可单测)。
 * 铁律:只吃事件,不自建 messages 模型(TASK §0.5.3);渲染层只消费这里的结果。
 */
import type { SessionEvent } from '../src/agent/wire.js';

export type DisplayItem =
  | { kind: 'user'; text: string; time: number }
  | { kind: 'assistant'; text: string; time: number }
  | { kind: 'assistant-streaming'; turn: number; step: number; text: string; reasoning: string; time: number }
  | { kind: 'tool-call'; turn: number; step: number; tool: string; argsText: string; time: number }
  | { kind: 'tool-result'; turn: number; step: number; tool: string; resultText: string; time: number }
  | { kind: 'error'; message: string; time: number }
  | { kind: 'turn-sep'; turn: number };

interface Accumulator {
  turn: number;
  step: number;
  text: string;
  reasoning: string;
  mode: 'text' | 'reasoning' | 'tool';
  time: number;
}

function contentText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'object' && part !== null) {
        const p = part as { type?: string; text?: unknown };
        if (p.type === 'text' && typeof p.text === 'string') return p.text;
      }
      return '';
    })
    .join('');
}

export function eventsToDisplay(events: SessionEvent[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  let acc: Accumulator | undefined;

  const flush = (): void => {
    if (!acc) return;
    if (acc.text !== '' || acc.reasoning !== '') {
      items.push({
        kind: 'assistant-streaming',
        turn: acc.turn,
        step: acc.step,
        text: acc.text,
        reasoning: acc.reasoning,
        time: acc.time,
      });
    }
    acc = undefined;
  };

  for (const event of events) {
    const data = event.data ?? {};
    switch (event.type) {
      case 'user/message': {
        flush();
        const text = contentText(data.content);
        if (text !== '' && !text.startsWith('<system-reminder>') && !text.startsWith('Current runtime context')) {
          items.push({ kind: 'user', text, time: event.time });
        }
        break;
      }
      case 'assistant/message': {
        flush();
        const text = contentText(data.content);
        if (text !== '') items.push({ kind: 'assistant', text, time: event.time });
        break;
      }
      case 'assistant/chunk': {
        const chunk = data.chunk;
        if (typeof chunk !== 'object' || chunk === null) break;
        const c = chunk as { type?: string; blockType?: string; text?: string; index?: number };
        const turn = typeof data.turn === 'number' ? data.turn : 0;
        const step = typeof data.step === 'number' ? data.step : 0;
        if (!acc || acc.turn !== turn || acc.step !== step) {
          flush();
          acc = { turn, step, text: '', reasoning: '', mode: 'text', time: event.time };
        }
        if (c.type === 'block-start' && typeof c.blockType === 'string') {
          acc.mode = c.blockType === 'reasoning' ? 'reasoning' : c.blockType === 'text' ? 'text' : 'text';
        } else if (c.type === 'reasoning-delta' && typeof c.text === 'string') {
          acc.reasoning += c.text;
        } else if (c.type === 'text-delta' && typeof c.text === 'string') {
          acc.text += c.text;
        } else if (c.type === 'block-end') {
          // 块结束:只切 mode 不 emit(真实 dsh 每 turn 有多个 block-end,
          // 若在此 push 会把同一累积文本重复 emit);最终 flush 统一推一次。
          // 渲染层每次事件到达都会重派生,中间进度天然可见。
          if (acc.mode === 'reasoning') acc.mode = 'text';
        }
        break;
      }
      case 'tool/call': {
        flush();
        const tool = typeof data.tool === 'object' && data.tool !== null
          ? String((data.tool as { name?: unknown }).name ?? 'tool')
          : 'tool';
        items.push({
          kind: 'tool-call',
          turn: typeof data.turn === 'number' ? data.turn : 0,
          step: typeof data.step === 'number' ? data.step : 0,
          tool,
          argsText: JSON.stringify(data.tool ?? {}, null, 2).slice(0, 2000),
          time: event.time,
        });
        break;
      }
      case 'tool/result': {
        flush();
        const tool = typeof data.tool === 'object' && data.tool !== null
          ? String((data.tool as { name?: unknown }).name ?? 'tool')
          : 'tool';
        const raw = data.result ?? data.output ?? data.content;
        items.push({
          kind: 'tool-result',
          turn: typeof data.turn === 'number' ? data.turn : 0,
          step: typeof data.step === 'number' ? data.step : 0,
          tool,
          resultText: JSON.stringify(raw, null, 2).slice(0, 2000),
          time: event.time,
        });
        break;
      }
      case 'turn/start': {
        flush();
        items.push({ kind: 'turn-sep', turn: typeof data.turn === 'number' ? data.turn : 0 });
        break;
      }
      case 'turn/end':
      case 'step/start':
      case 'step/end':
      case 'session/title':
        break; // 渲染层不需要
      default:
        break; // 未知事件:忽略(不进 UI,不报错)
    }
  }
  flush();
  return items;
}
