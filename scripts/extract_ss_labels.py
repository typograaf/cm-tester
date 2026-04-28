#!/usr/bin/env python3
"""Extract OpenType ss/cv feature metadata for the production tester:

  - UI label (resolved from name table)
  - One representative source character (so the glyph preview can show
    the letter that gets substituted when the feature is on)

opentype.js 1.3.4 doesn't expose FeatureParams reliably, so we resolve
everything server-side at sync time.

Output JSON shape:
  { "ss01": { "label": "Double Storey g", "sample": "g" }, ... }
"""

import json
import os
import sys
from fontTools.ttLib import TTFont


def lookup_name(name_table, name_id: int) -> str | None:
    rec = (
        name_table.getName(name_id, 3, 1, 0x409)
        or name_table.getName(name_id, 3, 1)
        or name_table.getName(name_id, 1, 0)
        or name_table.getName(name_id, 0, 4)
    )
    return rec.toUnicode() if rec else None


def collect_source_glyphs(lookup) -> set[str]:
    """Return the set of glyph names that this lookup substitutes FROM."""
    out: set[str] = set()
    for sub in getattr(lookup, "SubTable", []):
        # GSUB type 1: SingleSubst — mapping {old: new}
        if hasattr(sub, "mapping") and isinstance(sub.mapping, dict):
            out.update(sub.mapping.keys())
        # GSUB type 3: AlternateSubst — alternates {glyph: [alts...]}
        if hasattr(sub, "alternates") and isinstance(sub.alternates, dict):
            out.update(sub.alternates.keys())
        # GSUB type 4: LigatureSubst — ligatures {first: [Ligature(...), ...]}
        if hasattr(sub, "ligatures") and isinstance(sub.ligatures, dict):
            out.update(sub.ligatures.keys())
        # Chained context (type 6) etc. are skipped — usually not the
        # primary substitution for stylistic sets.
    return out


def lookup_target_glyph(src_glyph: str, lookups, lookup_indices) -> str | None:
    """Walk this feature's lookups and return the substituted glyph name
    for the given source glyph. Returns the first match found across
    SingleSubst / AlternateSubst lookups."""
    for li in lookup_indices:
        lookup = lookups[li]
        for sub in getattr(lookup, "SubTable", []):
            # SingleSubst: {old: new}
            if hasattr(sub, "mapping") and isinstance(sub.mapping, dict):
                if src_glyph in sub.mapping:
                    return sub.mapping[src_glyph]
            # AlternateSubst: {glyph: [alt1, alt2, ...]} — pick first alt
            if hasattr(sub, "alternates") and isinstance(sub.alternates, dict):
                alts = sub.alternates.get(src_glyph)
                if alts:
                    return alts[0]
    return None


def collect_all_subs(lookups, lookup_indices) -> dict[str, str]:
    """Return ALL substitution mappings (source -> target) covered by
    this feature's lookups. Used to render multi-character samples
    (e.g. "Aa", "jft") with each character correctly substituted."""
    out: dict[str, str] = {}
    for li in lookup_indices:
        lookup = lookups[li]
        for sub in getattr(lookup, "SubTable", []):
            if hasattr(sub, "mapping") and isinstance(sub.mapping, dict):
                for src, tgt in sub.mapping.items():
                    out.setdefault(src, tgt)
            if hasattr(sub, "alternates") and isinstance(sub.alternates, dict):
                for src, alts in sub.alternates.items():
                    if alts:
                        out.setdefault(src, alts[0])
    return out


def pick_sample(glyph_names: set[str], reverse_cmap: dict[str, str]) -> str | None:
    """Pick a single representative character for the feature.

    Prefer lowercase letters > uppercase letters > digits > symbols, so
    "Double Storey g" picks "g" rather than "G" if both are remapped.
    """
    if not glyph_names:
        return None

    chars: list[str] = []
    for g in glyph_names:
        ch = reverse_cmap.get(g)
        if ch:
            chars.append(ch)
    if not chars:
        return None

    def rank(c: str) -> tuple[int, str]:
        if c.islower():
            return (0, c)
        if c.isupper():
            return (1, c)
        if c.isdigit():
            return (2, c)
        return (3, c)

    chars.sort(key=rank)
    return chars[0]


def extract(path: str) -> dict[str, dict]:
    font = TTFont(path)
    out: dict[str, dict] = {}

    gsub = font.get("GSUB")
    if not gsub:
        return out

    name = font["name"]
    cmap = font.getBestCmap()
    reverse_cmap: dict[str, str] = {}
    for cp, gname in cmap.items():
        reverse_cmap.setdefault(gname, chr(cp))

    glyph_order = font.getGlyphOrder()
    name_to_index = {n: i for i, n in enumerate(glyph_order)}

    feature_list = gsub.table.FeatureList
    lookup_list = gsub.table.LookupList

    for fr in feature_list.FeatureRecord:
        tag = fr.FeatureTag
        if not (tag.startswith("ss") or tag.startswith("cv")):
            continue

        entry: dict[str, str] = {}

        # UI label (from FeatureParams.UINameID).
        params = fr.Feature.FeatureParams
        ui_id = getattr(params, "UINameID", None) if params else None
        if ui_id:
            label = lookup_name(name, ui_id)
            if label:
                entry["label"] = label

        # Auto-pick a default sample character + collect every
        # substitution this feature applies, as a {char: target_index}
        # map. The front-end uses this map to render multi-character
        # samples (e.g. "Aa", "jft") with each char correctly swapped.
        # Indices (not names) because this font's post table is v3.0,
        # which strips glyph names from the runtime.
        glyph_names: set[str] = set()
        for li in fr.Feature.LookupListIndex:
            glyph_names |= collect_source_glyphs(lookup_list.Lookup[li])
        sample = pick_sample(glyph_names, reverse_cmap)
        if sample:
            entry["sample"] = sample

        all_subs = collect_all_subs(lookup_list.Lookup, fr.Feature.LookupListIndex)
        substitutions: dict[str, int] = {}
        for src_g, tgt_g in all_subs.items():
            ch = reverse_cmap.get(src_g)
            tgt_idx = name_to_index.get(tgt_g)
            if ch and tgt_idx is not None:
                substitutions[ch] = tgt_idx
        if substitutions:
            entry["substitutions"] = substitutions

        if entry:
            out[tag] = entry

    return out


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: extract_ss_labels.py <font.otf> <out.json>", file=sys.stderr)
        return 1
    src, dst = sys.argv[1], sys.argv[2]
    data = extract(src)

    # Preserve manually-edited fields. `label` and `sample` start
    # auto-extracted from the font but the human-readable name and the
    # preview string are editorial choices (e.g. "Lowercaps E" vs
    # "Lowercaps e", "Aa" vs just "a", "jft" instead of one letter).
    # `description` is always human-authored. Anything else added by
    # hand also survives a sync.
    PRESERVED_FIELDS = ("label", "sample", "description")
    if os.path.exists(dst):
        try:
            with open(dst, "r", encoding="utf-8") as f:
                existing = json.load(f)
            for tag, entry in data.items():
                prev = existing.get(tag) or {}
                if not isinstance(prev, dict):
                    continue
                for field in PRESERVED_FIELDS:
                    if prev.get(field):
                        entry[field] = prev[field]
        except (OSError, ValueError):
            pass

    with open(dst, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")
    print(f"wrote {dst}: {data}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
