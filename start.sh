#!/usr/bin/env bash
# Build the Vite production bundle and serve it in the foreground.
#
# - Runs from the project directory (PROJECT_DIR).
# - Installs dependencies when node_modules is missing or stale.
# - Rebuilds dist/ when sources are newer than the last build.
# - Writes $OPENCODE_WEB_DIR/deployment-output.json with the absolute
#   project root and built static directory (both inside PROJECT_DIR).
# - Serves dist/ in the foreground on $PORT (default 3000).
# Every substantive command is timed with /usr/bin/time -p.
set -euo pipefail

# `cd` and `trap` are shell builtins, so they use the shell's `time` keyword;
# /usr/bin/time cannot exec builtins. Every external command uses /usr/bin/time -p.
time -p cd "$(dirname "$0")"
ROOT="$(/usr/bin/time -p pwd)"
OUT="$ROOT/dist"
PORT="${PORT:-3000}"

case "$PORT" in
  '' | *[!0-9]*) echo "start.sh: PORT must be numeric, got '$PORT'" >&2; exit 1 ;;
esac

if [ -z "${OPENCODE_WEB_DIR:-}" ]; then
  echo 'start.sh: OPENCODE_WEB_DIR must be set (worker metadata directory)' >&2
  exit 1
fi

# ---- dependencies ---------------------------------------------------------
STAMP="$ROOT/node_modules/.install-stamp"
if [ ! -f "$STAMP" ] \
  || [ "$ROOT/package.json" -nt "$STAMP" ] \
  || { [ -f "$ROOT/package-lock.json" ] && [ "$ROOT/package-lock.json" -nt "$STAMP" ]; }; then
  if [ -f "$ROOT/package-lock.json" ]; then
    /usr/bin/time -p npm ci --no-audit --no-fund
  else
    /usr/bin/time -p npm install --no-audit --no-fund
  fi
  /usr/bin/time -p touch "$STAMP"
fi
/usr/bin/time -p test -x "$ROOT/node_modules/vite/bin/vite.js"

# ---- build ----------------------------------------------------------------
if [ ! -f "$OUT/index.html" ] \
  || [ -n "$(/usr/bin/time -p find "$ROOT/src" "$ROOT/index.html" "$ROOT/vite.config.js" -newer "$OUT/index.html" -print -quit 2>/dev/null)" ]; then
  /usr/bin/time -p node "$ROOT/node_modules/vite/bin/vite.js" build
fi
/usr/bin/time -p test -f "$OUT/index.html"

# ---- deployment metadata (worker metadata only, never build output) -------
export DEPLOY_JSON="$OPENCODE_WEB_DIR/deployment-output.json"
export PROJECT_ROOT_ABS="$ROOT"
export DEPLOY_DIR_ABS="$OUT"
/usr/bin/time -p node -e 'require("node:fs").writeFileSync(process.env.DEPLOY_JSON, JSON.stringify({ project: process.env.PROJECT_ROOT_ABS, directory: process.env.DEPLOY_DIR_ABS }))'
/usr/bin/time -p cat "$DEPLOY_JSON"
echo

# ---- live rebuild in the background; static server in the foreground ------
/usr/bin/time -p node "$ROOT/node_modules/vite/bin/vite.js" --version
node "$ROOT/node_modules/vite/bin/vite.js" build --watch &
WATCH_PID=$!
cleanup() { kill "$WATCH_PID" 2>/dev/null || true; }
trap 'cleanup' EXIT INT TERM # shell builtin (instant); external commands below are timed
/usr/bin/time -p node "$ROOT/node_modules/vite/bin/vite.js" preview --host 0.0.0.0 --port "$PORT" --strictPort --outDir dist
