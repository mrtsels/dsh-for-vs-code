/**
 * ToolCallCard.tsx — 工具调用卡片(名称 + 参数,可折叠),无 HTML 注入。
 */
import React, { useState } from 'react';

interface Props {
  tool: string;
  argsText: string;
  resultText?: string;
  kind: 'call' | 'result';
}

export function ToolCallCard({ tool, argsText, resultText, kind }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const label = kind === 'call' ? `⚙ ${tool}` : `✓ ${tool} 结果`;
  return (
    <div
      style={{
        margin: '4px 0',
        border: '1px solid var(--vscode-editorWidget-border, #555)',
        borderRadius: 6,
        background: 'var(--vscode-editorWidget-background, transparent)',
        fontSize: 12,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          textAlign: 'left',
          border: 'none',
          background: 'none',
          color: 'var(--vscode-foreground)',
          padding: '4px 8px',
          cursor: 'pointer',
        }}
      >
        {label}
      </button>
      {open && (
        <pre style={{ margin: 0, padding: '4px 8px', whiteSpace: 'pre-wrap', overflowX: 'auto' }}>
          {resultText !== undefined ? resultText : argsText}
        </pre>
      )}
    </div>
  );
}
