#!/usr/bin/env bash
set -euo pipefail
studio_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# The stock Codespaces image has Python and Node but not ffmpeg or uv.
sudo apt-get update
sudo apt-get install -y --no-install-recommends ffmpeg util-linux
python3 -m pip install --user --quiet uv
sudo ln -sf "$HOME/.local/bin/uv" /usr/local/bin/uv
export PATH="$HOME/.local/bin:$PATH"

cd "$studio_root/showrunner-studio/backend"
uv sync --locked
cd "$studio_root/showrunner-studio/frontend"
npm ci
printf '\nTexel Studio dependencies are ready. The app opens on port 3001.\n'
