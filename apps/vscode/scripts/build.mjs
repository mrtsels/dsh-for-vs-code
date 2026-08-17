/**
 * esbuild 构建:
 *   1. src/extension.ts  → dist/extension.js   (extension host, node, ESM, external vscode)
 *   2. web/changes-main.tsx → dist/web/changes.js (改动审查面板 webview)
 *   3. web/session-view-main.tsx → dist/web/session-view.js (会话管理页 webview,
 *      由 build-web-shell.mjs 拷入 dsh-shell 并注入 index.html)
 *   4. web/dsh-attachment-ui.ts → dist/web/dsh-attachment-ui.js (附着 UI,Phase 10,
 *      由 build-web-shell.mjs 拷入 dsh-shell 并注入 index.html)
 * 主 UI = dist/web/dsh-shell(上游源码构建产物,由 build-web-shell.mjs 装配)。
 * --watch 开发模式。
 */
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const extension = {
  entryPoints: [resolve(app, 'src/extension.ts')],
  outfile: resolve(app, 'dist/extension.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external: ['vscode'],
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const sessionView = {
  entryPoints: [resolve(app, 'web/session-view-main.tsx')],
  outfile: resolve(app, 'dist/web/session-view.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  jsx: 'automatic',
  sourcemap: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const attachmentUi = {
  entryPoints: [resolve(app, 'web/dsh-attachment-ui.ts')],
  outfile: resolve(app, 'dist/web/dsh-attachment-ui.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  sourcemap: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const changes = {
  entryPoints: [resolve(app, 'web/changes-main.tsx')],
  outfile: resolve(app, 'dist/web/changes.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  jsx: 'automatic',
  sourcemap: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
};

const htmlSkeleton = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-__NONCE__'; img-src 'self' data:" />
  <title>DeepSeek Harness</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="__NONCE__" src="./index.js"></script>
</body>
</html>
`;

const changesSkeleton = htmlSkeleton.replace('./index.js', './changes.js').replace('<title>DeepSeek Harness</title>', '<title>DeepSeek Harness — 改动审查</title>');

async function main() {
  mkdirSync(resolve(app, 'dist/web'), { recursive: true });
  writeFileSync(resolve(app, 'dist/web/changes.html'), changesSkeleton);
  if (watch) {
    for (const options of [extension, changes, sessionView, attachmentUi]) {
      const ctx = await buildContext(options);
      await ctx.watch();
    }
    console.log('[watch] watching… (Ctrl+C 退出)');
  } else {
    await Promise.all([build(extension), build(changes), build(sessionView), build(attachmentUi)]);
    console.log('dist/extension.js + dist/web/changes.js + dist/web/session-view.js + dist/web/dsh-attachment-ui.js 构建完成');
  }
}

async function buildContext(options) {
  const { context } = await import('esbuild');
  return context(options);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});