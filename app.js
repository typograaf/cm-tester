// CM Typeface Tester
// Loads 5 CM explorations, auto-discovers OpenType features from the active
// font, exposes leading/tracking sliders, a case toggle, and a random-string
// picker.

import opentype from "https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/+esm";

// -------- config ---------------------------------------------------------

const EXPLORATIONS = [
  { id: 1, label: "Actief",   file: "fonts/CM_1_260414-Bold.otf"  },
  { id: 2, label: "Gezond",   file: "fonts/CM_2_260414d-Bold.otf" },
  { id: 3, label: "Stable",   file: "fonts/CM_3_260414-Bold.otf"  },
  { id: 4, label: "Solidair", file: "fonts/CM_4_260413c-Bold.otf" },
  { id: 5, label: "Zorg",     file: "fonts/CM_5_260414g-Bold.otf" },
];

const PRESETS = [
  "Leef gerust\nwat meer.",
  "Leef gerust\nwat losser.",
  "Leef gerust\niets te wild.",
  "Leef gerust\nzonder bang\nte zijn om op\nje gezicht\nte gaan.",
];

const CASE_MODES = [
  { id: "upper", label: "TT", transform: "uppercase" },
  { id: "lower", label: "tt", transform: "lowercase" },
];

// Hard-coded labels. Takes precedence over UI names in the font's name table.
const FEATURE_LABELS = {
  ss01: "alt A",
  ss02: "alt E",
  ss03: "alt IJ",
  ss04: "alt MNU",
  ss05: "alt Oo",
  ss06: "alt MmNnUu",
  liga: "Ligatures",
  dlig: "Disc. Ligatures",
  clig: "Context. Ligatures",
  salt: "Stylistic Alt.",
  smcp: "Small Caps",
  c2sc: "Caps to Small",
  onum: "Oldstyle Figs",
  lnum: "Lining Figs",
  tnum: "Tabular Figs",
  pnum: "Prop. Figs",
  frac: "Fractions",
  sups: "Superscript",
  subs: "Subscript",
  zero: "Slashed Zero",
  ordn: "Ordinals",
  case: "Case Sensitive",
  locl: "Localized",
};

// Features hidden from the toggle row — on by default or not useful here
const HIDDEN_DEFAULTS = new Set(["kern", "calt", "rlig", "ccmp", "mark", "mkmk", "aalt", "locl"]);

// Features that should start toggled ON
const DEFAULT_ON_FEATURES = new Set(["liga", "dlig"]);

// -------- state ----------------------------------------------------------

const state = {
  activeExp: 1,
  caseMode: null, // null = as typed
  featureState: Object.fromEntries([...DEFAULT_ON_FEATURES].map((t) => [t, true])),
  loaded: new Map(), // id -> { family, features }
};

// -------- DOM refs -------------------------------------------------------

const $ = (id) => document.getElementById(id);
const explorationsEl = $("explorations");
const explorationsSelectEl = $("explorationsSelect");
const caseToggleEl = $("caseToggle");
const featuresEl = $("features");
const stageText = $("stageText");
const stageMark = $("stageMark");
const leadingInput = $("leading");
const trackingInput = $("tracking");
const sizeInput = $("fontsize");
const randomBtn = $("randomString");

// -------- font loading --------------------------------------------------

async function loadFont(exp) {
  if (state.loaded.has(exp.id)) return state.loaded.get(exp.id);

  const res = await fetch(exp.file);
  if (!res.ok) throw new Error(`failed to fetch ${exp.file}`);
  const buf = await res.arrayBuffer();

  const family = `CM-${exp.id}`;
  const fontFace = new FontFace(family, buf, {
    weight: "700",
    style: "normal",
    display: "block", // don't paint with fallback while CM is loading
  });
  await fontFace.load();
  document.fonts.add(fontFace);
  // Wait for the browser's internal font metrics to settle before
  // fitHeadline measures widths.
  await document.fonts.ready;
  // Force the font to actually be rasterized at a sample size so the
  // canvas-based measurements pick it up (critical on iOS Safari).
  try {
    await document.fonts.load(`700 100px "${family}"`);
  } catch (_) {}

  let features = [];
  try {
    const font = opentype.parse(buf);
    features = discoverFeatures(font);
  } catch (err) {
    console.warn(`feature discovery failed for ${exp.file}:`, err);
  }

  const record = { family, features };
  state.loaded.set(exp.id, record);
  return record;
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

  const nameLookup = buildNameLookup(font);

  const out = [];
  for (const tag of tags) {
    if (HIDDEN_DEFAULTS.has(tag)) continue;
    out.push({ tag, label: labelForTag(tag, gsub, nameLookup) });
  }

  out.sort((a, b) => {
    const aSS = /^ss(\d+)$/.exec(a.tag);
    const bSS = /^ss(\d+)$/.exec(b.tag);
    if (aSS && bSS) return parseInt(aSS[1]) - parseInt(bSS[1]);
    if (aSS) return -1;
    if (bSS) return 1;
    return a.tag.localeCompare(b.tag);
  });

  return out;
}

function buildNameLookup(font) {
  const map = new Map();
  const raw = font.tables.name;
  if (raw && typeof raw === "object") {
    for (const key of Object.keys(raw)) {
      const entry = raw[key];
      if (!entry) continue;
      const val = typeof entry === "string" ? entry : entry.en || Object.values(entry)[0];
      if (val) map.set(String(key), val);
    }
  }
  return map;
}

function labelForTag(tag, gsub, nameLookup) {
  // Hard-coded labels win
  if (FEATURE_LABELS[tag]) return FEATURE_LABELS[tag];
  // Otherwise try the font's UI name table for stylistic sets
  if (/^ss\d\d$/.test(tag)) {
    const feat = (gsub?.features || []).find((f) => f && f.tag === tag);
    const nameID = feat?.feature?.params?.uiLabelNameID;
    if (nameID && nameLookup.has(String(nameID))) {
      return nameLookup.get(String(nameID));
    }
    return tag.toUpperCase();
  }
  if (/^cv\d\d$/.test(tag)) return tag.toUpperCase();
  return tag;
}

// -------- render --------------------------------------------------------

function renderExplorations() {
  // Desktop: pill buttons
  explorationsEl.innerHTML = "";
  for (const exp of EXPLORATIONS) {
    const btn = document.createElement("button");
    btn.textContent = exp.label;
    btn.title = `Exploration ${exp.id}`;
    btn.classList.toggle("is-active", exp.id === state.activeExp);
    btn.addEventListener("click", () => setExploration(exp.id));
    explorationsEl.appendChild(btn);
  }

  // Mobile: native <select>. Rebuild options and sync selection.
  if (explorationsSelectEl.options.length !== EXPLORATIONS.length) {
    explorationsSelectEl.innerHTML = "";
    for (const exp of EXPLORATIONS) {
      const opt = document.createElement("option");
      opt.value = String(exp.id);
      opt.textContent = exp.label;
      explorationsSelectEl.appendChild(opt);
    }
    explorationsSelectEl.addEventListener("change", (e) => {
      setExploration(parseInt(e.target.value, 10));
    });
  }
  explorationsSelectEl.value = String(state.activeExp);
}

function renderCaseToggle() {
  caseToggleEl.innerHTML = "";
  for (const mode of CASE_MODES) {
    const btn = document.createElement("button");
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

function renderFeatures() {
  const record = state.loaded.get(state.activeExp);
  featuresEl.innerHTML = "";
  if (!record || !record.features.length) return;

  for (const feat of record.features) {
    const btn = document.createElement("button");
    btn.textContent = feat.label;
    btn.title = feat.tag;
    btn.classList.toggle("is-on", !!state.featureState[feat.tag]);
    btn.addEventListener("click", () => {
      state.featureState[feat.tag] = !state.featureState[feat.tag];
      renderFeatures();
      applyTypography();
    });
    featuresEl.appendChild(btn);
  }
}

function applyTypography() {
  const record = state.loaded.get(state.activeExp);
  if (!record) return;

  const family = `"${record.family}", system-ui, sans-serif`;

  const parts = [];
  for (const tag of Object.keys(state.featureState)) {
    parts.push(`"${tag}" ${state.featureState[tag] ? 1 : 0}`);
  }
  const fft = parts.length ? parts.join(", ") : "normal";

  // Big editable headline
  stageText.style.fontFamily = family;
  stageText.style.lineHeight = leadingInput.value;
  stageText.style.letterSpacing = `${trackingInput.value}em`;
  stageText.style.fontFeatureSettings = fft;
  stageText.style.textTransform =
    state.caseMode === "upper" ? "uppercase"
    : state.caseMode === "lower" ? "lowercase"
    : "none";

  // Secondary display mark (bottom-right)
  stageMark.style.fontFamily = family;
  stageMark.style.letterSpacing = `${trackingInput.value}em`;
  stageMark.style.fontFeatureSettings = fft;

  // Size is handled by fitHeadline so it can shrink when content overflows
  fitHeadline();
}

// Dispatch to the right fit strategy based on viewport.
function fitHeadline() {
  if (window.matchMedia("(max-width: 900px)").matches) {
    fitHeadlineMobile();
  } else {
    fitHeadlineDesktop();
  }
}

// Desktop: shrink the headline so the whole app fits in the viewport
// without the bottom UI being pushed below the fold. Binary search between
// a hard minimum (2em ≈ 20px) and the slider's preferred value.
function fitHeadlineDesktop() {
  const preferred = parseFloat(sizeInput.value) || 14.4;
  const MIN = 2;

  stageText.style.fontSize = `${preferred}em`;

  const overflows = () => {
    return document.documentElement.scrollHeight > window.innerHeight + 1;
  };

  if (!overflows()) return;

  let lo = MIN;
  let hi = preferred;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    stageText.style.fontSize = `${mid}em`;
    if (overflows()) hi = mid;
    else lo = mid;
  }
  stageText.style.fontSize = `${lo}em`;
}

// Mobile: soft-wrap at word boundaries only (no mid-word breaks).
// Binary search the largest font-size where BOTH:
//   1. no single word overflows the stage-text horizontally
//      (scrollWidth > clientWidth means at least one word is too wide)
//   2. the bottom of the controls panel is still within the viewport
// Pure DOM measurement — reliable on iOS Safari.
function fitHeadlineMobile() {
  const controls = document.querySelector(".panel--controls");
  if (!controls) return;

  // Use innerHeight (layout viewport) — NOT visualViewport.height,
  // which shrinks when the iOS software keyboard opens and would
  // cause the headline to collapse to a tiny size while editing.
  const vpH = () => window.innerHeight;

  // Two separate constraint checks
  const fitsH = () => {
    // Force sync layout by touching offsetHeight, then compare widths.
    void stageText.offsetHeight;
    return stageText.scrollWidth <= stageText.clientWidth + 0.5;
  };
  const fitsV = () => {
    void stageText.offsetHeight;
    return controls.getBoundingClientRect().bottom <= vpH() + 0.5;
  };
  const fits = () => fitsH() && fitsV();

  const MIN = 16;
  const MAX = 260;

  // Clamp to MIN if even that's overflowing (very unusual).
  stageText.style.fontSize = `${MIN}px`;
  if (!fits()) return;

  // Binary search the largest size that still fits both constraints.
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

async function setExploration(id) {
  state.activeExp = id;
  renderExplorations();
  const exp = EXPLORATIONS.find((e) => e.id === id);
  await loadFont(exp);
  renderFeatures();
  applyTypography();
}

function pickRandomString() {
  // Pick a different string than the current one if possible
  const current = stageText.textContent.trim();
  const pool = PRESETS.filter((s) => s !== current);
  const options = pool.length ? pool : PRESETS;
  const next = options[Math.floor(Math.random() * options.length)];
  stageText.textContent = next;
  fitHeadline();
}

// -------- init ----------------------------------------------------------

async function init() {
  renderExplorations();
  renderCaseToggle();

  const isMobile = () => window.matchMedia("(max-width: 900px)").matches;

  leadingInput.addEventListener("input", applyTypography);
  trackingInput.addEventListener("input", applyTypography);
  sizeInput.addEventListener("input", applyTypography);
  randomBtn.addEventListener("click", pickRandomString);

  // Re-fit on typing only on desktop. On mobile, the iOS keyboard
  // opening triggers layout changes that would collapse the headline.
  stageText.addEventListener("input", () => {
    if (!isMobile()) fitHeadline();
  });

  // Re-fit on resize only on desktop. On iOS the "resize" event fires
  // when the software keyboard opens/closes, which would shrink the
  // headline unnecessarily.
  window.addEventListener("resize", () => {
    if (!isMobile()) fitHeadline();
  });

  // Load the initial exploration. setExploration → applyTypography →
  // fitHeadline will run a first-pass fit, but it happens while the
  // `.loading` class is still on <html> — good enough as a best guess.
  await setExploration(1);

  // Reveal the app BEFORE the definitive fit pass, then do the fit
  // after two animation frames so layout is fully settled.
  document.documentElement.classList.remove("loading");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      fitHeadline();
    });
  });

  for (const exp of EXPLORATIONS.slice(1)) {
    loadFont(exp).catch((e) => console.warn(e));
  }
}

init().catch((err) => {
  console.error(err);
  stageText.textContent = "Failed to load fonts — see console.";
});
