/**
 * StatusBar.tsx — 连接状态 + 实例信息(含 cwd 不一致警告,P1-15)。
 */
import React from 'react';

interface Props {
  state: 'idle' | 'running' | 'error' | 'disconnected';
  host?: { cwd: string; model: string };
}

const LABEL: Record<Props['state'], string> = {
  idle: '就绪',
  running: '运行中',
  error: '错误',
  disconnected: '未连接',
};

export function StatusBar({ state, host }: Props): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        padding: '4px 12px',
        borderBottom: '1px solid var(--vscode-editorWidget-border, #555)',
        fontSize: 12,
        opacity: 0.9,
      }}
    >
      <span>
        dsh: <strong>{LABEL[state]}</strong>
      </span>
      {host && (
        <span style={{ opacity: 0.75 }}>
          {host.model} · cwd {host.cwd}
        </span>
      )}
    </div>
  );
}
