#!/usr/bin/env zsh
set -e
set -u
set -o pipefail

# Ensure Bun is on PATH for PM2-managed environment
export PATH="$HOME/.bun/bin:$PATH"

STARS_DIR="/Users/jasonnathan/Repos/@theGeekist/stars"
GH_EXPLORE_DIR="/Users/jasonnathan/Repos/gh_explore"

log() { printf "[%s] %s\n" "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Error: '$1' not found in PATH" >&2; exit 127; }
}

require_cmd bun
require_cmd git

# Prevent overlapping runs (macOS-friendly lock using mkdir)
LOCKDIR="/tmp/stars-cron.lockdir"
if ! mkdir "$LOCKDIR" 2>/dev/null; then
  log "Another run is in progress; exiting."
  exit 0
fi
cleanup() { rmdir "$LOCKDIR" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

log "Starting stars cron pipeline"

cd "$STARS_DIR"
log "bun start lists"
bun start lists

log "bun start unlisted"
bun start unlisted

log "bun start ingest"
bun start ingest

log "git pull in $GH_EXPLORE_DIR"
cd "$GH_EXPLORE_DIR"
git pull --ff-only

cd "$STARS_DIR"
log "bun start topics:enrich"
bun start topics:enrich

log "bun start summarise"
bun start summarise

log "bun start score"
bun start score

log "Completed stars cron pipeline"
