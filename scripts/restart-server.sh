#!/bin/bash
#
# restart-server.sh - durable restart of the MAIN worktree Circus Chief server.
#
# The server is the parent process of the agent sessions it hosts, so
# restarting it from inside a session kills the invoker at the kill step.
# This script therefore relaunches itself detached (reparented to launchd)
# before doing anything destructive, and the detached phase completes the
# restart, health-checks the new server, and writes proof to the log.
#
# Usage:
#   ./scripts/restart-server.sh [--pull] [--dry-run] [--foreground]
#                               [--timeout N] [--log FILE]
#
# Flags:
#   (none)         Pure restart via ./scripts/start-server.sh --force
#   --pull         Pre-restart: git fetch + pull --ff-only on main, then a
#                  yarn build validation BEFORE the kill (zero-downtime abort
#                  if main does not build).
#   --dry-run      Print resolved main root, current port-5000 holder, and the
#                  planned command. Touches nothing.
#   --foreground   Skip detaching; run the whole flow in the caller's terminal.
#   --timeout N    Health-loop budget in seconds (default 300).
#   --log FILE     Log path override (default /tmp/restart-server.log).
#
# macOS ships bash 3.2: this script stays 3.2-safe (no associative arrays,
# no mapfile, no &>, ASCII only). Check with /bin/bash -n.
#

TIMEOUT=300
LOG="/tmp/restart-server.log"
PULL=0
DRY_RUN=0
FOREGROUND=0
DETACHED=0
PORT=5000

usage() {
  echo "Usage: $0 [--pull] [--dry-run] [--foreground] [--timeout N] [--log FILE]"
}

# Log helper: in detached phase stdout IS the log (exec redirect below);
# in foreground also append to the log file.
log() {
  echo "$*"
  if [ "$DETACHED" -ne 1 ]; then
    echo "$*" >> "$LOG" 2>/dev/null || true
  fi
}

fatal() {
  log "FATAL: $*"
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --pull)
      PULL=1
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    --foreground)
      FOREGROUND=1
      ;;
    --timeout)
      TIMEOUT="$2"
      shift
      ;;
    --timeout=*)
      TIMEOUT="${1#--timeout=}"
      ;;
    --log)
      LOG="$2"
      shift
      ;;
    --log=*)
      LOG="${1#--log=}"
      ;;
    --detached-phase)
      DETACHED=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown flag: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

case "$TIMEOUT" in
  ''|*[!0-9]*)
    echo "Invalid --timeout (must be a positive integer): $TIMEOUT" >&2
    exit 1
    ;;
esac
if [ "$TIMEOUT" -lt 1 ]; then
  echo "Invalid --timeout (must be a positive integer): $TIMEOUT" >&2
  exit 1
fi

# Resolve the MAIN repo root via the common git dir, never the caller CWD.
# Linked worktrees have a .git FILE; only the main checkout has a .git DIR.
COMMON_RAW="$(git rev-parse --git-common-dir 2>/dev/null)" || {
  echo "FATAL: not inside a git repository; cannot resolve main worktree." >&2
  exit 1
}
case "$COMMON_RAW" in
  /*) COMMON_DIR="$COMMON_RAW" ;;
  *)  COMMON_DIR="$(pwd)/$COMMON_RAW" ;;
esac
MAIN_ROOT="$(dirname "$COMMON_DIR")"
if [ ! -d "$MAIN_ROOT/.git" ]; then
  echo "FATAL: resolved main root has no .git directory: $MAIN_ROOT" >&2
  exit 1
fi
START_SCRIPT="$MAIN_ROOT/scripts/start-server.sh"
if [ ! -f "$START_SCRIPT" ]; then
  echo "FATAL: server startup script missing: $START_SCRIPT" >&2
  exit 1
fi

port_pid() {
  lsof -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1
}

http_code() {
  curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/api/projects" 2>/dev/null || echo "000"
}

OLD_PID="$(port_pid)"
OLD_HEAD="$(git -C "$MAIN_ROOT" rev-parse HEAD 2>/dev/null)"
if [ -z "$OLD_HEAD" ]; then
  OLD_HEAD="unknown"
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo "main root: $MAIN_ROOT"
  echo "port $PORT holder PID: ${OLD_PID:-none}"
  echo "deployed HEAD: $OLD_HEAD"
  echo "planned command: $START_SCRIPT --force (cwd=$MAIN_ROOT)"
  if [ "$PULL" -eq 1 ]; then
    echo "planned pre-steps: git fetch origin --prune && git pull --ff-only origin main && yarn build (abort pre-kill on failure)"
  fi
  echo "log: $LOG"
  echo "timeout: ${TIMEOUT}s"
  exit 0
fi

# The restart flow. Runs detached (stdout redirected to LOG by the caller),
# or in the foreground terminal when --foreground was given.
do_restart() {
  log "=== restart-server $(date '+%Y-%m-%d %H:%M:%S %z') ==="
  log "main root: $MAIN_ROOT"
  log "old port-$PORT PID: ${OLD_PID:-none}"
  log "old HEAD: $OLD_HEAD"

  # Force the known-good node onto PATH (nvm default), then drop caller
  # env that would divert the server: empty DB_PATH = main server with
  # the default DB; a stray VCR_MODE would divert to a hermetic test port.
  if [ -d "$HOME/.nvm/versions/node/v22.19.0/bin" ]; then
    export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
  fi
  unset DB_PATH VCR_MODE
  log "node: $(command -v node) ($(node --version 2>/dev/null))"

  if [ "$PULL" -eq 1 ]; then
    log "--- pull phase (pre-kill) ---"
    ( cd "$MAIN_ROOT" && git fetch origin --prune ) || {
      fatal "git fetch failed; server untouched."
    }
    ( cd "$MAIN_ROOT" && git pull --ff-only origin main ) || {
      fatal "git pull --ff-only failed; server untouched."
    }
    log "validating build before kill..."
    ( cd "$MAIN_ROOT" && yarn build ) || {
      fatal "yarn build failed on latest main; server untouched (old server still running)."
    }
    log "build OK."
  fi

  log "--- starting server ($START_SCRIPT --force) ---"
  ( cd "$MAIN_ROOT" && nohup ./scripts/start-server.sh --force >>"$LOG" 2>&1 & ) || {
    fatal "failed to launch start-server.sh."
  }

  log "--- health loop (budget ${TIMEOUT}s) ---"
  ELAPSED=0
  NEW_PID=""
  CODE="000"
  while [ "$ELAPSED" -lt "$TIMEOUT" ]; do
    NEW_PID="$(port_pid)"
    CODE="$(http_code)"
    if [ -n "$NEW_PID" ] && [ "$CODE" = "200" ]; then
      break
    fi
    sleep 2
    ELAPSED=$((ELAPSED + 2))
  done

  if [ -z "$NEW_PID" ] || [ "$CODE" != "200" ]; then
    fatal "new server unhealthy after ${TIMEOUT}s (pid=${NEW_PID:-none} http=$CODE)."
  fi

  NEW_HEAD="$(git -C "$MAIN_ROOT" rev-parse HEAD 2>/dev/null)"
  if [ -z "$NEW_HEAD" ]; then
    NEW_HEAD="unknown"
  fi
  log "--- proof ---"
  log "listener: $(lsof -nP -iTCP:$PORT -sTCP:LISTEN 2>/dev/null | tail -1)"
  log "process: $(ps -p "$NEW_PID" -o pid=,ppid=,etime=,command= 2>/dev/null)"
  log "http /api/projects: $CODE"
  log "old HEAD: $OLD_HEAD -> new HEAD: $NEW_HEAD"
  if [ "$OLD_PID" != "$NEW_PID" ]; then
    log "pid changed: ${OLD_PID:-none} -> $NEW_PID"
  else
    log "note: pid unchanged ($NEW_PID)"
  fi
  log "restart OK in ~${ELAPSED}s"
  exit 0
}

# Invoker phase: relaunch detached so the restart survives our own death
# (the kill step takes down any session hosted by the old server).
if [ "$DETACHED" -ne 1 ] && [ "$FOREGROUND" -ne 1 ]; then
  PASS="--detached-phase --timeout $TIMEOUT --log $LOG"
  if [ "$PULL" -eq 1 ]; then
    PASS="$PASS --pull"
  fi
  # shellcheck disable=SC2086
  nohup "$0" $PASS </dev/null >/dev/null 2>&1 &
  disown 2>/dev/null || true
  echo "restart initiated (detached) - follow $LOG"
  exit 0
fi

if [ "$DETACHED" -eq 1 ]; then
  exec > "$LOG" 2>&1
fi

do_restart
