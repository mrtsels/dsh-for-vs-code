/**
 * App.tsx — 布局与状态:会话列表 + 聊天区 + 输入;事件 append-only 累积,渲染只吃 event。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { onMessage, post } from './bridge-client.js';
import { ChatView } from './ChatView.js';
import { SessionList } from './SessionList.js';
import { StatusBar } from './StatusBar.js';
import type { ConnectionState, ExtensionMessage } from '../src/webview/bridge.js';
import type { SessionEvent, SessionSummary } from '../src/agent/wire.js';

export function App(): React.JSX.Element {
  const [connState, setConnState] = useState<ConnectionState>('disconnected');
  const [host, setHost] = useState<{ cwd: string; model: string } | undefined>();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [eventsBySession, setEventsBySession] = useState<Record<string, SessionEvent[]>>({});
  const [input, setInput] = useState('');
  const [banner, setBanner] = useState<string | undefined>();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const unsubscribe = onMessage((message: ExtensionMessage) => {
      switch (message.type) {
        case 'state':
          setConnState(message.state);
          setHost(message.host);
          break;
        case 'session:list':
          setSessions(message.items);
          break;
        case 'event':
          setEventsBySession((prev) => {
            const existing = prev[message.sessionId] ?? [];
            if (message.events.length === 1 && existing.length > 0) {
              const last = existing[existing.length - 1];
              const incoming = message.events[0];
              if (last !== undefined && incoming !== undefined && last.seq === incoming.seq) return prev; // 去重:同 seq 不重复追加
            }
            return { ...prev, [message.sessionId]: [...existing, ...message.events] };
          });
          break;
        case 'error':
          setBanner(message.message);
          break;
      }
    });
    post({ type: 'ready' });
    return unsubscribe;
  }, []);

  const running = connState === 'running';

  const send = useCallback(() => {
    const text = input.trim();
    if (text === '') return;
    setBanner(undefined);
    setInput('');
    post({ type: 'ask', text });
  }, [input]);

  const openSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    setBanner(undefined);
    post({ type: 'session:open', sessionId });
  }, []);

  const createSession = useCallback(() => {
    setBanner(undefined);
    post({ type: 'session:create' });
  }, []);

  const events = activeSessionId !== undefined ? (eventsBySession[activeSessionId] ?? []) : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <StatusBar state={connState} host={host} />
      {banner && (
        <div style={{ padding: '4px 12px', background: 'var(--vscode-inputValidation-errorBackground)', color: 'var(--vscode-errorForeground)', fontSize: 12 }}>
          ⚠ {banner}
        </div>
      )}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ width: 200, borderRight: '1px solid var(--vscode-editorWidget-border, #555)', overflowY: 'auto' }}>
          <SessionList items={sessions} activeSessionId={activeSessionId} onOpen={openSession} onCreate={createSession} />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <ChatView events={events} />
          <div style={{ display: 'flex', gap: 6, padding: 8, borderTop: '1px solid var(--vscode-editorWidget-border, #555)' }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !running) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={running ? 'agent 运行中…' : '输入问题(Enter 发送,Shift+Enter 换行)'}
              rows={2}
              style={{ flex: 1, resize: 'none', fontFamily: 'inherit' }}
            />
            {running ? (
              <button type="button" onClick={() => post({ type: 'stop' })}>
                停止
              </button>
            ) : (
              <button type="button" onClick={send} disabled={input.trim() === ''}>
                发送
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
