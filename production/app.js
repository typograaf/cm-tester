// CM Typeface Tester — Production
// Single-typeface variant ("Stable"). The stylistic-set pill row, detail
// panel, and glyph preview are all driven by a sidecar labels JSON that
// the sync script regenerates from the font itself — so renaming or
// adding sets in Glyphs flows through without any code changes.

import opentype from "https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/+esm";

// -------- config ---------------------------------------------------------

const FONT_FILE = "fonts/CM_Stable.otf";
const FONT_LABELS_FILE = "fonts/CM_Stable.labels.json";

const PRESETS = [
  "Leef gerust\nwat meer.",
  "Leef gerust\nwat losser.",
  "Leef gerust\niets te wild.",
  "Leef gerust\nzonder bang\nte zijn om op\nje gezicht\nte gaan.",
];

// Solid mode "fresh load" defaults — restored when leaving outline mode.
const REFRESH_TEXT = "Leef gerust\nzonder bang\nte zijn om op\nje gezicht\nte gaan.";
const REFRESH_LEADING = "0.87";
const REFRESH_TRACKING = "-0.01";
const REFRESH_BG = "#FFFFFF";

// Random letter charset for outline mode's "Random String" button.
const BASIC_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

const OUTLINE_DEFAULT_CHAR = "S";

const CASE_MODES = [
  { id: "upper", label: "TT", transform: "uppercase" },
  { id: "lower", label: "tt", transform: "lowercase" },
];

// Background swatches → data attribute on the stage panel. Hex stays in
// the HTML (data-bg) so it's the single source of truth for the swatch
// dot AND the bg it applies.
const BG_MAP = {
  "#004C2B": "dark",
  "#FFFFFF": "white",
  "#D7F394": "mint",
};

const HIDDEN_DEFAULTS = new Set(["kern", "calt", "rlig", "ccmp", "mark", "mkmk", "aalt", "locl"]);

// -------- state ----------------------------------------------------------

const state = {
  caseMode: null,
  // Each ss/cv tag → on/off; populated from labels JSON. Other features
  // (liga/dlig) are seeded as a safe default.
  featureState: { liga: true, dlig: true },
  font: null, // { family, features }
  ssLabels: {}, // { ss01: { label, sample }, ... }
  focusedSS: null,
  outlineMode: false,
  userSizeOverride: false, // true once the user moves the size slider
};

// -------- DOM refs -------------------------------------------------------

const $ = (id) => document.getElementById(id);
const ssPillsEl = $("ssPills");
const caseToggleEl = $("caseToggle");
const stageText = $("stageText");
const stageMark = $("stageMark");
const stagePanel = $("stagePanel");
const leadingInput = $("leading");
const trackingInput = $("tracking");
const sizeInput = $("fontsize");
const randomBtn = $("randomString");
const ssTagEl = $("ssTag");
const ssTitleEl = $("ssTitle");
const ssDescEl = $("ssDesc");
const glyphPreviewEl = $("glyphPreview");
const bgSwatchesEl = $("bgSwatches");
const outlineToggleEl = $("outlineToggle");
const stageOutlineEl = $("stageOutline");

// -------- font loading --------------------------------------------------

async function loadFont() {
  const cb = Date.now();
  const [res, labelsRes] = await Promise.all([
    fetch(`${FONT_FILE}?t=${cb}`),
    fetch(`${FONT_LABELS_FILE}?t=${cb}`),
  ]);
  if (!res.ok) throw new Error(`failed to fetch ${FONT_FILE}`);
  const buf = await res.arrayBuffer();
  if (labelsRes.ok) {
    try {
      state.ssLabels = await labelsRes.json();
    } catch (_) {
      state.ssLabels = {};
    }
  }

  const family = "CM-Stable";
  const fontFace = new FontFace(family, buf, {
    weight: "700",
    style: "normal",
    display: "block",
  });
  await fontFace.load();
  document.fonts.add(fontFace);
  await document.fonts.ready;
  try {
    await document.fonts.load(`700 100px "${family}"`);
  } catch (_) {}

  let features = [];
  let parsed = null;
  try {
    parsed = opentype.parse(buf);
    features = discoverFeatures(parsed);
  } catch (err) {
    console.warn(`feature discovery failed:`, err);
  }

  // Probe a few round glyphs to learn the font's actual overshoot
  // amounts (where round letters extend past the metric lines so they
  // optically read the same size as flat-topped ones). Used by the
  // outline-mode overshoot bands.
  const overshoots = { cap: 0, xh: 0, baseline: 0, descender: 0 };
  if (parsed) {
    const os2 = parsed.tables.os2 || {};
    const capUnits = os2.sCapHeight || parsed.ascender;
    const xhUnits = os2.sxHeight || capUnits * 0.5;
    const descUnits = Math.abs(os2.sTypoDescender || parsed.descender);
    const probe = (ch, kind) => {
      try {
        const g = parsed.charToGlyph(ch);
        if (!g || !g.advanceWidth) return;
        const bb = g.getBoundingBox();
        if (kind === "cap")     overshoots.cap = Math.max(overshoots.cap, bb.y2 - capUnits);
        if (kind === "xh")      overshoots.xh  = Math.max(overshoots.xh,  bb.y2 - xhUnits);
        if (kind === "base")    overshoots.baseline = Math.max(overshoots.baseline, -bb.y1);
        if (kind === "desc")    overshoots.descender = Math.max(overshoots.descender, -bb.y1 - descUnits);
      } catch (_) {}
    };
    probe("O", "cap");
    probe("o", "xh");
    probe("o", "base");
    for (const ch of "gpqy") probe(ch, "desc");
  }

  state.font = { family, features, parsed, overshoots };

  // Pre-compute the widest sample across all SSes (in font units), so
  // the glyph preview can use one consistent scale for every SS — a
  // single-char "g" preview renders at the same vertical scale as the
  // 3-char "jft" preview.
  state.maxSampleAdvanceUnits = 0;
  if (parsed) {
    for (const tag of Object.keys(state.ssLabels)) {
      const meta = state.ssLabels[tag] || {};
      const sample = meta.sample;
      if (!sample) continue;
      const subs = meta.substitutions || {};
      const advance = (useSubs) => {
        let t = 0;
        for (const ch of sample) {
          const g = useSubs && typeof subs[ch] === "number"
            ? parsed.glyphs.get(subs[ch])
            : parsed.charToGlyph(ch);
          t += g.advanceWidth || 0;
        }
        return t;
      };
      state.maxSampleAdvanceUnits = Math.max(
        state.maxSampleAdvanceUnits,
        advance(false),
        advance(true),
      );
    }
  }

  return state.font;
}

function discoverFeatures(font) {
  const tags = new Set();
  const gsub = font.tables.gsub;
  if (gsub && gsub.features) {
    for (const f of gsub.features) if (f && f.tag) tags.add(f.tag);
  }
  const gpos = font.tables.gpos;
  if (gpos && gpos.features) {
    for (const f of gpos.features) if (f && f.tag) tags.add(f.tag);
  }

  const out = [];
  for (const tag of tags) {
    if (HIDDEN_DEFAULTS.has(tag)) continue;
    if (!/^ss\d\d$/.test(tag) && !/^cv\d\d$/.test(tag)) continue;
    const meta = state.ssLabels[tag] || {};
    out.push({
      tag,
      label: meta.label || tag.toUpperCase(),
      sample: meta.sample || "",
    });
  }

  out.sort((a, b) => a.tag.localeCompare(b.tag));
  return out;
}

// -------- render --------------------------------------------------------

function renderSSPills() {
  ssPillsEl.innerHTML = "";
  if (!state.font) return;
  for (const feat of state.font.features) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ss-pill";
    btn.textContent = feat.label;
    btn.title = feat.tag;
    btn.dataset.tag = feat.tag;
    btn.classList.toggle("is-active", !!state.featureState[feat.tag]);
    btn.addEventListener("click", () => {
      state.featureState[feat.tag] = !state.featureState[feat.tag];
      state.focusedSS = feat.tag;
      renderSSPills();
      renderDetail();
      applyTypography();
    });
    ssPillsEl.appendChild(btn);
  }
}

function renderCaseToggle() {
  caseToggleEl.innerHTML = "";
  for (const mode of CASE_MODES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = mode.label;
    btn.title = mode.transform;
    btn.classList.toggle("is-active", state.caseMode === mode.id);
    btn.addEventListener("click", () => {
      state.caseMode = state.caseMode === mode.id ? null : mode.id;
      renderCaseToggle();
      applyTypography();
    });
    caseToggleEl.appendChild(btn);
  }
}

function renderDetail() {
  const tag = state.focusedSS;
  if (!tag) {
    ssTagEl.textContent = "";
    ssTitleEl.textContent = "";
    ssDescEl.textContent = "";
    glyphPreviewEl.innerHTML = "";
    return;
  }
  const meta = state.ssLabels[tag] || {};
  ssTagEl.textContent = tag.toUpperCase();
  ssTitleEl.textContent = meta.label || tag.toUpperCase();
  ssTitleEl.style.fontFeatureSettings = `"${tag}" 1`;
  ssDescEl.textContent = meta.description || "";
  renderGlyphPreview();
}

// Build an SVG of the focused-SS sample glyph aligned to the real font
// metrics. Lines = cap height, x-height, baseline, descender — read
// from the live font (sCapHeight, sxHeight, sTypoDescender) so they
// move when the font changes.
function renderGlyphPreview() {
  const tag = state.focusedSS;
  const meta = state.ssLabels[tag] || {};
  const sample = meta.sample;
  const ot = state.font?.parsed;
  if (!ot || !sample) {
    glyphPreviewEl.innerHTML = "";
    return;
  }

  const W = glyphPreviewEl.clientWidth;
  const H = glyphPreviewEl.clientHeight;
  if (W <= 0 || H <= 0) return;

  const upm = ot.unitsPerEm;
  const os2 = ot.tables.os2 || {};
  const cap = os2.sCapHeight || ot.ascender;
  const xh = os2.sxHeight || cap * 0.5;
  const desc = Math.abs(os2.sTypoDescender || ot.descender);

  const isOn = !!state.featureState[tag];
  const subs = meta.substitutions || {};
  const resolveGlyph = (ch) => {
    if (isOn && typeof subs[ch] === "number") return ot.glyphs.get(subs[ch]);
    return ot.charToGlyph(ch);
  };

  // Use the WIDEST sample across all SSes for the W-constraint, so
  // every SS renders at the same vertical scale even though different
  // samples take different horizontal space.
  const maxAdvanceUnits = state.maxSampleAdvanceUnits || upm;

  // Pick the smaller scale so the widest possible glyph fits both
  // width and height of the cell.
  const scaleByH = H / (cap + desc);
  const scaleByW = (W * 0.92) / maxAdvanceUnits;
  const scale = Math.min(scaleByH, scaleByW);
  const fontSize = scale * upm;

  // Compute the actual advance for THIS sample (for centring only).
  let totalAdvanceUnits = 0;
  for (const ch of sample) {
    const g = resolveGlyph(ch);
    totalAdvanceUnits += g.advanceWidth || 0;
  }
  if (totalAdvanceUnits <= 0) totalAdvanceUnits = upm;

  // Centre vertically when scaling is bound by width (glyph is shorter
  // than the cell), so metric lines + glyph stay middle-aligned.
  const usedH = (cap + desc) * scale;
  const yOff = (H - usedH) / 2;
  const capY = yOff + 0.5;
  const xY = yOff + (cap - xh) * scale;
  const baselineY = yOff + cap * scale;
  const descenderY = yOff + usedH - 0.5;

  // Glyph preview mirrors the live toggle state — variant when the SS
  // is on, default form when it's off. Multi-character samples ("Aa",
  // "jft") render each char via direct index lookup (extracted from
  // GSUB by the Python script).
  const totalAdvance = totalAdvanceUnits * scale;
  let xOff = (W - totalAdvance) / 2;

  const pathPieces = [];
  for (const ch of sample) {
    const g = resolveGlyph(ch);
    pathPieces.push(g.getPath(xOff, baselineY, fontSize).toPathData(2));
    xOff += (g.advanceWidth || 0) * scale;
  }
  const pathData = pathPieces.join(" ");

  const lineColor = "#E5EDEA";
  glyphPreviewEl.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      <line x1="0" y1="${capY}" x2="${W}" y2="${capY}" stroke="${lineColor}" stroke-width="1"/>
      <line x1="0" y1="${xY}" x2="${W}" y2="${xY}" stroke="${lineColor}" stroke-width="1"/>
      <line x1="0" y1="${baselineY}" x2="${W}" y2="${baselineY}" stroke="${lineColor}" stroke-width="1"/>
      <line x1="0" y1="${descenderY}" x2="${W}" y2="${descenderY}" stroke="${lineColor}" stroke-width="1"/>
      <path d="${pathData}" fill="#004C2B"/>
    </svg>`;
}

function renderSwatches() {
  for (const btn of bgSwatchesEl.querySelectorAll(".bg-swatch")) {
    const isActive = btn.classList.contains("is-active");
    btn.style.background = btn.dataset.bg;
    btn.classList.toggle("is-active", isActive);
  }
}

function applyTypography() {
  if (!state.font) return;

  const family = `"${state.font.family}", system-ui, sans-serif`;

  const parts = [];
  for (const tag of Object.keys(state.featureState)) {
    parts.push(`"${tag}" ${state.featureState[tag] ? 1 : 0}`);
  }
  const fft = parts.length ? parts.join(", ") : "normal";

  stageText.style.fontFamily = family;
  stageText.style.lineHeight = leadingInput.value;
  stageText.style.letterSpacing = `${trackingInput.value}em`;
  stageText.style.fontFeatureSettings = fft;
  stageText.style.textTransform =
    state.caseMode === "upper" ? "uppercase"
    : state.caseMode === "lower" ? "lowercase"
    : "none";

  stageMark.style.fontFamily = family;
  stageMark.style.letterSpacing = `${trackingInput.value}em`;
  stageMark.style.fontFeatureSettings = fft;

  // Detail panel title also uses the live font once it's loaded. The
  // glyph preview SVG is rasterized from the parsed font directly, so
  // it doesn't need the @font-face family.
  ssTitleEl.style.fontFamily = family;

  fitHeadline();
  if (state.outlineMode) renderStageOutline();
}

// -------- background + outline mode -------------------------------------

function setBackground(hex) {
  for (const btn of bgSwatchesEl.querySelectorAll(".bg-swatch")) {
    btn.classList.toggle("is-active", btn.dataset.bg === hex);
  }
  stagePanel.dataset.bg = BG_MAP[hex] || "white";
  if (state.outlineMode) renderStageOutline();
}

function setOutlineMode(mode) {
  const wasOutline = state.outlineMode;
  state.outlineMode = mode === "outline";
  for (const btn of outlineToggleEl.querySelectorAll(".ot-btn")) {
    btn.classList.toggle("is-active", btn.dataset.mode === mode);
  }
  stagePanel.dataset.mode = mode;
  document.documentElement.classList.toggle("outline-mode", state.outlineMode);

  if (state.outlineMode && !wasOutline) {
    // Entering outline mode — single letter, dark bg, 100% size,
    // sliders hidden.
    state.userSizeOverride = false;
    stageText.textContent = OUTLINE_DEFAULT_CHAR;
  } else if (!state.outlineMode && wasOutline) {
    // Leaving outline mode — reset solid-mode state to a fresh-load
    // baseline (text, leading, tracking, bg). Keeps the user's
    // current SS pill selections so they don't lose their context.
    stageText.textContent = REFRESH_TEXT;
    leadingInput.value = REFRESH_LEADING;
    trackingInput.value = REFRESH_TRACKING;
    state.userSizeOverride = false;
    setBackground(REFRESH_BG);
    stageOutlineEl.innerHTML = "";
  }

  applyTypography();
  refitStage();
  if (state.outlineMode) renderStageOutline();
}

// Build an SVG over the stage text with: the glyph path stroked,
// straight handle lines from each on-curve point to its bezier control
// points, small squares at control points (off-curve), and small
// circles at on-curve anchors. Paths come straight from opentype.js so
// the visualization stays in sync with the live font outline.
function renderStageOutline() {
  const ot = state.font?.parsed;
  if (!ot || !state.outlineMode) return;

  // Outline mode shows a single letter centred in the wrap box, so
  // measure the wrap (the full available panel area) rather than the
  // stage-text element which is only as tall as one line of text.
  const wrap = stageText.parentElement; // .stage-text-wrap
  const W = wrap.clientWidth;
  const H = wrap.clientHeight;
  if (W <= 0 || H <= 0) return;

  const cs = getComputedStyle(stageText);
  const fontSizePx = parseFloat(cs.fontSize);
  const lineHeightPx = cs.lineHeight === "normal"
    ? fontSizePx * 1.2
    : parseFloat(cs.lineHeight);
  const letterSpacingPx = parseFloat(cs.letterSpacing) || 0;
  const trackingEm = letterSpacingPx / fontSizePx;

  let text = stageText.textContent;
  const transform = cs.textTransform;
  if (transform === "uppercase") text = text.toUpperCase();
  else if (transform === "lowercase") text = text.toLowerCase();

  const lines = text.split("\n");

  const upm = ot.unitsPerEm;
  const os2 = ot.tables.os2 || {};
  const capUnits = os2.sCapHeight || ot.ascender;
  const xhUnits = os2.sxHeight || capUnits * 0.5;
  const descUnits = Math.abs(os2.sTypoDescender || ot.descender);
  // Match the browser's intra-line text positioning: the line box has
  // height lineHeightPx, with the font's ascender + descender centred
  // inside it. Half-leading is (lineHeightPx - emBoxPx) / 2.
  const ascenderEm = ot.ascender / upm;
  const descenderEm = -ot.descender / upm;
  const emBoxPx = (ascenderEm + descenderEm) * fontSizePx;
  const halfLeading = (lineHeightPx - emBoxPx) / 2;
  const ascenderPx = ascenderEm * fontSizePx;

  // Same array-form features as the glyph preview — list every
  // currently-on feature once.
  const featTags = [];
  for (const t of Object.keys(state.featureState)) {
    if (state.featureState[t]) featTags.push(t);
  }
  const features = [
    { script: "DFLT", tags: featTags },
    { script: "latn", tags: featTags },
  ];

  // Outline mode is always a single character — centre it in the
  // SVG box (horizontally + vertically by cap-height midpoint) and
  // place metric lines (cap / x-height / baseline / descender) at
  // their real font-metric offsets. Substitutions are resolved by
  // direct glyph-index lookup (the same trick as the SS glyph
  // preview); opentype.js's feature engine doesn't reliably apply
  // ss-substitutions on this font's CFF/post v3.0 setup.
  const allCommands = [];
  const metricLines = [];
  const overshootBands = [];
  const onlyChar = lines.length === 1 ? lines[0] : null;
  if (onlyChar) {
    let glyph = null;
    for (const tag of Object.keys(state.featureState)) {
      if (!state.featureState[tag]) continue;
      const subs = (state.ssLabels[tag] || {}).substitutions || {};
      if (typeof subs[onlyChar] === "number") {
        glyph = ot.glyphs.get(subs[onlyChar]);
        break;
      }
    }
    if (!glyph) glyph = ot.charToGlyph(onlyChar);

    const capPx = capUnits * fontSizePx / upm;
    const xhPx = xhUnits * fontSizePx / upm;
    const descPx = descUnits * fontSizePx / upm;
    const advancePx = (glyph.advanceWidth || 0) * fontSizePx / upm;
    const xOff = (W - advancePx) / 2;
    const baselineY = H / 2 + capPx / 2;
    metricLines.push(baselineY - capPx);   // cap line
    metricLines.push(baselineY - xhPx);    // x-height line
    metricLines.push(baselineY);           // baseline
    metricLines.push(baselineY + descPx);  // descender line

    // Overshoot bands — the small zones outside the metric lines
    // where round glyphs extend so they optically match flat ones.
    const ov = state.font && state.font.overshoots ? state.font.overshoots : null;
    if (ov) {
      const u2px = fontSizePx / upm;
      overshootBands.push({ y: baselineY - capPx - ov.cap * u2px, h: ov.cap * u2px });
      overshootBands.push({ y: baselineY - xhPx - ov.xh * u2px,  h: ov.xh * u2px });
      overshootBands.push({ y: baselineY,                         h: ov.baseline * u2px });
      overshootBands.push({ y: baselineY + descPx,                h: ov.descender * u2px });
    }

    const path = glyph.getPath(xOff, baselineY, fontSizePx);
    allCommands.push(...path.commands);
  } else {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const baselineY = i * lineHeightPx + halfLeading + ascenderPx;
      let path;
      try {
        path = ot.getPath(line, 0, baselineY, fontSizePx, {
          features, letterSpacing: trackingEm, kerning: true,
        });
      } catch (_) {
        path = ot.getPath(line, 0, baselineY, fontSizePx);
      }
      allCommands.push(...path.commands);
    }
  }

  // Build path d-attribute, collect on-curve anchors, and (for big
  // headlines) also collect bezier control points + handle segments.
  const dParts = [];
  const anchors = [];
  const ctrlPoints = [];
  const ctrlLines = [];
  let curX = 0;
  let curY = 0;
  const f = (n) => n.toFixed(2);

  for (const cmd of allCommands) {
    if (cmd.type === "M") {
      dParts.push(`M${f(cmd.x)},${f(cmd.y)}`);
      anchors.push({ x: cmd.x, y: cmd.y });
      curX = cmd.x; curY = cmd.y;
    } else if (cmd.type === "L") {
      dParts.push(`L${f(cmd.x)},${f(cmd.y)}`);
      anchors.push({ x: cmd.x, y: cmd.y });
      curX = cmd.x; curY = cmd.y;
    } else if (cmd.type === "C") {
      dParts.push(`C${f(cmd.x1)},${f(cmd.y1)} ${f(cmd.x2)},${f(cmd.y2)} ${f(cmd.x)},${f(cmd.y)}`);
      ctrlPoints.push({ x: cmd.x1, y: cmd.y1 });
      ctrlPoints.push({ x: cmd.x2, y: cmd.y2 });
      ctrlLines.push({ x1: curX, y1: curY, x2: cmd.x1, y2: cmd.y1 });
      ctrlLines.push({ x1: cmd.x2, y1: cmd.y2, x2: cmd.x, y2: cmd.y });
      anchors.push({ x: cmd.x, y: cmd.y });
      curX = cmd.x; curY = cmd.y;
    } else if (cmd.type === "Q") {
      dParts.push(`Q${f(cmd.x1)},${f(cmd.y1)} ${f(cmd.x)},${f(cmd.y)}`);
      ctrlPoints.push({ x: cmd.x1, y: cmd.y1 });
      ctrlLines.push({ x1: curX, y1: curY, x2: cmd.x1, y2: cmd.y1 });
      ctrlLines.push({ x1: cmd.x1, y1: cmd.y1, x2: cmd.x, y2: cmd.y });
      anchors.push({ x: cmd.x, y: cmd.y });
      curX = cmd.x; curY = cmd.y;
    } else if (cmd.type === "Z") {
      dParts.push("Z");
    }
  }

  // Constant pixel sizes — never scale with font size, so the outline
  // reads the same at 100px or 400px headlines. Bezier handles only
  // appear once the text is big enough that they wouldn't clutter.
  const anchorR = 3;
  const strokeW = 1.5;
  const handleStrokeW = 0.75;
  const ctrlSize = 4;
  const HANDLES_THRESHOLD = 200;
  const showHandles = fontSizePx >= HANDLES_THRESHOLD;

  // Outline mode is locked to the dark green bg — always use that
  // palette regardless of any data-bg the swatch trail left behind.
  const bg = state.outlineMode ? "dark" : (stagePanel.dataset.bg || "white");
  const palette = {
    white: {
      stroke: "#1CA84A",
      fill:   "rgba(28,168,74,0.10)",
      anchor: "#004C2B",
      metric: "#1CA84A",
      overshoot: "rgba(28,168,74,0.05)",   // 5% deep green
    },
    mint: {
      stroke: "#004C2B",
      fill:   "rgba(0,76,43,0.08)",
      anchor: "#004C2B",
      metric: "#004C2B",
      overshoot: "rgba(0,76,43,0.05)",
    },
    dark: {
      stroke: "#D7F394",
      fill:   "rgba(215,243,148,0.10)",
      anchor: "#FFFFFF",
      metric: "#D7F394",
      overshoot: "rgba(215,243,148,0.05)", // 5% mint on dark green
    },
  };
  const c = palette[bg] || palette.white;
  const strokeColor = c.stroke;
  const fillColor = c.fill;
  const anchorColor = c.anchor;
  const metricColor = c.metric;
  const overshootColor = c.overshoot;

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMinYMin meet">`);
  // Overshoot bands first (under everything), then metric lines, then
  // path stroke on top so the outline reads cleanly above them.
  for (const b of overshootBands) {
    if (b.h <= 0) continue;
    parts.push(`<rect x="0" y="${f(b.y)}" width="${W}" height="${f(b.h)}" fill="${overshootColor}"/>`);
  }
  for (const y of metricLines) {
    parts.push(`<line x1="0" y1="${f(y)}" x2="${W}" y2="${f(y)}" stroke="${metricColor}" stroke-width="1"/>`);
  }
  parts.push(`<path d="${dParts.join(" ")}" fill="${fillColor}" fill-rule="evenodd" stroke="${strokeColor}" stroke-width="${strokeW}" stroke-linejoin="round" stroke-linecap="round"/>`);
  if (showHandles) {
    for (const l of ctrlLines) {
      parts.push(`<line x1="${f(l.x1)}" y1="${f(l.y1)}" x2="${f(l.x2)}" y2="${f(l.y2)}" stroke="${anchorColor}" stroke-width="${handleStrokeW}"/>`);
    }
    const half = ctrlSize / 2;
    for (const p of ctrlPoints) {
      parts.push(`<rect x="${f(p.x - half)}" y="${f(p.y - half)}" width="${ctrlSize}" height="${ctrlSize}" fill="${anchorColor}"/>`);
    }
  }
  for (const a of anchors) {
    parts.push(`<circle cx="${f(a.x)}" cy="${f(a.y)}" r="${anchorR}" fill="${anchorColor}"/>`);
  }
  parts.push(`</svg>`);

  stageOutlineEl.innerHTML = parts.join("");
}

// -------- fit logic (kept from original; only the right panel needs it) -

function fitHeadline() {
  if (window.matchMedia("(max-width: 900px)").matches) {
    fitHeadlineMobile();
  } else {
    fitHeadlineDesktop();
  }
}

// Measure the available stage box (panel inner minus padding, minus
// the footer if it's currently visible).
function measureStageAvail() {
  const ps = getComputedStyle(stagePanel);
  const padT = parseFloat(ps.paddingTop) || 0;
  const padB = parseFloat(ps.paddingBottom) || 0;
  const minGap = parseFloat(ps.rowGap || ps.gap) || 0;
  const footerEl = stagePanel.querySelector(".stage-footer");
  const footerVisible = footerEl && getComputedStyle(footerEl).display !== "none";
  const footerH = footerVisible ? footerEl.offsetHeight : 0;
  const gapH = footerVisible ? minGap : 0;
  const wrap = stageText.parentElement;
  return {
    W: wrap.clientWidth,
    H: stagePanel.clientHeight - padT - padB - gapH - footerH,
  };
}

// Find the largest em the headline can be without overflowing the
// stage panel given the current text. Used to size the slider's
// real-time range so the entire slider track maps to a visible
// change in headline size.
function computeMaxFitEm() {
  const HARD_MAX = 200;
  const MIN = 4;
  const savedFs = stageText.style.fontSize;

  const fits = () => {
    void stageText.offsetHeight;
    const { W, H } = measureStageAvail();
    return stageText.scrollHeight <= H + 1
        && stageText.scrollWidth <= W + 1;
  };

  stageText.style.fontSize = `${HARD_MAX}em`;
  void stageText.offsetHeight;
  if (fits()) {
    stageText.style.fontSize = savedFs;
    return HARD_MAX;
  }

  let lo = MIN;
  let hi = HARD_MAX;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    stageText.style.fontSize = `${mid}em`;
    if (fits()) lo = mid;
    else hi = mid;
  }
  stageText.style.fontSize = savedFs;
  return lo;
}

// Recompute the slider range so it spans 4em → max-that-fits, then
// apply either the user's last value (clamped) or an auto-fit value
// for the current mode. Replaces the previous fitHeadlineDesktop +
// autoFitHeadlineSlider pair.
function refitStage() {
  if (window.matchMedia("(max-width: 900px)").matches) {
    fitHeadlineMobile();
    return;
  }
  const max = computeMaxFitEm();
  sizeInput.max = max.toFixed(1);

  const sliderMin = parseFloat(sizeInput.min) || 4;
  let value;
  if (state.userSizeOverride) {
    value = parseFloat(sizeInput.value) || max;
  } else {
    const fillRatio = state.outlineMode ? 1.0 : 0.95;
    value = max * fillRatio;
  }
  value = Math.min(max, Math.max(sliderMin, value));
  sizeInput.value = value.toFixed(1);

  stageText.style.fontSize = `${value}em`;
}

// Kept for the mobile branch only.
function fitHeadlineDesktop() {
  refitStage();
}
function autoFitHeadlineSlider() { /* handled inside refitStage */ }

function fitHeadlineMobile() {
  const panel = stageText.parentElement;
  if (!panel) return;

  stageText.style.fontSize = "16px";
  void stageText.offsetHeight;

  const pStyle = getComputedStyle(panel);
  const padT = parseFloat(pStyle.paddingTop) || 0;
  const padB = parseFloat(pStyle.paddingBottom) || 0;
  const availH = panel.clientHeight - padT - padB;
  const availW = stageText.clientWidth;

  if (!isFinite(availH) || !isFinite(availW) || availH <= 0 || availW <= 0) {
    return;
  }

  const fitsH = () => {
    void stageText.offsetHeight;
    return stageText.scrollWidth <= availW + 0.5;
  };
  const fitsV = () => {
    void stageText.offsetHeight;
    return stageText.scrollHeight <= availH + 0.5;
  };
  const fits = () => fitsH() && fitsV();

  const MIN = 16;
  const MAX = 260;

  if (!fits()) return;

  let lo = MIN;
  let hi = MAX;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    stageText.style.fontSize = `${mid}px`;
    if (fits()) lo = mid;
    else hi = mid;
  }
  stageText.style.fontSize = `${lo}px`;
}

function pickRandomString() {
  if (state.outlineMode) {
    // Outline mode: pick a random basic-Latin letter (or digit).
    const current = stageText.textContent;
    let next = current;
    for (let i = 0; i < 8 && next === current; i++) {
      next = BASIC_LETTERS.charAt(Math.floor(Math.random() * BASIC_LETTERS.length));
    }
    stageText.textContent = next;
    refitStage();
    renderStageOutline();
    return;
  }
  const current = stageText.textContent.trim();
  const pool = PRESETS.filter((s) => s !== current);
  const options = pool.length ? pool : PRESETS;
  const next = options[Math.floor(Math.random() * options.length)];
  stageText.textContent = next;
  refitStage();
}

// -------- init ----------------------------------------------------------

async function init() {
  renderCaseToggle();

  leadingInput.addEventListener("input", applyTypography);
  trackingInput.addEventListener("input", applyTypography);
  sizeInput.addEventListener("input", () => {
    state.userSizeOverride = true;
    // Slider value is already inside the dynamic range — just apply
    // it. Skipping the binary search keeps the drag responsive.
    const v = parseFloat(sizeInput.value) || 14.4;
    stageText.style.fontSize = `${v}em`;
    if (state.outlineMode) renderStageOutline();
  });
  randomBtn.addEventListener("click", pickRandomString);

  for (const btn of bgSwatchesEl.querySelectorAll(".bg-swatch")) {
    btn.addEventListener("click", () => setBackground(btn.dataset.bg));
  }
  for (const btn of outlineToggleEl.querySelectorAll(".ot-btn")) {
    btn.addEventListener("click", () => setOutlineMode(btn.dataset.mode));
  }
  setBackground("#FFFFFF");
  setOutlineMode("solid");

  // Block backspace/delete in outline mode — one letter must always
  // be on screen. (Replacing it via typing still works because that
  // path goes through input, not a destructive keydown.)
  stageText.addEventListener("keydown", (e) => {
    if (!state.outlineMode) return;
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
    }
  });

  stageText.addEventListener("input", () => {
    // In outline mode keep just the latest single character — and
    // never let the field go empty (defensive in case some other
    // path clears it).
    if (state.outlineMode) {
      const flat = stageText.textContent.replace(/\s+/g, "");
      if (flat.length === 0) {
        stageText.textContent = OUTLINE_DEFAULT_CHAR;
      } else if (flat.length > 1) {
        stageText.textContent = flat.charAt(flat.length - 1);
        const range = document.createRange();
        range.selectNodeContents(stageText);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } else if (flat.length !== stageText.textContent.length) {
        stageText.textContent = flat;
      }
    }
    if (!window.matchMedia("(max-width: 900px)").matches) {
      refitStage();
      if (state.outlineMode) renderStageOutline();
    }
  });
  window.addEventListener("resize", () => {
    if (!window.matchMedia("(max-width: 900px)").matches) {
      refitStage();
      if (state.outlineMode) renderStageOutline();
    }
  });

  await loadFont();

  // Initial focus = first available ss/cv feature.
  if (state.font.features.length) {
    state.focusedSS = state.font.features[0].tag;
    // Default ss features OFF so the headline reads "neutral" until
    // the user opts a set in.
    for (const feat of state.font.features) {
      if (state.featureState[feat.tag] === undefined) {
        state.featureState[feat.tag] = false;
      }
    }
  }

  renderSSPills();
  renderDetail();
  renderSwatches();
  // Pick a sensible initial headline size for the current panel
  // before the first applyTypography pass. fitHeadline still shrinks
  // from there if the text doesn't fit.
  autoFitHeadlineSlider();
  applyTypography();

  document.documentElement.classList.remove("loading");

  requestAnimationFrame(() => requestAnimationFrame(fitHeadline));
  setTimeout(fitHeadline, 150);
  setTimeout(fitHeadline, 500);
  window.addEventListener("load", fitHeadline, { once: true });

  let editing = false;
  stageText.addEventListener("focus", () => { editing = true; });
  stageText.addEventListener("blur", () => {
    editing = false;
    fitHeadline();
  });
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => {
      if (!editing) {
        refitStage();
        if (state.outlineMode) renderStageOutline();
      }
    });
    ro.observe(stagePanel);

    const ro2 = new ResizeObserver(() => renderGlyphPreview());
    ro2.observe(glyphPreviewEl);
  }
}

init().catch((err) => {
  console.error(err);
  stageText.textContent = "Failed to load font — see console.";
});
