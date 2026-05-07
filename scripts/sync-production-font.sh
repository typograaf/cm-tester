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
# Mirror the latest font + labels into every deployed tester
# (production = stable, dated folders = work-in-progress).
TARGETS=(production 260507)
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

# Skip if every target already matches the source (renamed file = no-op).
SRC_HASH="$(shasum -a 256 "$LATEST" | awk '{print $1}')"
ALL_MATCH=1
for T in "${TARGETS[@]}"; do
  DST="$REPO/$T/fonts/CM_Stable.otf"
  if [[ ! -f "$DST" ]]; then ALL_MATCH=0; break; fi
  DST_HASH="$(shasum -a 256 "$DST" | awk '{print $1}')"
  if [[ "$SRC_HASH" != "$DST_HASH" ]]; then ALL_MATCH=0; break; fi
done
if [[ "$ALL_MATCH" == "1" ]]; then
  log "no change ($LATEST_NAME)"
  exit 0
fi

# Copy the font into every target and regenerate that target's labels
# sidecar in place. extract_ss_labels.py merges with the existing
# JSON so editorial overrides (sample, label) are preserved.
GIT_PATHS=()
for T in "${TARGETS[@]}"; do
  DST="$REPO/$T/fonts/CM_Stable.otf"
  LABELS_DST="$REPO/$T/fonts/CM_Stable.labels.json"
  cp "$LATEST" "$DST"
  log "copied $LATEST_NAME -> $T/fonts/CM_Stable.otf"
  if ! python3 "$LABELS_SCRIPT" "$DST" "$LABELS_DST" >> "$LOG" 2>&1; then
    log "label extraction failed for $T"
    exit 1
  fi
  GIT_PATHS+=("$T/fonts/CM_Stable.otf" "$T/fonts/CM_Stable.labels.json")
done

cd "$REPO"

# Only commit/push if git sees a change in any of the synced files.
if [[ -z "$(git status --porcelain -- "${GIT_PATHS[@]}")" ]]; then
  log "git: no diff, skipping commit"
  exit 0
fi

git add "${GIT_PATHS[@]}"
git commit -m "Font sync: $LATEST_NAME" >> "$LOG" 2>&1 || {
  log "git commit failed"
  exit 1
}
git push >> "$LOG" 2>&1 || {
  log "git push failed"
  exit 1
}
log "pushed: $LATEST_NAME"
