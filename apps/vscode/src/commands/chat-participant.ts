/**
 * chat-participant.ts — P4-1:把 dsh agent 注册为 VS Code 原生 ChatParticipant。
 * 不做双模型:入口是 VS Code Chat 面板,模型与 loop 仍是 dsh 实例的;
 * 会话与事件照旧走 session/event,事件日志仍是权威。
 */
import * as vscode from 'vscode';
import type { AppContext } from './context.js';
import { extractContentText } from '../agent/context.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 提问并把增量文本流式喂给 ChatResponseStream。
 * 实现:controller.ask 后轮询 session-manager 的 append-only 缓冲(事件日志权威),
 * 按 seq 增量取 assistant 文本;turn/end 结束;token 取消 → session.cancel。
 */
async function askAndStream(
  ctx: AppContext,
  sessionId: string,
  text: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<void> {
  const before = ctx.sessions.snapshot(sessionId);
  const startSeq = before.length > 0 ? before[before.length - 1]!.seq : -1;
  let lastSeq = startSeq;
  let acc = '';
  let flushTimer: NodeJS.Timeout | undefined;

  const flush = (): void => {
    if (acc !== '') {
      stream.markdown(acc);
      acc = '';
    }
  };

  const cancelled = token.onCancellationRequested(() => {
    void ctx.controller.stop(sessionId);
  });

  await ctx.controller.ask(sessionId, text);
  flushTimer = setInterval(flush, 400); // 每 400ms 刷一次累积增量(打字机效果)
  try {
    while (!token.isCancellationRequested) {
      const events = ctx.sessions.snapshot(sessionId).filter((e) => e.seq > lastSeq);
      for (const event of events) {
        lastSeq = event.seq;
        if (event.type === 'assistant/message') {
          const t = extractContentText(event.data?.content);
          if (t !== '') {
            flush();
            stream.markdown(t);
          }
        } else if (event.type === 'assistant/chunk') {
          const chunk = event.data?.chunk as { type?: string; text?: string } | undefined;
          if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') acc += chunk.text;
        } else if (event.type === 'turn/end') {
          flush();
          return;
        }
      }
      await sleep(100);
    }
  } finally {
    if (flushTimer) clearInterval(flushTimer);
    cancelled.dispose();
  }
}

export function registerChatParticipant(ctx: AppContext): vscode.Disposable {
  const participant = vscode.chat.createChatParticipant('deepseekHarness.agent', async (request, _context, stream, token) => {
    const text = typeof request.prompt === 'string' ? request.prompt.trim() : '';
    if (text === '') {
      stream.markdown('请在 VS Code Chat 中输入问题(如 "总结本仓库结构")。');
      return;
    }
    try {
      await ctx.runtime.connect();
      let sessionId = ctx.activeSessionId.value;
      if (!sessionId) {
        sessionId = await ctx.sessions.create();
        ctx.activeSessionId.value = sessionId;
      }
      ctx.controller.setActiveSession(sessionId);
      await ctx.sessions.seedHistory(sessionId);
      await askAndStream(ctx, sessionId, text, stream, token);
      stream.markdown(''); // 收尾占位(保持 chat 气泡结束)
    } catch (error) {
      stream.markdown(`**DeepSeek Harness 出错**:${error instanceof Error ? error.message : String(error)}`);
    }
  });
  participant.iconPath = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'deepseek.svg');
  return participant;
}
