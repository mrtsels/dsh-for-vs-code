/** CSP nonce:每次面板加载生成一次,注入 index.html 的 __NONCE__ 占位。 */
export function nonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
