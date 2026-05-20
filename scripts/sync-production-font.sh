#!/usr/bin/env bash
# Sync the latest CM font exports from Dropbox into the testers and
# push to GitHub Pages. Two independent jobs:
#   1. CM_Stable*.otf  (Production_1) -> every dated tester
#   2. CM *VariableVF.ttf (Production 2) -> 260520 (Sharp + Rounded)
# Driven by the com.typograaf.cm-production-sync LaunchAgent, which
# watches both export folders.

set -uo pipefail

REPO="/Users/mdnd-martijn/Documents/GitHub/cm-tester"
EXPORTS="/Users/mdnd-martijn/Library/CloudStorage/Dropbox/AboutContact/Fonts/About Contact/WIP TYPE/Custom/Typeface Projects/CM/02-Exports"
SRC_STABLE="$EXPORTS/Production_1"
SRC_VAR="$EXPORTS/Production 2"
LABELS_SCRIPT="$REPO/scripts/extract_ss_labels.py"
LOG="$REPO/scripts/sync-production-font.log"

# CM_Stable.otf goes to every tester. 260505 = the former "production"
# stable build; the rest are dated iterations. 260520 keeps it too —
# its Glyph Overview / Outline modes parse it with opentype.js.
STABLE_TARGETS=(260505 260507 260518 260520)

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[$(ts)] $*" >> "$LOG"; }

# commit_push "<message>" <path> [path...] — commit + push if git
# sees a change in any of the given paths.
commit_push() {
  local msg="$1"; shift
  cd "$REPO" || return 1
  if [[ -z "$(git status --porcelain -- "$@")" ]]; then
    log "git: no diff for [$msg], skipping"
    return 0
  fi
  git add "$@"
  if ! git commit -m "$msg" >> "$LOG" 2>&1; then log "git commit failed: $msg"; return 1; fi
  if ! git push >> "$LOG" 2>&1; then log "git push failed: $msg"; return 1; fi
  log "pushed: $msg"
}

# Job 1 — CM_Stable.otf + labels sidecar into every dated tester.
sync_stable() {
  [[ -d "$SRC_STABLE" ]] || { log "stable: source folder missing"; return 0; }
  local latest
  latest="$(ls -1t "$SRC_STABLE"/CM_Stable*.otf 2>/dev/null | head -n 1 || true)"
  [[ -n "$latest" ]] || { log "stable: no CM_Stable*.otf"; return 0; }
  local name src_hash all_match=1
  name="$(basename "$latest")"
  src_hash="$(shasum -a 256 "$latest" | awk '{print $1}')"
  for T in "${STABLE_TARGETS[@]}"; do
    local dst="$REPO/$T/fonts/CM_Stable.otf"
    if [[ ! -f "$dst" ]]; then all_match=0; continue; fi
    local h; h="$(shasum -a 256 "$dst" | awk '{print $1}')"
    [[ "$h" == "$src_hash" ]] || all_match=0
  done
  if [[ "$all_match" == 1 ]]; then log "stable: no change ($name)"; return 0; fi

  local paths=()
  for T in "${STABLE_TARGETS[@]}"; do
    local dst="$REPO/$T/fonts/CM_Stable.otf"
    local labels="$REPO/$T/fonts/CM_Stable.labels.json"
    cp "$latest" "$dst"
    log "stable: copied $name -> $T/fonts/CM_Stable.otf"
    if ! python3 "$LABELS_SCRIPT" "$dst" "$labels" >> "$LOG" 2>&1; then
      log "stable: label extraction failed for $T"; return 1
    fi
    paths+=("$T/fonts/CM_Stable.otf" "$T/fonts/CM_Stable.labels.json")
  done
  commit_push "Font sync: $name" "${paths[@]}"
}

# Job 2 — the two variable masters into 260520. The newest *-VariableVF
# is Sharp, the newest *RoundedVariableVF is Rounded. app.js loads them
# under fixed filenames + a runtime cache-bust, so nothing else changes.
sync_variable() {
  [[ -d "$SRC_VAR" ]] || { log "variable: source folder missing"; return 0; }
  local sharp round paths=() names=()
  sharp="$(ls -1t "$SRC_VAR"/*-VariableVF.ttf 2>/dev/null | head -n 1 || true)"
  round="$(ls -1t "$SRC_VAR"/*RoundedVariableVF.ttf 2>/dev/null | head -n 1 || true)"

  if [[ -n "$sharp" ]]; then
    local dst="$REPO/260520/fonts/CM_Sharp_VF.ttf"
    if [[ ! -f "$dst" ]] || ! cmp -s "$sharp" "$dst"; then
      cp "$sharp" "$dst"
      log "variable: copied $(basename "$sharp") -> 260520/fonts/CM_Sharp_VF.ttf"
      paths+=("260520/fonts/CM_Sharp_VF.ttf"); names+=("$(basename "$sharp")")
    fi
  else
    log "variable: no *-VariableVF.ttf (Sharp)"
  fi

  if [[ -n "$round" ]]; then
    local dst="$REPO/260520/fonts/CM_Rounded_VF.ttf"
    if [[ ! -f "$dst" ]] || ! cmp -s "$round" "$dst"; then
      cp "$round" "$dst"
      log "variable: copied $(basename "$round") -> 260520/fonts/CM_Rounded_VF.ttf"
      paths+=("260520/fonts/CM_Rounded_VF.ttf"); names+=("$(basename "$round")")
    fi
  else
    log "variable: no *RoundedVariableVF.ttf"
  fi

  if [[ ${#paths[@]} -eq 0 ]]; then log "variable: no change"; return 0; fi
  commit_push "Font sync: ${names[*]}" "${paths[@]}"
}

sync_stable  || log "stable sync errored"
sync_variable || log "variable sync errored"
