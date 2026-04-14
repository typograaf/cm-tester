# CM Tester

Type tester for the CM custom typeface — edit text, change leading / tracking / size, toggle OpenType features, and switch between the 5 explorations.

Live: https://cm.typografie.be

## Fonts

Latest exported font per exploration (as of 2026-04-14):

- Exp 1: `CM_1_260413a-Bold.otf`
- Exp 2: `CM_2_260414-Bold.otf`
- Exp 3: `CM_3_260413-Bold.otf`
- Exp 4: `CM_4_260413b-Bold.otf`
- Exp 5: `CM_5_260414c-Bold.otf`

To refresh: replace the files in `fonts/` and update the paths in `app.js` (`EXPLORATIONS`).

## How it works

- `FontFace` API loads each OTF at runtime.
- `opentype.js` parses the font to auto-discover OpenType features (GSUB/GPOS). Stylistic-set UI names are pulled from the `name` table when available; otherwise the tag (e.g. `SS01`) is used as a label.
- Toggled features are applied via CSS `font-feature-settings`.

## Local preview

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Fonts load over `fetch()` so you need a server — `file://` will not work.
