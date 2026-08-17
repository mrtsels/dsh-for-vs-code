/**
 * session-view-main.tsx — 会话管理页入口:挂载到 #dsh-sessions-root(bridge 控制显隐)。
 * 与 changes-main 同构:独立 React root,与上游 #root 应用并存(互不干扰)。
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { SessionManagementView } from './SessionView.js';

const rootEl = document.getElementById('dsh-sessions-root');
if (rootEl) createRoot(rootEl).render(<SessionManagementView />);
