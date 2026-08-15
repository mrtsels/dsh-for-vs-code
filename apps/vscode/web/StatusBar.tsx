/**
 * StatusBar.tsx — 连接状态 + 实例信息 + 诊断徽标(P1-15 cwd 不一致警告,P2-3)。
 */
import React from 'react';

interface Props {
  state: 'idle' | 'running' | 'error' | 'disconnected';
  host?: { cwd: string; model: string };
  diagnostics?: { errors: number; warnings: number };
}

const stateLabel: Record<Props['state'], string> = {
  idle: '就绪',
  running: '运行中…',
  error: '错误',
  disconnected: '未连接',
};

export function StatusBar({ state, host, diagnostics }: Props): React.JSX.Element {
  const color =
    state === 'running'
      ? 'var(--vscode-charts-yellow, #cca700)'
      : state === 'disconnected' || state === 'error'
        ? 'var(--vscode-errorForeground, #f48771)'
        : 'var(--vscode-descriptionForeground)';
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '4px 12px', borderBottom: '1px solid var(--vscode-editorWidget-border, #555)', fontSize: 12, color }}>
      <span>◉ {stateLabel[state]}</span>
      {host && (
        <span style={{ color: 'var(--vscode-descriptionForeground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {host.model} @ {host.cwd}
        </span>
      )}
      {diagnostics !== undefined && (diagnostics.errors > 0 || diagnostics.warnings > 0) && (
        <span title="工作区诊断">
          {diagnostics.errors > 0 && <span style={{ color: 'var(--vscode-errorForeground)' }}>✕{diagnostics.errors}</span>}
          {diagnostics.warnings > 0 && <span style={{ color: 'var(--vscode-charts-yellow, #cca700)' }}> ⚠{diagnostics.warnings}</span>}
        </span>
      )}
    </div>
  );
}
