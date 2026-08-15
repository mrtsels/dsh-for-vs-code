/**
 * ChatView.tsx — 聊天渲染:只消费 display 派生结果(eventsToDisplay)。
 * markdown 用 react-markdown(默认转义 HTML,白名单组件);禁 dangerouslySetInnerHTML。
 */
import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { eventsToDisplay, type DisplayItem } from './display.js';
import { ToolCallCard } from './ToolCallCard.js';
import type { SessionEvent } from '../src/agent/wire.js';

interface Props {
  events: SessionEvent[];
}

function MessageBubble({ item }: { item: Extract<DisplayItem, { kind: 'user' | 'assistant' | 'assistant-streaming' }> }): React.JSX.Element {
  const isUser = item.kind === 'user';
  const text = 'text' in item ? item.text : '';
  const reasoning = 'reasoning' in item && item.reasoning !== '' ? item.reasoning : undefined;
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        margin: '6px 0',
      }}
    >
      <div
        style={{
          maxWidth: '85%',
          padding: '8px 10px',
          borderRadius: 10,
          background: isUser
            ? 'var(--vscode-button-background)'
            : 'var(--vscode-editorWidget-background, #2d2d30)',
          color: 'var(--vscode-foreground)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontSize: 13,
        }}
      >
        {reasoning !== undefined && (
          <details style={{ opacity: 0.7, fontSize: 12 }}>
            <summary>推理({reasoning.length} 字符)</summary>
            <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{reasoning}</pre>
          </details>
        )}
        {isUser ? (
          text
        ) : (
          <ReactMarkdown
            components={{
              a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
              img: () => <span>[图片]</span>,
            }}
          >
            {text}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
}

export function ChatView({ events }: Props): React.JSX.Element {
  const items = useMemo(() => eventsToDisplay(events), [events]);
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '4px 12px' }}>
      {items.length === 0 && <p style={{ opacity: 0.6 }}>选择或新建一个会话,开始提问。</p>}
      {items.map((item, index) => {
        switch (item.kind) {
          case 'user':
          case 'assistant':
          case 'assistant-streaming':
            return <MessageBubble key={index} item={item} />;
          case 'tool-call':
            return <ToolCallCard key={index} kind="call" tool={item.tool} argsText={item.argsText} />;
          case 'tool-result':
            return <ToolCallCard key={index} kind="result" tool={item.tool} argsText="" resultText={item.resultText} />;
          case 'turn-sep':
            return <hr key={index} style={{ opacity: 0.25, margin: '10px 0' }} />;
          case 'error':
            return <p key={index} style={{ color: 'var(--vscode-errorForeground)' }}>⚠ {item.message}</p>;
          default:
            return null;
        }
      })}
    </div>
  );
}
