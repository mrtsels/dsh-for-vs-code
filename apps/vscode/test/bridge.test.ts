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

describe('Phase 10 附着消息白名单校验', () => {
  it('合法:ready / add / remove / toggle', () => {
    expect(validateWebviewRequest({ type: 'dsh:attachments:ready' })).toEqual({ type: 'dsh:attachments:ready' });
    expect(
      validateWebviewRequest({ type: 'dsh:attachments:add', attachments: [{ uri: 'file:///a.ts' }, { uri: 'file:///b.ts' }] }),
    ).toEqual({ type: 'dsh:attachments:add', attachments: [{ uri: 'file:///a.ts' }, { uri: 'file:///b.ts' }] });
    expect(validateWebviewRequest({ type: 'dsh:attachments:remove', attachmentId: 'abc-123' })).toEqual({
      type: 'dsh:attachments:remove',
      attachmentId: 'abc-123',
    });
    expect(validateWebviewRequest({ type: 'dsh:attachments:toggle', kind: 'activeFile', enabled: true })).toEqual({
      type: 'dsh:attachments:toggle',
      kind: 'activeFile',
      enabled: true,
    });
    expect(validateWebviewRequest({ type: 'dsh:attachments:toggle', kind: 'selection', enabled: false })).toEqual({
      type: 'dsh:attachments:toggle',
      kind: 'selection',
      enabled: false,
    });
  });

  it('非法载荷显式抛错', () => {
    // add
    expect(() => validateWebviewRequest({ type: 'dsh:attachments:add', attachments: [] })).toThrow();
    expect(() => validateWebviewRequest({ type: 'dsh:attachments:add', attachments: 'x' })).toThrow();
    expect(() => validateWebviewRequest({ type: 'dsh:attachments:add' })).toThrow();
    expect(() => validateWebviewRequest({ type: 'dsh:attachments:add', attachments: [{ uri: '' }] })).toThrow();
    expect(() => validateWebviewRequest({ type: 'dsh:attachments:add', attachments: [{ uri: 42 }] })).toThrow();
    expect(() => validateWebviewRequest({ type: 'dsh:attachments:add', attachments: [{ noUri: 'x' }] })).toThrow();
    expect(() => validateWebviewRequest({ type: 'dsh:attachments:add', attachments: [{ uri: 'x'.repeat(9000) }] })).toThrow();
    expect(() =>
      validateWebviewRequest({
        type: 'dsh:attachments:add',
        attachments: Array.from({ length: 17 }, () => ({ uri: 'file:///a.ts' })),
      }),
    ).toThrow();
    // remove
    expect(() => validateWebviewRequest({ type: 'dsh:attachments:remove', attachmentId: '' })).toThrow();
    expect(() => validateWebviewRequest({ type: 'dsh:attachments:remove', attachmentId: 7 })).toThrow();
    // toggle
    expect(() => validateWebviewRequest({ type: 'dsh:attachments:toggle', kind: 'other', enabled: true })).toThrow();
    expect(() => validateWebviewRequest({ type: 'dsh:attachments:toggle', kind: 'activeFile', enabled: 'yes' })).toThrow();
    expect(() => validateWebviewRequest({ type: 'dsh:attachments:toggle' })).toThrow();
  });
});
