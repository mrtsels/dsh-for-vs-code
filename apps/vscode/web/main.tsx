import React from 'react';
import { createRoot } from 'react-dom/client';

function App(): React.JSX.Element {
  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h2>DeepSeek Harness for VS Code</h2>
      <p>Phase 1:连接 dsh web(127.0.0.1:3080)后在此对话。</p>
    </div>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) createRoot(rootEl).render(<App />);
