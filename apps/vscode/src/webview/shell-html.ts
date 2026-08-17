/**
 * shell-html.ts — webview HTML 装配(纯函数,可单测)。
 *
 * 输入:dsh-shell 构建产物(index.html/boot.js 内容)+ 运行时变量(CSP 源/nonce/
 * base href/代理地址);输出:注入 CSP、base、__DSH_WEB_URL__ 与 boot 的完整 HTML。
 * 由 chat-panel.ts 调用(文件读取在调用方);与上游 injectBootManifest 同构:
 * boot 脚本先于模块脚本执行。
 */

export interface ShellHtmlInput {
  /** dist/web/dsh-shell/index.html(构建产物,相对路径引用) */
  shellHtml: string;
  /** dist/web/dsh-shell/boot.js 内容(window.__DSH_BOOT__ = ...) */
  bootJs: string;
  /** webview.cspSource(vscode-webview:// 源) */
  csp: string;
  /** 每次装配新生成的 CSP nonce */
  nonce: string;
  /** asWebviewUri(shell 目录) + '/' — 相对资源解析锚点 */
  baseHref: string;
  /** 扩展侧代理地址(webview runtime 的连接目标,Origin 栅栏绕行) */
  proxyBase: string;
  /** proxyBase 的 ws:// 形式 */
  proxyWs: string;
}

/** 装配完整 webview HTML:head 内插 CSP/base;body 开标签后插 __DSH_WEB_URL__ + boot。 */
export function assembleShellHtml(input: ShellHtmlInput): string {
  const { shellHtml, bootJs, csp, nonce, baseHref, proxyBase, proxyWs } = input;
  // boot 内容防 </script> 提前闭合(内容为本地受信 JSON,防御性转义)
  const safeBoot = bootJs.replace(/<\/script>/gi, '<\\/script>');
  const cspMeta =
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src 'nonce-${nonce}' 'unsafe-eval' ${csp}; img-src ${csp} data: blob:; font-src ${csp} data:; connect-src http://127.0.0.1:3080 ws://127.0.0.1:3080 ${proxyBase} ${proxyWs}; worker-src ${csp} blob:;" />`;
  const headBlock = `${baseHref !== '' ? `<base href="${baseHref}" />` : ''}${cspMeta}`;
  const bodyBlock =
    `<script nonce="${nonce}">window.__DSH_WEB_URL__ = '${proxyBase}';</script>`
    + `<script nonce="${nonce}">${safeBoot}</script>`;
  let out = shellHtml;
  // head 注入;无 head 时前置(同上游 injectBootManifest 的兜底语义)
  if (/<head>/i.test(out)) out = out.replace(/<head>/i, `<head>${headBlock}`);
  else out = `<head>${headBlock}</head>${out}`;
  // body 开标签后注入;无 body 时挂在 </html> 前
  if (/<body[^>]*>/i.test(out)) out = out.replace(/<body[^>]*>/i, (m) => `${m}${bodyBlock}`);
  else out = out.replace(/<\/html>/i, `${bodyBlock}<\/html>`);
  return out;
}