#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

PIDS="$(lsof -t -iTCP:3000 -sTCP:LISTEN 2>/dev/null || true)"
if [[ -n "$PIDS" ]]; then
  echo "Stopping existing process on port 3000: $PIDS"
  kill $PIDS || true
  sleep 1
fi

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -f ".nvmrc" && -s "$NVM_DIR/nvm.sh" ]]; then
  unset npm_config_prefix
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
  nvm use >/dev/null
fi

exec npm run dev
