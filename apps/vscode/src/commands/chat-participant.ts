/**
 * chat-participant.ts — P4-1:把 dsh agent 注册为 VS Code 原生 ChatParticipant。
 * 不做双模型:入口是 VS Code Chat 面板,模型与 loop 仍是 dsh 实例的;
 * 会话与事件照旧走 session/event,事件日志仍是权威。
 */
import * as vscode from 'vscode';
import type { AppContext } from './context.js';
import { createChatStreamState, stepChatStream } from './chat-stream.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 提问并把增量文本流式喂给 ChatResponseStream。
 * 实现:controller.ask 后轮询 session-manager 的 append-only 缓冲(事件日志权威),
 * 由 stepChatStream 按 seq 水印增量消费(去重/消息-块去重/结束判定见 chat-stream.ts);
 * token 取消 → session.cancel;运行时断连(事件不可能再到达)→ 显式收尾,不空转。
 */
async function askAndStream(
  ctx: AppContext,
  sessionId: string,
  text: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<void> {
  const before = ctx.sessions.snapshot(sessionId);
  const state = createChatStreamState(before.length > 0 ? before[before.length - 1]!.seq : -1);
  let flushTimer: NodeJS.Timeout | undefined;

  const flush = (): void => {
    if (state.acc !== '') {
      stream.markdown(state.acc);
      state.acc = '';
    }
  };

  const cancelled = token.onCancellationRequested(() => {
    // 取消 → 取消服务端 turn;stop 失败只记日志(吞掉,不打断取消流程)
    void ctx.controller.stop(sessionId).catch((error) => {
      ctx.logger.warn(`chat participant stop 失败:${error instanceof Error ? error.message : String(error)}`);
    });
  });

  await ctx.controller.ask(sessionId, text);
  flushTimer = setInterval(flush, 400); // 每 400ms 刷一次累积增量(打字机效果)
  try {
    while (!token.isCancellationRequested) {
      // 断连/切换实例后事件不会再到达,继续轮询只会空转 → flush 已累积文本并显式告知(网络失败对 UI 可见)
      if (ctx.runtime.currentState !== 'connected') {
        flush();
        stream.markdown('*(与 dsh 实例的连接中断,本轮未完成;重新连接后可再次提问)*');
        return;
      }
      const actions = stepChatStream(state, ctx.sessions.snapshot(sessionId));
      for (const action of actions) {
        if (action.kind === 'markdown') {
          flush();
          stream.markdown(action.text);
        } else if (action.kind === 'end') {
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
  const participant = vscode.chat.createChatParticipant(
    'deepseekHarness.agent',
    async (request, _context, stream, token): Promise<vscode.ChatResult> => {
      const text = typeof request.prompt === 'string' ? request.prompt.trim() : '';
      const forceNew = request.command === 'new';
      if (text === '' && !forceNew) {
        stream.markdown('请在 VS Code Chat 中输入问题(如 "总结本仓库结构");支持斜杠命令 /new 新建会话。');
        return {};
      }
      try {
        await ctx.runtime.connect();
        let sessionId = ctx.activeSessionId.value;
        if (!sessionId || forceNew) {
          // 新建会话用 VS Code 工作区目录(工作区自动关联,对齐 newSession 命令)
          const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          sessionId = await ctx.sessions.create(wsPath);
          ctx.activeSessionId.value = sessionId;
          if (forceNew) {
            stream.markdown(`*(已新建会话,工作区:${wsPath ?? '实例默认 cwd'})*`);
          }
        }
        ctx.controller.setActiveSession(sessionId);
        await ctx.sessions.seedHistory(sessionId);
        if (text !== '') {
          await askAndStream(ctx, sessionId, text, stream, token);
          stream.markdown(''); // 收尾占位(保持 chat 气泡结束)
        }
        return { metadata: { command: request.command } };
      } catch (error) {
        stream.markdown(`**DeepSeek Harness 出错**:${error instanceof Error ? error.message : String(error)}`);
        return {};
      }
    },
  );
  participant.iconPath = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'deepseek.svg');
  // followup 建议(官方 chat-sample 模式):一轮结束后提供继续/新建会话
  participant.followupProvider = {
    provideFollowups(_result, _context, _token): vscode.ChatFollowup[] {
      return [
        { prompt: '继续', label: '继续当前任务' },
        { prompt: '', command: 'new', label: '新建会话(当前工作区)' },
      ];
    },
  };
  return participant;
}
