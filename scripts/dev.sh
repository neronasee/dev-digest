#!/usr/bin/env bash
#
# DevDigest local bootstrap — bring the whole stack up from zero.
#
#   ./scripts/dev.sh              # full: docker → migrate → seed → server + client
#   ./scripts/dev.sh --no-seed    # skip the demo seed
#   ./scripts/dev.sh --no-client  # run only Postgres + API (no Next.js)
#   ./scripts/dev.sh --db-only    # just Postgres + migrate + seed, then exit
#
# Idempotent: re-running installs only what's missing, migrations and seed
# both upsert. Ctrl-C stops the dev servers and leaves Postgres running.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CONTAINER="devdigest-postgres"
RUN_SEED=1
RUN_CLIENT=1
DB_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --no-seed)   RUN_SEED=0 ;;
    --no-client) RUN_CLIENT=0 ;;
    --db-only)   DB_ONLY=1 ;;
    -h|--help)   sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

log()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }

# --- prerequisites -----------------------------------------------------------
command -v docker >/dev/null || { echo "docker not found"; exit 1; }
command -v pnpm   >/dev/null || { echo "pnpm not found (npm i -g pnpm)"; exit 1; }

# --- env files ---------------------------------------------------------------
for dir in server client; do
  if [ ! -f "$dir/.env" ] && [ -f "$dir/.env.example" ]; then
    cp "$dir/.env.example" "$dir/.env"
    warn "created $dir/.env from .env.example — add your API keys (OPENAI/ANTHROPIC/GITHUB_TOKEN) in server/.env"
  fi
done

# --- Postgres ----------------------------------------------------------------
# The container name is fixed (container_name: devdigest-postgres), so if one is
# already running (possibly under another compose project) we reuse it instead
# of failing on a name conflict. If it exists but is stopped, start it; else
# create it via compose.
state="$(docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "missing")"
case "$state" in
  running) log "Postgres container already running — reusing it" ;;
  exited|created) log "starting existing Postgres container"; docker start "$CONTAINER" >/dev/null ;;
  *)       log "starting Postgres (docker compose up -d)"; docker compose up -d ;;
esac

log "waiting for Postgres to be healthy"
for _ in $(seq 1 60); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo "starting")"
  [ "$status" = "healthy" ] && break
  sleep 1
done
[ "${status:-}" = "healthy" ] || { echo "Postgres did not become healthy in time"; exit 1; }
log "Postgres healthy"

# --- install deps (only if missing) ------------------------------------------
install_if_needed() {
  if [ ! -d "$1/node_modules" ]; then
    log "installing deps in $1"
    (cd "$1" && pnpm install)
  fi
}
install_if_needed server
[ "$DB_ONLY" -eq 0 ] && [ "$RUN_CLIENT" -eq 1 ] && install_if_needed client
# reviewer-core's RAW source is imported by the API at runtime (tsconfig alias);
# without its deps the API crashes at boot with ERR_MODULE_NOT_FOUND. It uses npm.
[ -d reviewer-core/node_modules ] || { log "installing deps in reviewer-core"; (cd reviewer-core && npm ci); }

# --- migrate + seed ----------------------------------------------------------
log "applying migrations"
(cd server && pnpm db:migrate)

if [ "$RUN_SEED" -eq 1 ]; then
  log "seeding demo data"
  (cd server && pnpm db:seed)
fi

if [ "$DB_ONLY" -eq 1 ]; then
  log "DB ready. Postgres is running; server/client not started (--db-only)."
  exit 0
fi

# --- port pre-checks ---------------------------------------------------------
# Fail fast with the offending PID instead of a deep EADDRINUSE buried in pnpm
# output when a stale server from an earlier run still holds the port. Same
# lsof probe e2e.sh uses for its teardown backstop. Placed after the --db-only
# exit: that mode binds no dev ports, so it must not be blocked by them.
require_port_free() {
  local port="$1" pids pid
  pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
  [ -z "$pids" ] && return 0
  {
    echo "port :$port is already in use — a stale dev server from an earlier run?"
    for pid in $pids; do
      echo "  PID $pid ($(ps -p "$pid" -o comm= 2>/dev/null || echo unknown))"
    done
    echo "stop it first: kill $pids"
  } >&2
  exit 1
}
require_port_free 3001   # API
[ "$RUN_CLIENT" -eq 1 ] && require_port_free 3000   # web

# --- dev servers -------------------------------------------------------------
SERVER_PID=""
CLIENT_PID=""
# Recursively kill a process and all its descendants. `pnpm dev` spawns the real
# listener (node/tsx, next-server) as a GRANDCHILD, so a plain `kill $PID` can
# leave it orphaned with the port still bound. Duplicated from scripts/e2e.sh
# (its cleanup) — keep the two in sync.
kill_tree() {
  local pid="$1"
  [ -n "$pid" ] || return 0
  local kid
  for kid in $(pgrep -P "$pid" 2>/dev/null || true); do kill_tree "$kid"; done
  kill "$pid" 2>/dev/null || true
}
cleanup() {
  log "shutting down dev servers (Postgres stays up; stop it with: docker compose down)"
  kill_tree "$SERVER_PID"
  kill_tree "$CLIENT_PID"
}
trap cleanup EXIT INT TERM

log "starting API on :3001 (server)"
(cd server && pnpm dev) &
SERVER_PID=$!

if [ "$RUN_CLIENT" -eq 1 ]; then
  log "starting web on :3000 (client) — Ctrl-C to stop both"
  (cd client && pnpm dev) &
  CLIENT_PID=$!
  wait "$CLIENT_PID"
else
  log "API running (PID $SERVER_PID) — Ctrl-C to stop"
  wait "$SERVER_PID"
fi
