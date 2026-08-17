/**
 * sessions-tree.ts — 原生侧边栏会话列表(会话切换在 VS Code 原生层,webview 只渲染会话区)。
 *
 * 数据源:3080 session.list;点击会话 → postMessage 通知 webview 切换
 * (上游 attachPersistence 契约:boot 桥写 localStorage dsh.sessions.current + 扩展重注入 html)。
 */

import * as vscode from 'vscode';