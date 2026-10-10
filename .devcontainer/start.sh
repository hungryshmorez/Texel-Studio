#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
studio_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
studio_runtime="$studio_root/.devcontainer/.runtime"
mkdir -p "$studio_runtime"

# The lock prevents duplicate servers when the Codespace is reopened.
# nohup lets the app outlive this short Codespaces lifecycle command.
nohup flock --nonblock "$studio_runtime/launch.lock" \
  bash "$studio_root/start.sh" \
  </dev/null >>"$studio_runtime/studio.log" 2>&1 &
printf 'Texel Studio is starting. Open port 3001 in the Ports tab.\n'
printf 'Startup log: %s/studio.log\n' "$studio_runtime"
