#!/usr/bin/env bash
# Sync the latest CM Stable export from Dropbox into production/fonts/
# and push the change to GitHub Pages.
#
# Picks the newest CM_Stable*.otf by modification time. Overwrites the
# fixed filename CM_Stable.otf so the production app.js never needs
# to change when a new export lands.

set -euo pipefail

REPO="/Users/mdnd-martijn/Documents/GitHub/cm-tester"
SRC_DIR="/Users/mdnd-martijn/Library/CloudStorage/Dropbox/AboutContact/Fonts/About Contact/WIP TYPE/Custom/Typeface Projects/CM/02-Exports/Production_1"
DST="$REPO/production/fonts/CM_Stable.otf"
LABELS_DST="$REPO/production/fonts/CM_Stable.labels.json"
LABELS_SCRIPT="$REPO/scripts/extract_ss_labels.py"
LOG="$REPO/scripts/sync-production-font.log"

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[$(ts)] $*" >> "$LOG"; }

if [[ ! -d "$SRC_DIR" ]]; then
  log "ERROR: source folder missing: $SRC_DIR"
  exit 1
fi

# Latest CM_Stable*.otf by mtime.
LATEST="$(ls -1t "$SRC_DIR"/CM_Stable*.otf 2>/dev/null | head -n 1 || true)"
if [[ -z "$LATEST" ]]; then
  log "no CM_Stable*.otf in $SRC_DIR"
  exit 0
fi

LATEST_NAME="$(basename "$LATEST")"

# Skip if dst already matches (compare by content hash so renames also no-op).
if [[ -f "$DST" ]]; then
  SRC_HASH="$(shasum -a 256 "$LATEST" | awk '{print $1}')"
  DST_HASH="$(shasum -a 256 "$DST" | awk '{print $1}')"
  if [[ "$SRC_HASH" == "$DST_HASH" ]]; then
    log "no change ($LATEST_NAME)"
    exit 0
  fi
fi

cp "$LATEST" "$DST"
log "copied $LATEST_NAME -> production/fonts/CM_Stable.otf"

# Regenerate the SS/CV labels sidecar so renamed/new sets pick up
# automatically without code changes.
if ! python3 "$LABELS_SCRIPT" "$DST" "$LABELS_DST" >> "$LOG" 2>&1; then
  log "label extraction failed"
  exit 1
fi

cd "$REPO"

# Only commit/push if git sees a change in either file.
if [[ -z "$(git status --porcelain -- production/fonts/CM_Stable.otf production/fonts/CM_Stable.labels.json)" ]]; then
  log "git: no diff, skipping commit"
  exit 0
fi

git add production/fonts/CM_Stable.otf production/fonts/CM_Stable.labels.json
git commit -m "Production font sync: $LATEST_NAME" >> "$LOG" 2>&1 || {
  log "git commit failed"
  exit 1
}
git push >> "$LOG" 2>&1 || {
  log "git push failed"
  exit 1
}
log "pushed: $LATEST_NAME"
