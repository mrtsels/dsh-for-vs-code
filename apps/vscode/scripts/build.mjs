/**
 * esbuild 双入口构建:
 *   1. src/extension.ts  → dist/extension.js   (extension host, node, ESM, external vscode)
 *   2. web/main.tsx      → dist/web/index.js   (webview, browser, iife, react 打包进 bundle)
 * 并生成 dist/web/index.html 骨架(CSP 由 panel 运行时注入 nonce)。
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
const webview = {
  entryPoints: [resolve(app, 'web/main.tsx')],
  outfile: resolve(app, 'dist/web/index.js'),
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

async function main() {
  mkdirSync(resolve(app, 'dist/web'), { recursive: true });
  writeFileSync(resolve(app, 'dist/web/index.html'), htmlSkeleton);
  if (watch) {
    for (const options of [extension, webview]) {
      const ctx = await buildContext(options);
      await ctx.watch();
    }
    console.log('[watch] watching… (Ctrl+C 退出)');
  } else {
    await Promise.all([build(extension), build(webview)]);
    console.log('dist/extension.js + dist/web/index.js 构建完成');
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
