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
  // "random" = preset type sample, "overview" = 6×9 letter grid,
  // "outline" = single-letter outline preview.
  stageMode: "random",
  outlineMode: false, // legacy alias kept in sync with stageMode==="outline"
  userSizeOverride: false, // true once the user moves the size slider
};

const GRID_LETTERS = "AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz.,";

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
const stageGridEl = $("stageGrid");
const overviewBtn = $("glyphOverview");
const featureDetailEl = document.querySelector(".feature-detail");
const presetPillsEl = $("presetPills");

// Three curated stylistic-set combinations + a "Custom" sentinel.
// Picking a preset turns its tags ON and every other ss/cv tag OFF.
// Touching any individual SS pill that diverges from a preset auto-
// switches the radio to "Custom".
const SS_PRESETS = [
  { label: "Preset 1", tags: ["ss01", "ss09", "ss14"] },
  { label: "Preset 2", tags: ["ss02", "ss03", "ss04", "ss05", "ss09", "ss11"] },
  { label: "Preset 3", tags: ["ss01", "ss06", "ss08", "ss09", "ss10"] },
];

// Outline-mode design tokens — finalised from the temporary tweaking
// panel. Mint-on-dark palette; thicker metrics + glyph stroke; white
// square anchors; small white circle handles with bolder lines.
const outlineDesign = {
  metricColor: "#d7f394",
  metricThickness: 2,
  metricOpacity: 1,
  glyphStroke: "#d7f394",
  glyphStrokeOpacity: 1,
  glyphThickness: 2,
  glyphFill: "#d7f394",
  glyphFillOpacity: 0.3,
  anchorColor: "#ffffff",
  anchorStyle: "square",
  anchorSize: 7,
  handleColor: "#ffffff",
  handleStyle: "circle",
  handleSize: 3.5,
  handleLineWidth: 2,
  handleOpacity: 1,
};

// Slot-swap runs transform and opacity as separate animations so each
// can have its own easing — opacity feels softer with ease-in-out
// while the transform uses asymmetric eases (ease-in on exit,
// ease-out on entry) for a punchier slide.
let detailXformAnim = null;
let detailOpacityAnim = null;

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

  // Probe the font for the ij / IJ ligatures so samples like ".,ij"
  // and "IJ ij r" render them as single glyphs rather than separate
  // i + j (or I + J). stringToGlyphs applies default OT features
  // (incl. liga), so a length-1 result means the ligature substituted.
  const probeLigature = (s) => {
    if (!parsed) return null;
    try {
      const r = parsed.stringToGlyphs(s);
      if (r && r.length === 1) return r[0];
    } catch (_) {}
    return null;
  };
  const ijGlyph = probeLigature("ij");
  const IJGlyph = probeLigature("IJ");

  state.font = { family, features, parsed, overshoots, ijGlyph, IJGlyph };

  // Auto-discover SS-specific variants of the ij / IJ ligatures
  // (e.g. i_j.ss10, I_J.ss14). For each ss/cv feature, walk its
  // single-substitution table — if it remaps a default ligature
  // glyph to a different one, that's the SS-styled variant. Stored
  // under the multi-char key in the labels JSON so the tokenizer in
  // renderGlyphPreview picks it up automatically.
  const discoverLigSub = (key, baseGlyph) => {
    if (!parsed || !parsed.substitution || !baseGlyph || typeof baseGlyph.index !== "number") return;
    const baseIdx = baseGlyph.index;
    for (const tag of Object.keys(state.ssLabels)) {
      if (!/^(ss|cv)\d\d$/.test(tag)) continue;
      let singleSubs;
      try { singleSubs = parsed.substitution.getSingle(tag); } catch (_) { continue; }
      if (!singleSubs || !singleSubs.length) continue;
      for (const entry of singleSubs) {
        if (entry && entry.sub === baseIdx && typeof entry.by === "number") {
          const meta = state.ssLabels[tag] = state.ssLabels[tag] || {};
          meta.substitutions = meta.substitutions || {};
          if (meta.substitutions[key] === undefined) {
            meta.substitutions[key] = entry.by;
          }
          break;
        }
      }
    }
  };
  discoverLigSub("ij", ijGlyph);
  discoverLigSub("IJ", IJGlyph);

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
        const tokens = tokenizeSample(sample, subs, useSubs);
        for (const tk of tokens) {
          const g = resolveTokenGlyph(parsed, subs, useSubs, tk);
          t += (g && g.advanceWidth) || 0;
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

// Read the active-SS list from the URL hash. Format: "#ss01,ss05,cv01"
// (raw tag list, no key=value prefix). Tags that aren't valid ss/cv
// IDs are filtered out at the consumer.
function readHashState() {
  const raw = (window.location.hash || "").replace(/^#/, "");
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^(ss|cv)\d\d$/.test(s));
}

// Write the active-SS list back to the URL hash so the link is
// shareable. replaceState (not pushState / location.hash =) keeps
// the back button uncluttered as the user toggles pills.
function writeHashState() {
  if (!state.font) return;
  const onTags = state.font.features
    .filter((f) => state.featureState[f.tag])
    .map((f) => f.tag);
  const newHash = onTags.length ? `#${onTags.join(",")}` : "";
  const url = newHash || (window.location.pathname + window.location.search);
  if (window.location.hash !== newHash) {
    history.replaceState(null, "", url);
  }
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

// Toggle-switch icon (active vs inactive variant). Knob position
// flips so the switch reads visually as on/off; colors are baked in
// via the `track` class so CSS can re-skin them.
function ssPillIcon(active) {
  const cx = active ? 13 : 6;
  return `
    <svg class="ss-pill__icon" viewBox="0 0 19 12" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect class="track" width="19" height="12" rx="6"/>
      <circle class="knob" cx="${cx}" cy="6" r="4"/>
    </svg>`;
}

// Compare current featureState against the curated presets; return
// the matching preset's index or -1 if the combo is "Custom".
function activePresetIndex() {
  const onTags = new Set();
  for (const k of Object.keys(state.featureState)) {
    if (state.featureState[k] && /^(ss|cv)\d\d$/.test(k)) onTags.add(k);
  }
  for (let i = 0; i < SS_PRESETS.length; i++) {
    const tags = SS_PRESETS[i].tags;
    if (tags.length !== onTags.size) continue;
    if (tags.every((t) => onTags.has(t))) return i;
  }
  return -1;
}

function applyPreset(idx) {
  if (!state.font) return;
  const onSet = new Set(idx === -1 ? [] : SS_PRESETS[idx].tags);
  for (const feat of state.font.features) {
    state.featureState[feat.tag] = onSet.has(feat.tag);
  }
  // Focus the first active pill (in feature order) so the detail
  // panel lands somewhere meaningful instead of leaving the old SS
  // detail showing an OFF state.
  if (onSet.size) {
    const first = state.font.features.find((f) => onSet.has(f.tag));
    if (first) state.focusedSS = first.tag;
  }
  writeHashState();
  renderPresetPills();
  renderSSPills();
  renderDetail();
  applyTypography({ preserve: true });
  if (state.outlineMode) {
    refitStage();
    renderStageOutline();
  } else if (state.stageMode === "overview") {
    renderStageGrid();
  }
}

function renderPresetPills() {
  if (!presetPillsEl) return;
  if (presetPillsEl.childElementCount !== SS_PRESETS.length + 1) {
    presetPillsEl.innerHTML = "";
    SS_PRESETS.forEach((preset, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "preset-pill";
      btn.dataset.idx = String(i);
      btn.innerHTML = `<span class="preset-pill__indicator"></span><span>${preset.label}</span>`;
      btn.addEventListener("click", () => applyPreset(i));
      presetPillsEl.appendChild(btn);
    });
    const custom = document.createElement("button");
    custom.type = "button";
    custom.className = "preset-pill preset-pill--custom";
    custom.dataset.idx = "-1";
    custom.innerHTML = `<span class="preset-pill__indicator"></span><span>Custom</span>`;
    custom.addEventListener("click", () => applyPreset(-1));
    presetPillsEl.appendChild(custom);
  }
  const activeIdx = activePresetIndex();
  for (const btn of presetPillsEl.children) {
    const idx = parseInt(btn.dataset.idx, 10);
    btn.classList.toggle("is-active", idx === activeIdx);
  }
}

function renderSSPills() {
  if (!state.font) return;
  const features = state.font.features;

  // Build the pills once. Subsequent calls only sync state on the
  // existing DOM nodes — re-creating them every click would replace
  // the toggle SVG mid-animation and CSS transitions would never fire.
  if (ssPillsEl.childElementCount !== features.length) {
    ssPillsEl.innerHTML = "";
    for (const feat of features) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ss-pill";
      btn.title = feat.tag;
      btn.dataset.tag = feat.tag;
      btn.innerHTML = `${ssPillIcon(false)}<span>${feat.label}</span>`;
      btn.addEventListener("click", () => onSSToggle(feat));
      ssPillsEl.appendChild(btn);
    }
  }

  // Sync active state + knob position without touching the DOM tree.
  for (const btn of ssPillsEl.children) {
    const tag = btn.dataset.tag;
    const active = !!state.featureState[tag];
    btn.classList.toggle("is-active", active);
    const knob = btn.querySelector(".knob");
    if (knob) knob.setAttribute("cx", active ? 13 : 6);
  }
}

function onSSToggle(feat) {
  const wasFocused = state.focusedSS;
  state.featureState[feat.tag] = !state.featureState[feat.tag];
  state.focusedSS = feat.tag;
  writeHashState();
  // The combo just changed — re-evaluate which preset (or Custom) is
  // active and update the radio row.
  renderPresetPills();
  // In outline mode, jump the preview letter to this SS's sample so
  // the toggle is immediately visible (e.g. clicking "Spurless G"
  // shows the G, "Crossed t" shows the t).
  if (state.outlineMode) {
    const meta = state.ssLabels[feat.tag] || {};
    const sample = (meta.sample || "").trim();
    if (sample) stageText.textContent = sample.charAt(0);
  }
  renderSSPills();
  // preserve: keep the current font size — different SS variants
  // have slightly different metrics and the auto-fit would otherwise
  // nudge the headline up or down by a few percent on every toggle.
  applyTypography({ preserve: true });

  const changedSS = wasFocused && wasFocused !== feat.tag;
  if (changedSS) {
    swapDetailWithSlide(wasFocused, feat.tag);
  } else {
    renderDetail();
  }

  if (state.outlineMode) {
    refitStage();
    renderStageOutline();
  } else if (state.stageMode === "overview") {
    renderStageGrid();
  }
}

// Slot-style swap: the current detail card slides out, and once it's
// gone the new one slides in from the opposite edge. Direction follows
// the SS feature order so clicking a later set slides up, earlier
// slides down — gives the row a felt sense of position.
function swapDetailWithSlide(fromTag, toTag) {
  if (!featureDetailEl) {
    renderDetail();
    return;
  }
  const features = state.font.features;
  const fromIdx = features.findIndex((f) => f.tag === fromTag);
  const toIdx = features.findIndex((f) => f.tag === toTag);
  const goesUp = toIdx > fromIdx;
  const outY = goesUp ? "-100%" : "100%";
  const inY = goesUp ? "100%" : "-100%";

  // Cancel any in-flight slot animations so a rapid click doesn't
  // leave one of the two parallel tracks finished while the other
  // runs (which would visually "freeze" the element half-faded).
  cancelDetailAnims();

  // OUT: transform with ease-in (anticipates exit), opacity with
  // ease-in-out so the fade reads as a gentle dissolve, not a clip.
  detailXformAnim = featureDetailEl.animate(
    [{ transform: "translateY(0)" }, { transform: `translateY(${outY})` }],
    { duration: 200, easing: "cubic-bezier(0.55, 0, 0.85, 0.4)", fill: "forwards" },
  );
  detailOpacityAnim = featureDetailEl.animate(
    [{ opacity: 1 }, { opacity: 0 }],
    { duration: 220, easing: "ease-in-out", fill: "forwards" },
  );

  detailXformAnim.onfinish = () => {
    cancelDetailAnims();
    renderDetail();
    // IN: transform with ease-out (lands softly), opacity again
    // ease-in-out and slightly longer than the transform so the
    // text resolves a beat after it arrives.
    detailXformAnim = featureDetailEl.animate(
      [{ transform: `translateY(${inY})` }, { transform: "translateY(0)" }],
      { duration: 240, easing: "cubic-bezier(0.2, 0.6, 0.3, 1)", fill: "forwards" },
    );
    detailOpacityAnim = featureDetailEl.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      { duration: 280, easing: "ease-in-out", fill: "forwards" },
    );
  };
}

function cancelDetailAnims() {
  if (detailXformAnim) detailXformAnim.cancel();
  if (detailOpacityAnim) detailOpacityAnim.cancel();
  detailXformAnim = null;
  detailOpacityAnim = null;
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
      // preserve: case swap changes letter widths too — keep size stable.
      applyTypography({ preserve: true });
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

// Multi-char tokens to look for ahead of single-char rendering. The
// Dutch "ij" / "IJ" ligatures are common asks; SS substitution maps
// with length-2+ keys also flow through.
const DEFAULT_MULTI_TOKENS = ["IJ", "ij"];

function tokenizeSample(sample, subs, useSubs) {
  const keys = new Set(DEFAULT_MULTI_TOKENS);
  if (useSubs) {
    for (const k of Object.keys(subs)) {
      if (k.length > 1) keys.add(k);
    }
  }
  const sorted = [...keys].sort((a, b) => b.length - a.length);

  const tokens = [];
  for (let i = 0; i < sample.length; ) {
    let matched = null;
    for (const k of sorted) {
      if (sample.startsWith(k, i)) { matched = k; break; }
    }
    if (matched) {
      tokens.push(matched);
      i += matched.length;
    } else {
      tokens.push(sample[i]);
      i++;
    }
  }
  return tokens;
}

function resolveTokenGlyph(ot, subs, useSubs, token) {
  // SS-specific substitution (single or multi-char key) wins.
  if (useSubs && typeof subs[token] === "number") {
    return ot.glyphs.get(subs[token]);
  }
  if (token.length === 1) {
    return ot.charToGlyph(token);
  }
  // Default ij / IJ ligatures probed at font load.
  if (token === "ij" && state.font && state.font.ijGlyph) {
    return state.font.ijGlyph;
  }
  if (token === "IJ" && state.font && state.font.IJGlyph) {
    return state.font.IJGlyph;
  }
  // Generic multi-char fallback: ask opentype.js to apply default
  // features (incl. liga) and use the result if it collapsed to a
  // single glyph; otherwise return the first char's glyph.
  try {
    const probe = ot.stringToGlyphs(token);
    if (probe && probe.length === 1) return probe[0];
  } catch (_) {}
  return ot.charToGlyph(token[0]);
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

  // Use the WIDEST sample across all SSes for the W-constraint, so
  // every SS renders at the same vertical scale even though different
  // samples take different horizontal space.
  const maxAdvanceUnits = state.maxSampleAdvanceUnits || upm;

  // Pick the smaller scale so the widest possible glyph fits both
  // width and height of the cell. Include cap/descender overshoots
  // in the height budget and pad the width slightly so glyph
  // shapes that extend past their advance (e.g. j's tail) and past
  // the metric lines (e.g. g's bowl) don't relyon SVG overflow:
  // visible — overflow gets clipped mid-animation by the browser's
  // composited layer and the bits "pop in" once the transform clears.
  const ov = (state.font && state.font.overshoots) || { cap: 0, descender: 0 };
  const visualHeightUnits = cap + desc + (ov.cap || 0) + (ov.descender || 0);
  const scaleByH = H / visualHeightUnits;
  const scaleByW = (W * 0.85) / maxAdvanceUnits;
  const scale = Math.min(scaleByH, scaleByW);
  const fontSize = scale * upm;

  // Tokenize so multi-char units (e.g. "ij" → ij ligature) collapse
  // to a single glyph. Per-token resolution then picks: SS-specific
  // substitution → font's default ligature → single-char fallback.
  const tokens = tokenizeSample(sample, subs, isOn);

  // Compute the actual advance for THIS sample (for centring only).
  let totalAdvanceUnits = 0;
  const sampleGlyphs = tokens.map((tk) => resolveTokenGlyph(ot, subs, isOn, tk));
  for (const g of sampleGlyphs) {
    totalAdvanceUnits += (g && g.advanceWidth) || 0;
  }
  if (totalAdvanceUnits <= 0) totalAdvanceUnits = upm;

  // Centre vertically — visualH covers cap-overshoot peak through
  // descender-overshoot trough so nothing the glyph paints sits
  // outside the SVG box.
  const visualH = visualHeightUnits * scale;
  const yOff = (H - visualH) / 2;
  const capY = yOff + (ov.cap || 0) * scale + 0.5;
  const xY = capY + (cap - xh) * scale;
  const baselineY = capY + cap * scale;
  const descenderY = baselineY + desc * scale - 0.5;

  // Glyph preview mirrors the live toggle state — variant when the SS
  // is on, default form when it's off. Tokens (single chars or
  // multi-char ligatures like "ij") each render as one glyph.
  const totalAdvance = totalAdvanceUnits * scale;
  let xOff = (W - totalAdvance) / 2;

  const pathPieces = [];
  for (const g of sampleGlyphs) {
    if (!g) continue;
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

function applyTypography(opts = {}) {
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

  // Glyph overview cells inherit the live font so SS toggles update the
  // grid in real time.
  if (stageGridEl) {
    stageGridEl.style.fontFamily = family;
    stageGridEl.style.fontFeatureSettings = fft;
  }

  // Detail panel title also uses the live font once it's loaded. The
  // glyph preview SVG is rasterized from the parsed font directly, so
  // it doesn't need the @font-face family.
  ssTitleEl.style.fontFamily = family;

  fitHeadline(opts);
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

// Three-way stage mode: "random" (preset type sample), "overview"
// (6×9 letter grid), or "outline" (single-letter outline preview).
// Keeps state.outlineMode in sync as a legacy alias for the rest of
// the file that still reads it.
function setStageMode(mode) {
  const wasOutline = state.stageMode === "outline";
  state.stageMode = mode;
  state.outlineMode = mode === "outline";

  // Update mode-pill active states (Random / Glyph Overview).
  randomBtn.classList.toggle("is-active", mode === "random");
  overviewBtn.classList.toggle("is-active", mode === "overview");
  // Outline-toggle: solid btn = any non-outline mode, outline btn = outline.
  for (const btn of outlineToggleEl.querySelectorAll(".ot-btn")) {
    const isOutlineBtn = btn.dataset.mode === "outline";
    btn.classList.toggle("is-active", isOutlineBtn ? mode === "outline" : mode !== "outline");
  }

  // Drive mode-specific stage CSS (background, hidden sections).
  stagePanel.dataset.mode = mode;
  document.documentElement.classList.toggle("outline-mode", mode === "outline");
  document.documentElement.classList.toggle("overview-mode", mode === "overview");

  if (mode === "outline" && !wasOutline) {
    // Entering outline mode — single letter, dark bg, 100% size,
    // sliders hidden.
    state.userSizeOverride = false;
    stageText.textContent = OUTLINE_DEFAULT_CHAR;
  } else if (mode !== "outline" && wasOutline) {
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
  if (mode === "outline") renderStageOutline();
  if (mode === "overview") renderStageGrid();
}

// Legacy entry-point used by the outline-toggle solid/outline buttons —
// "solid" returns to the random preset mode (the previous default).
function setOutlineMode(mode) {
  setStageMode(mode === "outline" ? "outline" : "random");
}

// Build the 6×9 grid of glyph cells for Glyph Overview mode. The grid
// is static markup; the live font features apply through inherited
// font-feature-settings + font-family on each cell.
function renderStageGrid() {
  if (!stageGridEl) return;
  if (stageGridEl.childElementCount === GRID_LETTERS.length) {
    // Already built — just refresh font features (handled by applyTypography).
    return;
  }
  stageGridEl.innerHTML = "";
  for (const ch of GRID_LETTERS) {
    const cell = document.createElement("div");
    cell.className = "stage-grid__cell";
    cell.textContent = ch;
    stageGridEl.appendChild(cell);
  }
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

    const ov = (state.font && state.font.overshoots) || { cap: 0, xh: 0, baseline: 0, descender: 0 };
    const u2px = fontSizePx / upm;
    const capPx = capUnits * u2px;
    const xhPx = xhUnits * u2px;
    const descPx = descUnits * u2px;
    const capOvPx = ov.cap * u2px;
    const descOvPx = ov.descender * u2px;
    const advancePx = (glyph.advanceWidth || 0) * u2px;
    const xOff = (W - advancePx) / 2;
    // Centre by the VISUAL extent (cap-overshoot top → descender-
    // overshoot bottom) so the rendered letter has equal padding
    // above and below regardless of where the typographic baseline
    // sits relative to the cap midpoint.
    const visualH = capPx + descPx + capOvPx + descOvPx;
    const visualTop = (H - visualH) / 2;
    const baselineY = visualTop + capOvPx + capPx;
    metricLines.push(baselineY - capPx);   // cap line
    metricLines.push(baselineY - xhPx);    // x-height line
    metricLines.push(baselineY);           // baseline
    metricLines.push(baselineY + descPx);  // descender line

    // Overshoot bands — the small zones outside the metric lines
    // where round glyphs extend so they optically match flat ones.
    overshootBands.push({ y: baselineY - capPx - capOvPx, h: capOvPx });
    overshootBands.push({ y: baselineY - xhPx - ov.xh * u2px, h: ov.xh * u2px });
    overshootBands.push({ y: baselineY,                       h: ov.baseline * u2px });
    overshootBands.push({ y: baselineY + descPx,              h: descOvPx });

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

  // Sizes / colors live in outlineDesign so the design panel can
  // tweak them at runtime. fontSize gate keeps handles from cluttering
  // tiny text.
  const HANDLES_THRESHOLD = 200;
  const showHandles = fontSizePx >= HANDLES_THRESHOLD;

  const fillColor = rgba(outlineDesign.glyphFill, outlineDesign.glyphFillOpacity);
  const strokeColor = outlineDesign.glyphStroke;
  const strokeOpacity = outlineDesign.glyphStrokeOpacity;
  const strokeW = outlineDesign.glyphThickness;
  const metricColor = outlineDesign.metricColor;
  const metricThickness = outlineDesign.metricThickness;
  const metricOpacity = outlineDesign.metricOpacity;
  const anchorColor = outlineDesign.anchorColor;
  const anchorR = outlineDesign.anchorSize;
  const handleColor = outlineDesign.handleColor;
  const handleOpacity = outlineDesign.handleOpacity;
  const handleStrokeW = outlineDesign.handleLineWidth;
  const ctrlSize = outlineDesign.handleSize;
  // Overshoot bands always render in the same hue family as the
  // metric lines, with a small 5% alpha for the band.
  const overshootColor = rgba(outlineDesign.metricColor, 0.05);

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMinYMin meet">`);
  // Overshoot bands first (under everything), then metric lines, then
  // path stroke on top so the outline reads cleanly above them.
  for (const b of overshootBands) {
    if (b.h <= 0) continue;
    parts.push(`<rect x="0" y="${f(b.y)}" width="${W}" height="${f(b.h)}" fill="${overshootColor}"/>`);
  }
  for (const y of metricLines) {
    parts.push(`<line x1="0" y1="${f(y)}" x2="${W}" y2="${f(y)}" stroke="${metricColor}" stroke-width="${metricThickness}" stroke-opacity="${metricOpacity}"/>`);
  }
  parts.push(`<path d="${dParts.join(" ")}" fill="${fillColor}" fill-rule="evenodd" stroke="${strokeColor}" stroke-opacity="${strokeOpacity}" stroke-width="${strokeW}" stroke-linejoin="round" stroke-linecap="round"/>`);
  if (showHandles) {
    parts.push(`<g opacity="${handleOpacity}">`);
    for (const l of ctrlLines) {
      parts.push(`<line x1="${f(l.x1)}" y1="${f(l.y1)}" x2="${f(l.x2)}" y2="${f(l.y2)}" stroke="${handleColor}" stroke-width="${handleStrokeW}"/>`);
    }
    for (const p of ctrlPoints) {
      parts.push(handleShape(outlineDesign.handleStyle, p.x, p.y, ctrlSize, handleColor));
    }
    parts.push(`</g>`);
  }
  for (const a of anchors) {
    parts.push(handleShape(outlineDesign.anchorStyle, a.x, a.y, anchorR, anchorColor));
  }
  parts.push(`</svg>`);

  stageOutlineEl.innerHTML = parts.join("");
}

// Build an SVG marker (anchor or off-curve handle) at (cx, cy) with
// pixel size `size`. Square uses size as edge length; circle uses
// size as radius; diamond uses size as half-diagonal.
function handleShape(style, cx, cy, size, color) {
  const f = (n) => n.toFixed(2);
  if (style === "square") {
    const half = size / 2;
    return `<rect x="${f(cx - half)}" y="${f(cy - half)}" width="${f(size)}" height="${f(size)}" fill="${color}"/>`;
  }
  if (style === "diamond") {
    return `<polygon points="${f(cx)},${f(cy - size)} ${f(cx + size)},${f(cy)} ${f(cx)},${f(cy + size)} ${f(cx - size)},${f(cy)}" fill="${color}"/>`;
  }
  // circle (default)
  return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(size)}" fill="${color}"/>`;
}

function rgba(hex, alpha) {
  const h = (hex || "#000000").replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${alpha})`;
}

// -------- fit logic (kept from original; only the right panel needs it) -

function fitHeadline(opts = {}) {
  if (window.matchMedia("(max-width: 900px)").matches) {
    fitHeadlineMobile();
  } else {
    refitStage(opts);
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
    // No tolerance on the upper bound — the slider max value gets
    // applied directly, so any +1px slack here means the slider's
    // ceiling overflows the panel by a hair. Be strict.
    return stageText.scrollHeight <= H && stageText.scrollWidth <= W;
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
//
// `opts.preserve`: when true, keep the current slider value (only
// shrink it if it now exceeds max). Used by SS / case toggles so
// width-changing feature swaps don't nudge the headline size.
function refitStage(opts = {}) {
  const preserve = !!opts.preserve;
  if (window.matchMedia("(max-width: 900px)").matches) {
    fitHeadlineMobile();
    return;
  }

  // Overview mode: the grid sizes itself via CSS grid + flex, no
  // headline fit needed.
  if (state.stageMode === "overview") return;

  // Outline mode: bypass the line-height-based fit. Size the glyph
  // by REAL font metrics (cap + descender + overshoots) so the
  // visible letter — including its descender bowl — sits inside the
  // panel with padding above and below instead of running flush to
  // the bottom edge.
  if (state.outlineMode) {
    const ot = state.font && state.font.parsed;
    const ov = state.font && state.font.overshoots;
    if (ot && ov) {
      const upm = ot.unitsPerEm;
      const os2 = ot.tables.os2 || {};
      const capUnits = os2.sCapHeight || ot.ascender;
      const descUnits = Math.abs(os2.sTypoDescender || ot.descender);
      const visualUnits = capUnits + descUnits + ov.cap + ov.descender;

      const { H } = measureStageAvail();
      const baseFontSize = parseFloat(getComputedStyle(stagePanel).fontSize) || 10;
      // 90% fill = 5% padding above the cap-overshoot, 5% below the descender-overshoot.
      const fillRatio = 0.9;
      const fontSizePx = (H * fillRatio * upm) / visualUnits;
      const fontSizeEm = fontSizePx / baseFontSize;

      sizeInput.max = fontSizeEm.toFixed(1);
      sizeInput.value = fontSizeEm.toFixed(1);
      stageText.style.fontSize = `${fontSizeEm}em`;
      return;
    }
  }

  const max = computeMaxFitEm();
  sizeInput.max = max.toFixed(1);

  const sliderMin = parseFloat(sizeInput.min) || 4;
  let value;
  if (preserve || state.userSizeOverride) {
    value = parseFloat(sizeInput.value) || max;
  } else {
    const fillRatio = 0.95;
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
  randomBtn.addEventListener("click", () => {
    // Clicking Random always randomizes the type sample. If we're in
    // a different stage mode (overview/outline), switch back to random
    // first — then randomize on the next user click.
    if (state.stageMode !== "random") {
      setStageMode("random");
      pickRandomString();
    } else {
      pickRandomString();
    }
  });
  overviewBtn.addEventListener("click", () => {
    if (state.stageMode !== "overview") setStageMode("overview");
  });

  for (const btn of bgSwatchesEl.querySelectorAll(".bg-swatch")) {
    btn.addEventListener("click", () => setBackground(btn.dataset.bg));
  }
  for (const btn of outlineToggleEl.querySelectorAll(".ot-btn")) {
    btn.addEventListener("click", () => setOutlineMode(btn.dataset.mode));
  }
  setBackground("#FFFFFF");
  setStageMode("random");

  // Block backspace/delete in outline mode — one letter must always
  // be on screen. (Replacing it via typing still works because that
  // path goes through input, not a destructive keydown.)
  stageText.addEventListener("keydown", (e) => {
    if (!state.outlineMode) return;
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
    }
  });

  // In outline mode, intercept typing anywhere on the page so the
  // user doesn't have to click into the (transparent) stage-text
  // first. Any printable single-character key replaces the preview;
  // backspace/delete are silently swallowed; modifier combos and
  // navigation keys (Tab, Shift, arrows) pass through.
  document.addEventListener("keydown", (e) => {
    if (!state.outlineMode) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      return;
    }
    if (e.key.length !== 1) return;
    e.preventDefault();
    stageText.textContent = e.key;
    refitStage();
    renderStageOutline();
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
    // Apply any active SS tags from the URL hash so a shared link
    // restores the sender's exact toggle state.
    const validTags = new Set(state.font.features.map((f) => f.tag));
    const hashTags = readHashState().filter((t) => validTags.has(t));
    if (hashTags.length) {
      for (const tag of hashTags) state.featureState[tag] = true;
      state.focusedSS = hashTags[0];
    }
  }

  renderPresetPills();
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
