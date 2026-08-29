#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_HOST="${DEPLOY_HOST:-175.178.194.44}"
DEPLOY_USER="${DEPLOY_USER:-chenyifan}"
REMOTE_ROOT="${REMOTE_ROOT:-/home/chenyifan/apps/city-front}"
RELEASE="${RELEASE:-$(date +%Y%m%d-%H%M%S)}"
REMOTE_RELEASE="$REMOTE_ROOT/releases/$RELEASE"

cd "$PROJECT_DIR"
test -f build/web-desktop/index.html
grep -q '"CocosEngine":"3.8.7"' build/web-desktop/src/settings.json
grep -R -q 'builtin-standard' build/web-desktop/assets
node --check server/index.mjs

ssh "$DEPLOY_USER@$DEPLOY_HOST" "mkdir -p '$REMOTE_RELEASE' '$REMOTE_ROOT/logs' '$REMOTE_ROOT/shared'"
rsync -az --delete \
  build/web-desktop server deploy ecosystem.config.cjs package.json package-lock.json \
  "$DEPLOY_USER@$DEPLOY_HOST:$REMOTE_RELEASE/"

ssh "$DEPLOY_USER@$DEPLOY_HOST" "set -e; cd '$REMOTE_RELEASE'; npm ci --omit=dev; npm ls ws; ln -sfn '$REMOTE_RELEASE' '$REMOTE_ROOT/current'"

echo "Release uploaded: $REMOTE_RELEASE"
echo "Restart city-front with systemd or PM2, then verify /healthz before changing public traffic."
