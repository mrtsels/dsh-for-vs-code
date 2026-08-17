#!/bin/bash
# 启动 dsh-for-vs-code 扩展宿主窗口(双击运行)
# 流程:构建 → 装配 dsh-shell(vendor 源码构建产物)→ 启动扩展宿主
set -e
cd "$(dirname "$0")"
VENDOR="vendor/deepseek-harness"
echo "== 1/3 构建扩展 =="
pnpm build
echo "== 2/3 装配 dsh-shell(vendor 源码产物)=="
if [ ! -f "$VENDOR/apps/web/dist/index.html" ] || [ ! -f "$VENDOR/packages/client/connection/lib/client.js" ]; then
  echo "vendor 构建产物缺失,先在 vendor/deepseek-harness 内执行:"
  echo "  corepack pnpm install --ignore-scripts"
  echo "  corepack pnpm run build:lib:host && corepack pnpm run build:lib:client && corepack pnpm run build:web"
  exit 1
fi
node apps/vscode/scripts/build-web-shell.mjs
echo "== 3/3 启动扩展宿主 =="
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" -n   --extensionDevelopmentPath="$PWD/apps/vscode" "$PWD"
echo "完成。点左侧活动栏 DeepSeek 图标查看。"
