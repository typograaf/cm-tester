// CM Typeface Tester
// Loads 5 CM explorations, auto-discovers OpenType features from the active font,
// exposes leading/tracking/size sliders and a preset-string picker.

import opentype from "https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/+esm";

// -------- config ---------------------------------------------------------

const EXPLORATIONS = [
  { id: 1, label: "Exp 1", file: "fonts/CM_1_260413a-Bold.otf" },
  { id: 2, label: "Exp 2", file: "fonts/CM_2_260414-Bold.otf" },
  { id: 3, label: "Exp 3", file: "fonts/CM_3_260413-Bold.otf" },
  { id: 4, label: "Exp 4", file: "fonts/CM_4_260413b-Bold.otf" },
  { id: 5, label: "Exp 5", file: "fonts/CM_5_260414c-Bold.otf" },
];

const PRESETS = [
  "Leef gerust wat meer.",
  "Leef gerust iets te wild.",
  "Leef gerust zonder bang te zijn om op je gezicht te gaan.",
];

// Friendly names for standard OpenType features that don't have UI names in the font.
const FEATURE_LABELS = {
  kern: "Kerning",
  liga: "Ligatures",
  dlig: "Disc. Ligatures",
  clig: "Context. Ligatures",
  calt: "Context. Alternates",
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

// Features that are *on* by default in CSS — we skip showing them as toggles
// unless the user wants finer control. (Comment out any you want to expose.)
const HIDDEN_DEFAULTS = new Set(["kern", "calt", "rlig", "ccmp", "mark", "mkmk"]);

// -------- state ----------------------------------------------------------

const state = {
  activeExp: 1,
  // tag -> bool
  featureState: {},
  // per-exploration: { features: [{tag, label}], fontFamily }
  loaded: new Map(),
};

// -------- DOM refs -------------------------------------------------------

const $ = (id) => document.getElementById(id);
const explorationsEl = $("explorations");
const presetsEl = $("presets");
const featuresEl = $("features");
const stageText = $("stageText");
const stageMark = $("stageMark");
const leadingInput = $("leading");
const trackingInput = $("tracking");
const sizeInput = $("fontsize");

// -------- font loading --------------------------------------------------

async function loadFont(exp) {
  if (state.loaded.has(exp.id)) return state.loaded.get(exp.id);

  const res = await fetch(exp.file);
  if (!res.ok) throw new Error(`failed to fetch ${exp.file}`);
  const buf = await res.arrayBuffer();

  // Inject @font-face
  const family = `CM-${exp.id}`;
  const fontFace = new FontFace(family, buf, { weight: "700", style: "normal" });
  await fontFace.load();
  document.fonts.add(fontFace);

  // Parse with opentype.js for feature discovery
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
  const gsub = font.tables.gsub;
  if (!gsub || !gsub.features) return [];

  const tags = new Set();
  for (const f of gsub.features) {
    if (f && f.tag) tags.add(f.tag);
  }

  // Also pick up GPOS features (kerning lives here)
  const gpos = font.tables.gpos;
  if (gpos && gpos.features) {
    for (const f of gpos.features) {
      if (f && f.tag) tags.add(f.tag);
    }
  }

  // Try to resolve stylistic set UI names from the name table.
  // ss## features carry a UINameID in their FeatureParams (not always parsed
  // by opentype.js — we fall back to the tag if unavailable).
  const nameLookup = buildNameLookup(font);

  const out = [];
  for (const tag of tags) {
    if (HIDDEN_DEFAULTS.has(tag)) continue;
    out.push({ tag, label: labelForTag(tag, gsub, nameLookup) });
  }

  // Sort: ss## numeric, then alpha
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
  // opentype.js exposes parsed name records as font.names (keyed by standard name ID)
  // plus raw records at font.tables.name if available. We look for nameID >= 256.
  const map = new Map();
  const raw = font.tables.name;
  if (raw && typeof raw === "object") {
    for (const key of Object.keys(raw)) {
      const entry = raw[key];
      if (!entry) continue;
      // opentype.js stores as { en: "..." } objects keyed by nameID string
      const val = typeof entry === "string" ? entry : entry.en || Object.values(entry)[0];
      if (val) map.set(String(key), val);
    }
  }
  return map;
}

function labelForTag(tag, gsub, nameLookup) {
  // Stylistic set: try to pull a UI name via feature params.
  if (/^ss\d\d$/.test(tag)) {
    // Walk gsub.features to find a feature with params.uiLabelNameID
    const feat = (gsub.features || []).find((f) => f && f.tag === tag);
    const nameID = feat?.feature?.params?.uiLabelNameID;
    if (nameID && nameLookup.has(String(nameID))) {
      return nameLookup.get(String(nameID));
    }
    // Fallback
    return tag.toUpperCase();
  }
  if (/^cv\d\d$/.test(tag)) return tag.toUpperCase();
  return FEATURE_LABELS[tag] || tag;
}

// -------- render --------------------------------------------------------

function renderExplorations() {
  explorationsEl.innerHTML = "";
  for (const exp of EXPLORATIONS) {
    const btn = document.createElement("button");
    btn.textContent = exp.label;
    btn.classList.toggle("is-active", exp.id === state.activeExp);
    btn.addEventListener("click", () => setExploration(exp.id));
    explorationsEl.appendChild(btn);
  }
}

function renderPresets() {
  presetsEl.innerHTML = "";
  PRESETS.forEach((str, i) => {
    const btn = document.createElement("button");
    btn.textContent = str.length > 42 ? str.slice(0, 40) + "…" : str;
    btn.title = str;
    btn.addEventListener("click", () => {
      stageText.textContent = str;
      markActivePreset(i);
    });
    presetsEl.appendChild(btn);
  });
}

function markActivePreset(activeIdx) {
  [...presetsEl.children].forEach((b, i) =>
    b.classList.toggle("is-active", i === activeIdx)
  );
}

function renderFeatures() {
  const record = state.loaded.get(state.activeExp);
  featuresEl.innerHTML = "";
  if (!record || !record.features.length) return;

  for (const feat of record.features) {
    const btn = document.createElement("button");
    btn.textContent = feat.label;
    btn.title = feat.tag;
    const on = !!state.featureState[feat.tag];
    btn.classList.toggle("is-on", on);
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

  // Build font-feature-settings from state
  const parts = [];
  for (const tag of Object.keys(state.featureState)) {
    parts.push(`"${tag}" ${state.featureState[tag] ? 1 : 0}`);
  }
  const fft = parts.length ? parts.join(", ") : "normal";

  // Big editable headline
  stageText.style.fontFamily = family;
  stageText.style.lineHeight = leadingInput.value;
  stageText.style.letterSpacing = `${trackingInput.value}em`;
  stageText.style.fontSize = `${sizeInput.value}px`;
  stageText.style.fontFeatureSettings = fft;

  // Secondary display mark (bottom-right)
  stageMark.style.fontFamily = family;
  stageMark.style.letterSpacing = `${trackingInput.value}em`;
  stageMark.style.fontFeatureSettings = fft;
}

async function setExploration(id) {
  state.activeExp = id;
  renderExplorations();
  const exp = EXPLORATIONS.find((e) => e.id === id);
  await loadFont(exp);
  renderFeatures();
  applyTypography();
}

// -------- init ----------------------------------------------------------

async function init() {
  renderExplorations();
  renderPresets();

  // Wire sliders
  for (const el of [leadingInput, trackingInput, sizeInput]) {
    el.addEventListener("input", applyTypography);
  }

  // Clear preset highlight while typing
  stageText.addEventListener("input", () => markActivePreset(-1));

  // Kick off: load exploration 1 first, then warm up the rest in the background
  await setExploration(1);
  for (const exp of EXPLORATIONS.slice(1)) {
    loadFont(exp).catch((e) => console.warn(e));
  }
}

init().catch((err) => {
  console.error(err);
  stageText.textContent = "Failed to load fonts — see console.";
});
