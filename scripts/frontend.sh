#!/bin/bash
# ============================================================
# Yaksha FAQ Portal — Frontend Runner
#
# Tags: [ALERT] = red+bold, [INFO] = blue, [OK] = green, [WARN] = yellow
# Mirrors the backend logger so you can grep your way through.
#
# Usage: ./scripts/frontend.sh
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$SCRIPT_DIR/.."
FRONTEND="$ROOT/frontend"

VITE="$FRONTEND/node_modules/.bin/vite"

# ── Terminal colors (ANSI) ───────────────────────────────────────────────────
F_INFO="\033[94m"
F_OK="\033[92m"
F_WARN="\033[93m"
F_ALERT="\033[1;31m"
F_DIM="\033[2m"
F_BOLD="\033[1m"
F_RESET="\033[0m"

# ── Tagged log helpers ──────────────────────────────────────────────────────
log()   { echo -e "${F_INFO}[INFO]${F_RESET} $1"; }
ok()    { echo -e "${F_OK}[OK]${F_RESET}   $1"; }
warn()  { echo -e "${F_WARN}[WARN]${F_RESET} $1"; }
alert() { echo -e "${F_ALERT}[ALERT]${F_RESET} $1"; }
dim()   { echo -e "${F_DIM}       $1${F_RESET}"; }
die()   { alert "$1" >&2; exit 1; }

is_running() {
  curl -sf --max-time 3 http://localhost:5173 > /dev/null 2>&1
}

stop_port() {
  local port=$1
  local pid=$(lsof -ti :$port 2>/dev/null || true)
  if [ -n "$pid" ]; then
    warn "port $port in use — killing pid $pid"
    kill $pid 2>/dev/null || true
    sleep 1
  fi
}

# ── Check / start frontend ───────────────────────────────────────────────────
if is_running; then
  ok "frontend already running on http://localhost:5173"
else
  stop_port 5173
  cd "$FRONTEND"

  log "checking Node.js..."
  node --version > /dev/null || die "Node.js not found"
  [ ! -x "$VITE" ] && die "vite not found at $VITE — run: cd frontend && npm install"

  # Session log — timestamped, kept in logs/
  SESSION_TIMESTAMP=$(date '+%Y-%m-%d_%H-%M-%S')
  SESSION_LOG="$ROOT/logs/frontend_${SESSION_TIMESTAMP}.txt"
  mkdir -p "$ROOT/logs"
  ln -sf "frontend_${SESSION_TIMESTAMP}.txt" "$ROOT/frontend_log.txt" 2>/dev/null || true

  log "starting frontend (vite)..."
  echo ""

  # Kill orphaned vite on port 5173 before starting
  pkill -f "vite" 2>/dev/null || true
  sleep 1

  "$VITE" --port 5173 2>&1 | \
    sed -u "s/^\([^[]]*\)/${F_DIM}[frontend]${F_RESET} \1/" | \
    tee "$SESSION_LOG" > /tmp/yaksha-frontend.log &

  ok "frontend started — log: $SESSION_LOG"
fi
