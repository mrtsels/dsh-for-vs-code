import { describe, expect, it } from 'vitest';
import { validateWebviewRequest } from '../src/webview/bridge.js';

describe('bridge 入参白名单校验', () => {
  it('合法请求通过', () => {
    expect(validateWebviewRequest({ type: 'ready' })).toEqual({ type: 'ready' });
    expect(validateWebviewRequest({ type: 'ask', text: 'hello' })).toEqual({ type: 'ask', text: 'hello' });
    expect(validateWebviewRequest({ type: 'session:open', sessionId: 'session-abc' })).toEqual({
      type: 'session:open',
      sessionId: 'session-abc',
    });
    expect(validateWebviewRequest({ type: 'stop' })).toEqual({ type: 'stop' });
  });

  it('非法载荷显式抛错(不静默放行)', () => {
    expect(() => validateWebviewRequest(null)).toThrow();
    expect(() => validateWebviewRequest('hi')).toThrow();
    expect(() => validateWebviewRequest({ type: 'unknown-type' })).toThrow(/unknown message type/);
    expect(() => validateWebviewRequest({ type: 'ask', text: '' })).toThrow();
    expect(() => validateWebviewRequest({ type: 'ask', text: 42 })).toThrow();
    expect(() => validateWebviewRequest({ type: 'session:open', sessionId: '../etc' })).toThrow();
  });
});
