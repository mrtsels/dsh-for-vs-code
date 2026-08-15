/**
 * SessionList.tsx — 会话列表(仅显示,点击切换)。
 */
import React from 'react';
import type { SessionSummary } from '../src/agent/wire.js';

interface Props {
  items: SessionSummary[];
  activeSessionId?: string;
  onOpen: (sessionId: string) => void;
  onCreate: () => void;
}

export function SessionList({ items, activeSessionId, onOpen, onCreate }: Props): React.JSX.Element {
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
            <button
              key={s.sessionId}
              type="button"
              onClick={() => onOpen(s.sessionId)}
              style={{
                textAlign: 'left',
                padding: '4px 6px',
                borderRadius: 4,
                background: s.sessionId === activeSessionId ? 'var(--vscode-list-activeSelectionBackground)' : 'none',
                color: 'var(--vscode-foreground)',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {s.running ? '● ' : ''}
              {title}
            </button>
          );
        })}
    </div>
  );
}
