import { describe, expect, it } from 'vitest';
import { assembleShellHtml } from '../src/webview/shell-html.js';

const INPUT = {
  shellHtml: '<!doctype html>\n<html lang="zh-CN">\n  <head>\n    <meta charset="utf-8" />\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" crossorigin src="./assets/index-abc.js"></script>\n  </body>\n</html>\n',
  bootJs: 'window.__DSH_BOOT__ = {"rev":"r1","entries":[]};\n',
  csp: 'vscode-webview://abc123',
  nonce: 'n0nce1234567890abcdef1234567890ab',
  baseHref: 'vscode-webview://abc123/dsh-shell/',
  proxyBase: 'http://127.0.0.1:45678',
  proxyWs: 'ws://127.0.0.1:45678',
};

describe('assembleShellHtml(Route A webview 装配)', () => {
  it('head 注入 CSP(nonce + 代理 connect-src)与 base href', () => {
    const out = assembleShellHtml(INPUT);
    expect(out).toContain('<base href="vscode-webview://abc123/dsh-shell/" />');
    expect(out).toContain("default-src 'none'");
    expect(out).toContain("script-src 'nonce-n0nce1234567890abcdef1234567890ab' 'unsafe-eval' vscode-webview://abc123");
    expect(out).toContain('connect-src http://127.0.0.1:3080 ws://127.0.0.1:3080 http://127.0.0.1:45678 ws://127.0.0.1:45678');
  });

  it('body 开标签后注入 __DSH_WEB_URL__ 与 boot,且先于模块脚本', () => {
    const out = assembleShellHtml(INPUT);
    const bodyInject = out.indexOf("window.__DSH_WEB_URL__ = 'http://127.0.0.1:45678'");
    const bootAt = out.indexOf('window.__DSH_BOOT__');
    const moduleAt = out.indexOf('src="./assets/index-abc.js"');
    expect(bodyInject).toBeGreaterThan(-1);
    expect(bootAt).toBeGreaterThan(-1);
    expect(moduleAt).toBeGreaterThan(bootAt); // boot 先执行
    expect(out.indexOf('<body>')).toBeLessThan(bodyInject);
  });

  it('boot 内容中的 </script> 被转义,不提前闭合', () => {
    const evil = 'window.__DSH_BOOT__ = {"a":"</script><script>alert(1)"};\n';
    const out = assembleShellHtml({ ...INPUT, bootJs: evil });
    // 转义后不再出现裸闭合标签
    const occurrences = out.split('</script>').length - 1;
    // 输入 html 的模块脚本 1 个 + 注入的 __DSH_WEB_URL__/boot 各 1 个 = 3;恶意串必须已被转义
    expect(occurrences).toBe(3);
    expect(out).toContain('<\\/script>');
  });

  it('无 head 的产物(上游兜底)也能装配', () => {
    const noHead = '<html><body><div id="root"></div></body></html>';
    const out = assembleShellHtml({ ...INPUT, shellHtml: noHead });
    expect(out).toContain("window.__DSH_WEB_URL__");
    expect(out).toContain('Content-Security-Policy');
  });
});