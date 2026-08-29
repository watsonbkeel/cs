#!/bin/zsh
set -e

cd "$(dirname "$0")"

if [[ ! -f build/web-desktop/index.html ]]; then
  echo "尚未找到桌面 Web 构建。请先在 Cocos Creator 3.8.7 中构建 Web Desktop。"
  read -r "?按回车键关闭..."
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  exec node server/index.mjs
fi

WORKBUDDY_NODE="$HOME/.workbuddy/binaries/node/versions/22.22.2/bin/node"
if [[ -x "$WORKBUDDY_NODE" ]]; then
  exec "$WORKBUDDY_NODE" server/index.mjs
fi

COCOS="/Applications/Cocos/Creator/3.8.7/CocosCreator.app/Contents/MacOS/CocosCreator"
if [[ -x "$COCOS" ]]; then
  export ELECTRON_RUN_AS_NODE=1
  exec "$COCOS" server/index.mjs
fi

echo "没有找到 Node.js。请安装 Node.js 20 或更新版本后重试。"
read -r "?按回车键关闭..."
