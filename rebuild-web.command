#!/bin/zsh

PROJECT="/Users/nanazhou/Documents/chenyifan"
COCOS="/Applications/Cocos/Creator/3.8.7/CocosCreator.app/Contents/MacOS/CocosCreator"

if [[ ! -x "$COCOS" ]]; then
  echo "没有找到 Cocos Creator 3.8.7。"
  read -r "?按回车键关闭..."
  exit 1
fi

echo "正在使用 Cocos Creator 3.8.7 重新构建 Web Desktop..."
MARKER="$PROJECT/temp/rebuild-web.started"
touch "$MARKER"
"$COCOS" --project "$PROJECT" --build "platform=web-desktop"
BUILD_STATUS=$?

for _ in {1..120}; do
  [[ -f "$PROJECT/build/web-desktop/index.html" && "$PROJECT/build/web-desktop/index.html" -nt "$MARKER" ]] && break
  sleep 0.5
done

if [[ ! -f "$PROJECT/build/web-desktop/index.html" || ! "$PROJECT/build/web-desktop/index.html" -nt "$MARKER" ]]; then
  echo ""
  echo "构建失败：没有生成 build/web-desktop/index.html。请把这个窗口截图发给 Codex。"
  read -r "?按回车键关闭..."
  exit 1
fi

echo ""
echo "构建完成，正在重新启动网页服务..."
for PID in $(lsof -tiTCP:7460 -sTCP:LISTEN 2>/dev/null); do
  kill "$PID" 2>/dev/null || true
done
sleep 1
exec "$PROJECT/start-web.command"
