import { describe, expect, it } from 'vitest';
import { nonce } from '../src/util/nonce.js';

describe('nonce', () => {
  it('生成 32 位十六进制,两次调用不同', () => {
    const a = nonce();
    const b = nonce();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});
