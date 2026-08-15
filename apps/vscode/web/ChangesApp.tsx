/**
 * ChangesApp.tsx — 改动审查面板:文件列表 + diff + 回滚/接受(纯文本渲染,无 HTML 注入)。
 */
import React, { useEffect, useState } from 'react';
import type { ChangeItem, ExtensionMessage } from '../src/webview/bridge.js';

declare function acquireVsCodeApi(): { postMessage(m: unknown): void };

const api = (() => {
  try {
    return acquireVsCodeApi();
  } catch {
    return undefined;
  }
})();

const post = (m: unknown): void => api?.postMessage(m);

export function ChangesApp(): React.JSX.Element {
  const [items, setItems] = useState<ChangeItem[]>([]);
  const [selected, setSelected] = useState<string | undefined>();
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    const handler = (event: MessageEvent): void => {
      const msg = event.data as ExtensionMessage;
      if (msg.type === 'changes') {
        setItems(msg.items);
        setSelected((prev) => (prev === undefined || !msg.items.some((i) => i.path === prev) ? msg.items[0]?.path : prev));
      }
    };
    window.addEventListener('message', handler);
    post({ type: 'changes:list' });
    return () => window.removeEventListener('message', handler);
  }, []);

  const selectedItem = items.find((i) => i.path === selected);

  const rollback = (path: string): void => {
    post({ type: 'changes:rollback', path });
    setMessage(`已请求回滚 ${short(path)}`);
  };
  const accept = (path: string): void => {
    post({ type: 'changes:accept', path });
    setMessage(`已接受改动 ${short(path)}`);
  };

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ width: 280, borderRight: '1px solid var(--vscode-panel-border)', overflow: 'auto', padding: 8 }}>
        <h3 style={{ margin: '4px 0 8px' }}>Agent 改动({items.length})</h3>
        {items.length === 0 && <p style={{ color: 'var(--vscode-descriptionForeground)' }}>暂无改动。让 agent 改文件后,改动会出现在这里。</p>}
        {items.map((item) => (
          <div
            key={item.path}
            onClick={() => setSelected(item.path)}
            style={{
              padding: '6px 8px',
              cursor: 'pointer',
              borderRadius: 4,
              background: selected === item.path ? 'var(--vscode-list-activeSelectionBackground)' : 'transparent',
              color: selected === item.path ? 'var(--vscode-list-activeSelectionForeground)' : 'inherit',
            }}
          >
            {short(item.path)}
            <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)' }}>{new Date(item.at).toLocaleTimeString()}</div>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {message && <div style={{ color: 'var(--vscode-testing-iconPassed)', marginBottom: 8 }}>{message}</div>}
        {selectedItem === undefined ? (
          <p style={{ color: 'var(--vscode-descriptionForeground)' }}>选择左侧文件查看 diff</p>
        ) : (
          <>
            <h3 style={{ margin: '0 0 8px' }}>{selectedItem.path}</h3>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button onClick={() => rollback(selectedItem.path)}>↩ 回滚</button>
              <button onClick={() => accept(selectedItem.path)}>✓ 接受</button>
            </div>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: 'var(--vscode-editor-background)', padding: 8, borderRadius: 4 }}>{selectedItem.diff}</pre>
          </>
        )}
      </div>
    </div>
  );
}

function short(p: string): string {
  const parts = p.split('/');
  return parts.slice(-2).join('/');
}
