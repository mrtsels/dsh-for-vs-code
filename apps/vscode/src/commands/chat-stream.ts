/**
 * chat-stream.ts — ChatParticipant 流式渲染的纯逻辑(零 vscode 依赖,可单测)。
 * 语义(P4-1 seq review,见 docs/reviews/phase-4.md):
 * - 以会话事件日志的 seq 为水印增量消费;事件 seq ≤ lastSeq 一律跳过(重复推送安全)。
 * - text-delta 累积为正文(acc),由调用方按节流刷出(打字机效果)。
 * - rc.6 实测(live 流,docs/http-bridge.md goldenTimeline):assistant/message 是完成标记,
 *   data 无 content,正文全在 text-delta;历史重建的 assistant/message 才带 content。
 *   因此同一 turn 已出现 text-delta 时,message 内容整段跳过(否则与累积正文重复);
 *   仅当正文只来自 message(无 text-delta)时才渲染。
 * - turn/end → end 动作,调用方 flush 后停止;其余事件(user/message、turn/start、step/*、
 *   request/*、session/title、tool/*、reasoning/block/usage/finish 块)只推进水印,不产出动作。
 */
import type { SessionEvent } from '../agent/wire.js';
import { extractContentText } from '../agent/context.js';

export interface ChatStreamState {
  /** 已消费的最大 seq(水印) */
  lastSeq: number;
  /** text-delta 累积正文(调用方读它刷出,刷出后置空) */
  acc: string;
  /** 是否已见 text-delta(assistant/message 去重依据) */
  sawTextDelta: boolean;
  /** 是否已见 turn/end */
  ended: boolean;
}

export type ChatStreamAction = { kind: 'markdown'; text: string } | { kind: 'end' };

export function createChatStreamState(startSeq: number): ChatStreamState {
  return { lastSeq: startSeq, acc: '', sawTextDelta: false, ended: false };
}

/**
 * 推进水印并消费一批事件(原地更新 state;事件须为同一会话)。
 * 返回本批需要调用方处理的动作:markdown(立即整段输出)/ end(flush 后停止)。
 */
export function stepChatStream(state: ChatStreamState, events: SessionEvent[]): ChatStreamAction[] {
  const actions: ChatStreamAction[] = [];
  for (const event of events) {
    if (event.seq <= state.lastSeq) continue;
    state.lastSeq = event.seq;
    switch (event.type) {
      case 'assistant/chunk': {
        const chunk = event.data?.chunk as { type?: string; text?: unknown } | undefined;
        if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
          state.acc += chunk.text;
          state.sawTextDelta = true;
        }
        break;
      }
      case 'assistant/message': {
        // 去重:chunks 已是正文时,message 内容(若带)与累积文本整段重复 → 跳过
        if (!state.sawTextDelta) {
          const t = extractContentText(event.data?.message?.content);
          if (t !== '') actions.push({ kind: 'markdown', text: t });
        }
        break;
      }
      case 'turn/end': {
        state.ended = true;
        actions.push({ kind: 'end' });
        break;
      }
      default:
        break; // 只推进水印
    }
  }
  return actions;
}
