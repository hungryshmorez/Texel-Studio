#!/usr/bin/env bash
# Best-effort tooling install: a failing third-party apt source must not abort container creation.
set -uo pipefail
studio_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.local/bin:$PATH"

sudo apt-get update || echo "apt-get update reported errors; continuing."
command -v ffmpeg >/dev/null || sudo apt-get install -y --no-install-recommends ffmpeg util-linux || echo "WARNING: ffmpeg install failed."

if ! command -v uv >/dev/null; then
  python3 -m pip install --user --quiet uv || curl -LsSf https://astral.sh/uv/install.sh | sh || echo "WARNING: uv install failed."
fi
[ -x "$HOME/.local/bin/uv" ] && sudo ln -sf "$HOME/.local/bin/uv" /usr/local/bin/uv

cd "$studio_root/showrunner-studio/backend" && uv sync --locked || echo "WARNING: backend dependency install failed."
cd "$studio_root/showrunner-studio/frontend" && npm ci || echo "WARNING: frontend dependency install failed."
printf '\nTexel Studio setup finished. Check any WARNING lines above. The app opens on port 3001.\n'
exit 0
