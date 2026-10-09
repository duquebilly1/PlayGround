#!/usr/bin/env bash
# Capture desktop and mobile screenshots of the running app.
#
# Env:
#   CAPTURE_URL  exact URL to open in the browser (required).
#   CAPTURE_DIR  output directory for final-desktop.png / final-mobile.png
#                (required; must live outside the source tree).
# Behaviour:
#   - Opens the exact URL, waits for rendered content, screenshots it.
#   - Uses its own headless Chromium (closed automatically per run).
#   - Never touches the app server; the app keeps running.
# Exit codes:
#   75  temporary navigation / browser / infrastructure failure.
#   1   script misuse or rendering defect (missing/invalid screenshots).
# Every substantive command is timed with /usr/bin/time -p
# (/usr/bin/time cannot exec shell builtins, which are instant).
set -euo pipefail

fail_temp() { echo "capture.sh: temporary failure: $*" >&2; exit 75; }
fail_perm() { echo "capture.sh: $*" >&2; exit 1; }

# ---- inputs ---------------------------------------------------------------
[ -n "${CAPTURE_URL:-}" ] || fail_perm "CAPTURE_URL must be set"
[ -n "${CAPTURE_DIR:-}" ] || fail_perm "CAPTURE_DIR must be set"
/usr/bin/time -p mkdir -p "$CAPTURE_DIR"

# ---- browser --------------------------------------------------------------
BROWSER=""
for candidate in google-chrome chromium chromium-browser; do
  if command -v "$candidate" >/dev/null 2>&1; then BROWSER="$(command -v "$candidate")"; break; fi
done
[ -n "$BROWSER" ] || fail_temp "no Chromium-based browser installed"
echo "capture.sh: browser=$BROWSER url=$CAPTURE_URL dir=$CAPTURE_DIR"

# Isolated profile outside the source tree; removed afterwards.
PROFILE="$(/usr/bin/time -p mktemp -d "${RUNNER_TEMP:-/tmp}/capture-profile-XXXXXX")"
/usr/bin/time -p test -d "$PROFILE" || fail_temp "could not create temp browser profile"

# ---- preflight: is the preview reachable? ---------------------------------
HTTP_CODE="$(/usr/bin/time -p curl --silent --location --max-time 20 --output /dev/null --write-out '%{http_code}' "$CAPTURE_URL")" \
  || fail_temp "could not reach $CAPTURE_URL"
echo "capture.sh: preflight HTTP $HTTP_CODE"
case "$HTTP_CODE" in
  2* | 3*) ;;
  408 | 429 | 500 | 502 | 503 | 504) fail_temp "preview returned HTTP $HTTP_CODE" ;;
  *) fail_perm "preview returned HTTP $HTTP_CODE" ;;
esac

# ---- screenshots ----------------------------------------------------------
shot() { # $1=name $2=width $3=height
  /usr/bin/time -p "$BROWSER" \
    --headless=new --no-sandbox --disable-dev-shm-usage \
    --use-angle=swiftshader --enable-unsafe-swiftshader \
    --run-all-compositor-stages-before-draw \
    --hide-scrollbars --window-size="$2,$3" \
    --user-data-dir="$PROFILE" \
    --virtual-time-budget=12000 --timeout=60000 \
    --screenshot="$CAPTURE_DIR/final-$1.png" \
    "$CAPTURE_URL" || fail_temp "browser failed capturing $1"
  /usr/bin/time -p test -s "$CAPTURE_DIR/final-$1.png" || fail_perm "missing screenshot: final-$1.png"
}
shot desktop 1440 900
shot mobile 390 844

# ---- validate real PNGs ---------------------------------------------------
command -v python3 >/dev/null 2>&1 || fail_perm "python3 is required to validate screenshots"
/usr/bin/time -p python3 - "$CAPTURE_DIR" <<'EOF' || fail_perm "screenshot validation failed"
import os, sys
d = sys.argv[1]
for name in ("final-desktop.png", "final-mobile.png"):
    p = os.path.join(d, name)
    with open(p, "rb") as f:
        head = f.read(8)
    assert head == b"\x89PNG\r\n\x1a\n", f"{name} is not a PNG"
    assert os.path.getsize(p) > 24 * 1024, f"{name} suspiciously small ({os.path.getsize(p)} bytes)"
    print(f"{name}: valid PNG, {os.path.getsize(p)} bytes")
EOF

# ---- cleanup (app server untouched) ---------------------------------------
/usr/bin/time -p rm -rf "$PROFILE"
/usr/bin/time -p ls -la "$CAPTURE_DIR"
echo 'capture.sh: done (app left running)'
