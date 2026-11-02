#!/bin/bash
# Start Showwriter Studio: FastAPI backend + Vite/React frontend.
set -e

cd "$(dirname "$0")"

export APP_PORT="${APP_PORT:-3001}"
export BACKEND_PORT="$((APP_PORT + 100))"

if [ -f /usr/local/lib/workshop-devguard.sh ]; then
    source /usr/local/lib/workshop-devguard.sh
    devguard_acquire "$APP_PORT" "$BACKEND_PORT"
fi

# Backend
(
  cd backend
  uv sync --quiet
  UV_ENV_ARGS=()
  if [ -f ../.env ]; then UV_ENV_ARGS=(--env-file ../.env); fi
  uv run "${UV_ENV_ARGS[@]}" uvicorn main:app --host 127.0.0.1 --port "$BACKEND_PORT" --reload
) &
BACKEND_PID=$!

# Frontend
(
  cd frontend
  if [ ! -d node_modules ]; then npm install; fi
  npm run dev -- --strictPort
) &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT
wait
