# CM Tester

Type tester for the CM custom typeface. Live: https://cm.typografie.be

The root is a **hub** (`index.html`) that links through to every dated build.
Each build lives in its own `YYMMDD/` folder and is a self-contained snapshot
(its own `index.html`, `app.js`, `styles.css`, `fonts/`, `assets/`).

## Versions

- `260414/` — the original tester (five explorations, OpenType feature toggles)
- `260505/` — former production / stable build
- `260507/` — multi-panel iteration
- `260518/` — single-column layout
- `260520/` — current working iteration

## Fonts

`scripts/sync-production-font.sh` mirrors the latest `CM_Stable*.otf` export
from Dropbox into each work-in-progress build's `fonts/` folder (see `TARGETS`
in that script) and pushes the change.

## Local preview

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Fonts load over `fetch()` so you need a server — `file://` will not work.
