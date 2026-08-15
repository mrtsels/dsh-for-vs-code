/**
 * SessionList.tsx — 会话列表(显示/切换/fork,P3-5)。
 */
import React from 'react';
import type { SessionSummary } from '../src/agent/wire.js';

interface Props {
  items: SessionSummary[];
  activeSessionId?: string;
  onOpen: (sessionId: string) => void;
  onCreate: () => void;
  onFork: (sessionId: string) => void;
}

export function SessionList({ items, activeSessionId, onOpen, onCreate, onFork }: Props): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: 8, fontSize: 12 }}>
      <button type="button" onClick={onCreate} style={{ marginBottom: 4 }}>
        + 新会话
      </button>
      {items
        .filter((s) => !s.blank)
        .map((s) => {
          const title = s.projections?.values?.title ?? s.sessionId.slice(0, 8);
          return (
            <div key={s.sessionId} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                type="button"
                onClick={() => onOpen(s.sessionId)}
                title={s.sessionId}
                style={{
                  flex: 1,
                  textAlign: 'left',
                  padding: '4px 6px',
                  borderRadius: 4,
                  background: s.sessionId === activeSessionId ? 'var(--vscode-list-activeSelectionBackground)' : 'none',
                  color: 'var(--vscode-foreground)',
                  border: 'none',
                  cursor: 'pointer',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {s.running ? '● ' : ''}
                {title}
              </button>
              <button
                type="button"
                title={s.running ? 'fork 需要会话空闲(至少一个已完成回合)' : 'fork 此会话'}
                onClick={() => onFork(s.sessionId)}
                disabled={s.running}
                style={{ padding: '2px 6px', opacity: s.running ? 0.3 : 0.7 }}
              >
                ⧉
              </button>
            </div>
          );
        })}
    </div>
  );
}
