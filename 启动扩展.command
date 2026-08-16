#!/bin/bash
# 启动 dsh-for-vs-code 扩展宿主窗口(双击运行)
# 流程:构建 → 同步上游 shell 产物 → 启动扩展宿主
set -e
cd "$(dirname "$0")"
echo "== 1/3 构建扩展 =="
pnpm build
echo "== 2/3 同步上游 shell 产物(3080) =="
node apps/vscode/scripts/fetch-dsh-ui.mjs 2>/dev/null | tail -1 || echo "(3080 未运行,跳过产物同步)"
echo "== 3/3 启动扩展宿主 =="
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" -n \
  --extensionDevelopmentPath="$PWD/apps/vscode" "$PWD"
echo "完成。点左侧活动栏 DeepSeek 图标查看。"
