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
  /** 首开会话:webview 装载时 boot 桥在 localStorage 无 dsh.sessions.current 时写入(Phase 9) */
  bootSession?: { sessionId: string } | undefined;
  /** 宿主类型:侧边栏视图(sideBar 底色)或编辑器面板(editor 底色);shell.css 按此选主题变量 */
  host?: 'sidebar' | 'panel' | undefined;
}

/** 装配完整 webview HTML:head 内插 CSP/base;body 开标签后插 __DSH_WEB_URL__/__DSH_BOOT_SESSION__/__DSH_HOST__ + boot。 */
export function assembleShellHtml(input: ShellHtmlInput): string {
  const { shellHtml, bootJs, csp, nonce, baseHref, proxyBase, proxyWs, bootSession, host } = input;
  // boot 内容防 </script> 提前闭合(内容为本地受信 JSON,防御性转义)
  const safeBoot = bootJs.replace(/<\/script>/gi, '<\\/script>');
  const cspMeta =
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src 'nonce-${nonce}' 'unsafe-eval' ${csp}; img-src ${csp} data: blob:; font-src ${csp} data:; connect-src http://127.0.0.1:3080 ws://127.0.0.1:3080 ${proxyBase} ${proxyWs}; worker-src ${csp} blob:;" />`;
  const headBlock = `${baseHref !== '' ? `<base href="${baseHref}" />` : ''}${cspMeta}`;
  // boot 前注入运行时变量:代理地址(连接目标)、首开会话(boot 桥写入 localStorage)、
  // 宿主类型(shell.css 主题变量切换);均为纯数据脚本,不含业务逻辑
  const bootSessionBlock = bootSession === undefined
    ? ''
    : `<script nonce="${nonce}">window.__DSH_BOOT_SESSION__ = ${JSON.stringify(bootSession)};</script>`;
  const hostBlock = host === undefined
    ? ''
    : `<script nonce="${nonce}">window.__DSH_HOST__ = '${host}';</script>`;
  const bodyBlock =
    `<script nonce="${nonce}">window.__DSH_WEB_URL__ = '${proxyBase}';</script>`
    + hostBlock
    + bootSessionBlock
    + `<script nonce="${nonce}">${safeBoot}</script>`;
  let out = shellHtml;
  // head 注入;无 head 时前置(同上游 injectBootManifest 的兜底语义)
  if (/<head>/i.test(out)) out = out.replace(/<head>/i, `<head>${headBlock}`);
  else out = `<head>${headBlock}</head>${out}`;
  // body 开标签后注入;无 body 时挂在 </html> 前
  if (/<body[^>]*>/i.test(out)) out = out.replace(/<body[^>]*>/i, (m) => `${m}${bodyBlock}`);
  else out = out.replace(/<\/html>/i, `${bodyBlock}</html>`);
  return out;
}