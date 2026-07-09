#!/usr/bin/env bash
# PM2 生产启动脚本 — 直接 exec 已构建的 venv, 不在每次重启时 uv sync。
#
# 一次性依赖安装 (部署/升级时手动执行, 不要放进 PM2):
#   cd /data/tickflow-stock-panel/backend && uv sync --no-dev
#   # 老 CPU:  uv sync --no-dev --extra legacy-cpu
#   # 回测:    uv sync --no-dev --extra backtest
#
# 前端构建 (FastAPI 托管 frontend/dist):
#   cd /data/tickflow-stock-panel/frontend && pnpm install && pnpm build
#
# 端口: 生产只监听 PORT (默认 7300)。9200 是 dev.sh 的 Vite 开发端口, PM2 不会启动。
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT/backend"
UVICORN="$BACKEND_DIR/.venv/bin/uvicorn"

if [ ! -x "$UVICORN" ]; then
  echo "[start-pm2] ERROR: $UVICORN not found or not executable." >&2
  echo "[start-pm2] Run once on the server:" >&2
  echo "  cd $BACKEND_DIR && uv sync --no-dev" >&2
  exit 1
fi

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-7300}"

cd "$BACKEND_DIR"
exec "$UVICORN" app.main:app --host "$HOST" --port "$PORT"
