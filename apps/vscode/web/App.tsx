/**
 * App.tsx — 布局与状态:会话列表 + 聊天区 + 输入;事件 append-only 累积,渲染只吃 event。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { onMessage, post } from './bridge-client.js';
import { ChatView } from './ChatView.js';
import { SessionList } from './SessionList.js';
import { StatusBar } from './StatusBar.js';
import { InsightsTabs } from './InsightsTabs.js';
import type { ConnectionState, ExtensionMessage } from '../src/webview/bridge.js';
import type { GoalView, JobView, SessionEvent, SessionSummary, SkillEntry, SubagentEntry } from '../src/agent/wire.js';

export function App(): React.JSX.Element {
  const [connState, setConnState] = useState<ConnectionState>('disconnected');
  const [host, setHost] = useState<{ cwd: string; model: string } | undefined>();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [eventsBySession, setEventsBySession] = useState<Record<string, SessionEvent[]>>({});
  const [input, setInput] = useState('');
  const [banner, setBanner] = useState<string | undefined>();
  const [termOpen, setTermOpen] = useState(false);
  const [termInput, setTermInput] = useState('');
  const [termOutput, setTermOutput] = useState<string[]>([]);
  const [diagCount, setDiagCount] = useState<{ errors: number; warnings: number }>({ errors: 0, warnings: 0 });
  const [view, setView] = useState<'chat' | 'insights'>('chat');
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [subagents, setSubagents] = useState<SubagentEntry[]>([]);
  const [goal, setGoal] = useState<GoalView | undefined>();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pendingAsk = useRef(false); // P2-6:in-flight 防重(事件到达即解锁)

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
            // P1-2:seq 单调去重 — seedHistory 全量 + 实时增量可能重复推送,跳过 seq <= 尾部者
            const lastSeq = existing.length > 0 ? (existing[existing.length - 1]?.seq ?? -1) : -1;
            const fresh = message.events.filter((e) => e.seq > lastSeq);
            if (fresh.length === 0) return prev;
            return { ...prev, [message.sessionId]: [...existing, ...fresh] };
          });
          // 任何事件到达都解除 in-flight 锁(P2-6:防重复发送)
          pendingAsk.current = false;
          break;
        case 'error':
          setBanner(message.message);
          pendingAsk.current = false;
          break;
        case 'terminal:output':
          setTermOutput((prev) => [...prev.slice(-2000), message.text]);
          break;
        case 'diagnostics':
          setDiagCount({ errors: message.errors, warnings: message.warnings });
          break;
        case 'meta:skills':
          setSkills(message.skills);
          break;
        case 'meta:jobs':
          setJobs(message.jobs);
          break;
        case 'meta:subagents':
          setSubagents(message.entries);
          break;
        case 'meta:goals':
          setGoal(message.goal);
          break;
        case 'session:forked':
          openSession(message.sessionId);
          break;
      }
    });
    post({ type: 'ready' });
    return unsubscribe;
  }, []);

  const running = connState === 'running';

  const send = useCallback(() => {
    if (pendingAsk.current) return; // P2-6:上一问未落事件前禁止重发
    const text = input.trim();
    if (text === '') return;
    setBanner(undefined);
    setInput('');
    pendingAsk.current = true;
    post({ type: 'ask', text });
  }, [input]);

  const openSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    setBanner(undefined);
    // P2-G:切换会话先清空 meta 状态,防止旧会话数据残留到新 meta 到达前
    setSkills([]);
    setJobs([]);
    setSubagents([]);
    setGoal(undefined);
    post({ type: 'session:open', sessionId });
  }, []);

  const createSession = useCallback(() => {
    setBanner(undefined);
    post({ type: 'session:create' });
  }, []);

  const forkSession = useCallback((sessionId: string) => {
    setBanner(undefined);
    post({ type: 'session:fork', sessionId });
  }, []);

  const events = activeSessionId !== undefined ? (eventsBySession[activeSessionId] ?? []) : [];

  const runTerminal = useCallback(() => {
    const command = termInput.trim();
    if (command === '') return;
    setTermOutput((prev) => [...prev, `$ ${command}\n`]);
    setTermInput('');
    post({ type: 'terminal:run', command });
  }, [termInput]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <StatusBar state={connState} host={host} diagnostics={diagCount} />
      {banner && (
        <div style={{ padding: '4px 12px', background: 'var(--vscode-inputValidation-errorBackground)', color: 'var(--vscode-errorForeground)', fontSize: 12 }}>
          ⚠ {banner}
        </div>
      )}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ width: 200, borderRight: '1px solid var(--vscode-editorWidget-border, #555)', overflowY: 'auto' }}>
          <SessionList items={sessions} activeSessionId={activeSessionId} onOpen={openSession} onCreate={createSession} onFork={forkSession} />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, padding: '2px 8px', borderBottom: '1px solid var(--vscode-editorWidget-border, #555)', fontSize: 12 }}>
            <button type="button" onClick={() => setView('chat')} style={{ opacity: view === 'chat' ? 1 : 0.6 }}>
              对话
            </button>
            <button type="button" onClick={() => setView('insights')} style={{ opacity: view === 'insights' ? 1 : 0.6 }}>
              洞察
            </button>
          </div>
          {view === 'insights' ? (
            <InsightsTabs sessionId={activeSessionId} skills={skills} jobs={jobs} subagents={subagents} goal={goal} onPost={post} />
          ) : (
            <ChatView events={events} />
          )}
          {termOpen && (
            <div style={{ borderTop: '1px solid var(--vscode-editorWidget-border, #555)', display: 'flex', flexDirection: 'column', maxHeight: '30%' }}>
              <div style={{ display: 'flex', gap: 6, padding: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)' }}>终端(输出可捕获)</span>
                <input
                  value={termInput}
                  onChange={(e) => setTermInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      runTerminal();
                    }
                  }}
                  placeholder="输入命令,如 pnpm test"
                  style={{ flex: 1, fontFamily: 'monospace' }}
                />
                <button type="button" onClick={runTerminal} disabled={termInput.trim() === ''}>
                  运行
                </button>
              </div>
              <pre style={{ margin: 0, overflow: 'auto', fontSize: 11, padding: 6, background: 'var(--vscode-terminal-background, #1e1e1e)', color: 'var(--vscode-terminal-foreground, #ccc)' }}>
                {termOutput.length === 0 ? '(无输出)' : termOutput.join('')}
              </pre>
            </div>
          )}
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
            <button type="button" onClick={() => setTermOpen((v) => !v)} style={{ opacity: 0.7 }}>
              {termOpen ? '收起终端' : '终端'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
