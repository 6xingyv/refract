// Read/write Apple's real `.icon` icon.json. Ported from IconIO.kt; schema validated against
// Apple's ictool (see ../../ref/ICON_FORMAT.md). Kebab-case keys; colours are strings; fill is a
// kind-keyed object; blur-material is a bare number; position = {scale, translation-in-points:[x,y]};
// shadow = {kind, opacity}; appearance specializations under <prop>-specializations.
import {
  IconDocument, Group, Layer, Fill, FillKind, IcColor, BlendMode, BlurMaterial, Shadow, ShadowKind,
  Translucency, Lighting, Platform, GroupSpec, LayerSpec, Position, Specular,
  newId, defaultFill, defaultBlur, defaultShadow, defaultTranslucency, defaultSpecular, rgba,
} from "./types";

const num = (f: number) => (f === Math.trunc(f) ? f : Number(f.toFixed(5)));

// ---- colour codec ----
const SYSTEM: Record<string, IcColor> = {
  "system-red": rgba(1, 0.231, 0.188), "system-orange": rgba(1, 0.584, 0), "system-yellow": rgba(1, 0.8, 0),
  "system-green": rgba(0.204, 0.78, 0.349), "system-mint": rgba(0, 0.78, 0.745), "system-teal": rgba(0.188, 0.69, 0.78),
  "system-cyan": rgba(0.196, 0.678, 0.902), "system-blue": rgba(0, 0.478, 1), "system-indigo": rgba(0.345, 0.337, 0.839),
  "system-purple": rgba(0.686, 0.322, 0.871), "system-pink": rgba(1, 0.176, 0.333), "system-brown": rgba(0.635, 0.518, 0.369),
  "system-gray": rgba(0.557, 0.557, 0.576),
};
const colorStr = (c: IcColor) => `srgb:${num(c.r)},${num(c.g)},${num(c.b)},${num(c.a)}`;
function colorParse(s: any): IcColor {
  if (typeof s !== "string") return rgba(1, 1, 1, 1);
  const i = s.indexOf(":");
  if (i < 0) return rgba(1, 1, 1, 1);
  const space = s.slice(0, i), body = s.slice(i + 1);
  if (space === "named") return SYSTEM[body] ?? rgba(1, 1, 1, 1);
  const p = body.split(",").map((x) => parseFloat(x.trim())).filter((x) => !isNaN(x));
  if (p.length === 4) return rgba(p[0], p[1], p[2], p[3]);
  if (p.length === 2) return rgba(p[0], p[0], p[0], p[1]); // gray: white, alpha
  if (p.length === 3) return rgba(p[0], p[1], p[2], 1);
  return rgba(1, 1, 1, 1);
}

// ---- blend / shadow / fill codecs ----
const BLEND_OUT: Record<BlendMode, string> = {
  "normal": "normal", "plus-lighter": "plus-lighter", "plus-darker": "plus-darker", "multiply": "multiply",
  "screen": "screen", "overlay": "overlay", "soft-light": "soft-light", "hard-light": "hard-light",
  "darken": "darken", "lighten": "lighten",
};
const blendParse = (s: any): BlendMode => (BLEND_OUT as any)[s] ? (s as BlendMode) : "normal";
const SHADOW_OUT: Record<ShadowKind, string> = { automatic: "automatic", neutral: "neutral", layerColor: "layer-color", none: "none" };
const shadowKindParse = (s: any): ShadowKind =>
  s === "automatic" ? "automatic" : s === "layer-color" ? "layerColor" : s === "none" ? "none" : "neutral";

function orientationToPts(deg: number) {
  const r = (deg * Math.PI) / 180, dx = Math.cos(r) * 0.5, dy = Math.sin(r) * 0.5;
  return { start: { x: num(0.5 - dx), y: num(0.5 - dy) }, stop: { x: num(0.5 + dx), y: num(0.5 + dy) } };
}
function orientationFromPts(o: any): number {
  if (!o) return 90;
  const s = o.start ?? {}, e = o.stop ?? {};
  const d = (Math.atan2((e.y ?? 0) - (s.y ?? 0), (e.x ?? 0) - (s.x ?? 0)) * 180) / Math.PI;
  return isNaN(d) ? 90 : d;
}

function fillEncode(f: Fill): any {
  switch (f.kind) {
    case "none": return "none";
    case "automatic": return "automatic";
    case "solid": return { solid: colorStr(f.primaryColor) };
    case "automaticGradient": return { "automatic-gradient": colorStr(f.primaryColor) };
    case "linearGradient":
      return { "linear-gradient": [colorStr(f.primaryColor), colorStr(f.secondaryColor)], orientation: orientationToPts(f.orientationDeg) };
  }
}
function fillDecode(e: any): Fill {
  if (typeof e === "string") return { ...defaultFill(), kind: e === "none" ? "none" : "automatic" };
  if (e && typeof e === "object") {
    if ("solid" in e) return { ...defaultFill(), kind: "solid", primaryColor: colorParse(e.solid) };
    if ("automatic-gradient" in e) return { ...defaultFill(), kind: "automaticGradient", primaryColor: colorParse(e["automatic-gradient"]) };
    if ("linear-gradient" in e) {
      const cs = e["linear-gradient"] ?? [];
      return { kind: "linearGradient", primaryColor: colorParse(cs[0]), secondaryColor: colorParse(cs[1]), orientationDeg: orientationFromPts(e.orientation) };
    }
  }
  return { ...defaultFill(), kind: "none" };
}

const posEncode = (scale: number, p: Position) => ({ scale: num(scale), "translation-in-points": [num(p.x), num(p.y)] });
function posDecode(o: any): { scale: number; pos: Position } {
  if (!o) return { scale: 1, pos: { x: 0, y: 0 } };
  const t = o["translation-in-points"];
  const x = Array.isArray(t) ? t[0] ?? 0 : 0, y = Array.isArray(t) ? t[1] ?? 0 : 0;
  return { scale: o.scale ?? 1, pos: { x, y } };
}
const shadowEncode = (s: Shadow) => ({ kind: SHADOW_OUT[s.enabled ? s.kind : "none"], opacity: num(s.opacity) });
function shadowDecode(o: any): Shadow {
  if (!o) return { ...defaultShadow(), kind: "none", enabled: false };
  const kind = shadowKindParse(o.kind);
  return { ...defaultShadow(), kind, opacity: o.opacity ?? 0.35, enabled: kind !== "none" };
}
const blurDecode = (e: any): BlurMaterial => (typeof e === "number" ? { enabled: e > 0, strength: e } : { enabled: false, strength: 0.5 });

// ---- specialization slot <-> appearance/platform ----
const PLATFORM_SLOTS = new Set(["iOS", "macOS", "watchOS"]);
const appleAppearance = (slot: string) => (slot === "Default" ? "light" : slot === "Dark" ? "dark" : slot === "Mono" ? "tinted" : "base");
const slotFromAppearance = (a: any): string | null => (a === "light" ? "Default" : a === "dark" ? "Dark" : a === "tinted" ? "Mono" : null);
const specSlotFromEntry = (e: any): string | null => {
  // The inspector has one axis per slot. Never collapse a locale, direction or
  // appearance+idiom combination into a global appearance/platform override.
  if (e?.localization != null || e?.languageDirection != null) return null;
  if (e?.idiom != null && typeof e.idiom !== "string") return null;
  const idiom = typeof e?.idiom === "string" ? e.idiom : null;
  if (idiom) return PLATFORM_SLOTS.has(idiom) && (e.appearance == null || e.appearance === "base") ? idiom : null;
  return slotFromAppearance(e?.appearance);
};
const specializationFields = (slot: string) =>
  PLATFORM_SLOTS.has(slot) ? { appearance: "base", idiom: slot } : { appearance: appleAppearance(slot) };
const hasSpecializationAxis = (e: any): boolean => e?.appearance != null || e?.idiom != null || e?.localization != null || e?.languageDirection != null;
function baseSpecValue(o: any, key: string): any {
  const arr = Array.isArray(o?.[key]) ? o[key] : [];
  const entry = arr.find((e: any) => e && "value" in e && !hasSpecializationAxis(e));
  return entry?.value;
}
function ownOrBase(o: any, ownKey: string, specKey: string = `${ownKey}-specializations`, alias?: string): any {
  if (o && ownKey in o) return o[ownKey];
  if (o && alias && alias in o) return o[alias];
  return baseSpecValue(o, specKey);
}
function specEntries(o: any, key: string): Array<{ slot: string; value: any }> {
  const arr = Array.isArray(o[key]) ? o[key] : [];
  const out: Array<{ slot: string; value: any }> = [];
  for (const e of arr) {
    const slot = specSlotFromEntry(e);
    if (slot && e && "value" in e) out.push({ slot, value: e.value });
  }
  return out;
}

// ============================ encode ============================
const DOC_KEYS = new Set(["supported-platforms", "fill", "fill-specializations", "implicit-asset-mirroring", "groups"]);
const GROUP_KEYS = new Set(["name", "opacity", "blend-mode", "lighting", "specular", "blur-material", "translucency", "shadow", "position", "is-hidden", "hidden", "asset-mirroring", "layers",
  "opacity-specializations", "blend-mode-specializations", "lighting-specializations", "specular-specializations", "blur-material-specializations", "translucency-specializations", "shadow-specializations", "position-specializations", "hidden-specializations", "asset-mirroring-specializations"]);
const LAYER_KEYS = new Set(["name", "image-name", "is-glass", "glass", "fill", "opacity", "blend-mode", "position", "is-hidden", "hidden", "asset-mirroring",
  "image-name-specializations", "fill-specializations", "opacity-specializations", "blend-mode-specializations", "glass-specializations", "position-specializations", "hidden-specializations", "asset-mirroring-specializations"]);

function preserve(out: any, raw: any, modeled: Set<string>) {
  if (raw && typeof raw === "object") for (const k of Object.keys(raw)) if (!modeled.has(k)) out[k] = raw[k];
}
function putSpecs(out: any, entries: Record<string, Array<{ slot: string; value: any }>>) {
  for (const [k, list] of Object.entries(entries))
    if (list.length) out[k] = list.map((e) => ({ ...specializationFields(e.slot), value: e.value }));
}

type Property = { key: string; specs?: string; alias?: string };
const property = (key: string, specs = `${key}-specializations`, alias?: string): Property => ({ key, specs, alias });
const GROUP_PROPERTIES: Property[] = [
  { key: "name" }, ...["opacity", "blend-mode", "lighting", "specular", "blur-material", "translucency", "shadow", "position", "asset-mirroring"].map((key) => property(key)),
  property("is-hidden", "hidden-specializations", "hidden"),
];
const LAYER_PROPERTIES: Property[] = [
  { key: "name" }, ...["image-name", "fill", "opacity", "blend-mode", "position", "asset-mirroring"].map((key) => property(key)),
  property("is-glass", "glass-specializations", "glass"), property("is-hidden", "hidden-specializations", "hidden"),
];
const sameValue = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Compare with the decoded source's canonical projection, then retain source
 * values for properties/slots the user did not change. This keeps color-space
 * tags, gradient endpoints, omitted defaults and axisless writer style intact.
 * Axes outside the inspector's model always survive, including during edits.
 */
function restoreSourceProperties(out: any, raw: any, baseline: any, properties: Property[]) {
  if (!raw || typeof raw !== "object") return;
  for (const { key, specs, alias } of properties) {
    const baseUnchanged = sameValue(out[key], baseline[key]);
    if (baseUnchanged) {
      delete out[key];
      if (key in raw) out[key] = raw[key];
      if (alias && alias in raw) out[alias] = raw[alias];
    } else if (alias && alias in raw && !(key in raw) && key in out) {
      out[alias] = out[key];
      delete out[key];
    }
    if (!specs) continue;
    const current = new Map(specEntries(out, specs).map((entry) => [entry.slot, entry.value]));
    const original = new Map(specEntries(baseline, specs).map((entry) => [entry.slot, entry.value]));
    const remaining = new Set(current.keys());
    const restored: any[] = [];
    for (const entry of Array.isArray(raw[specs]) ? raw[specs] : []) {
      const slot = specSlotFromEntry(entry);
      if (!slot) {
        if (hasSpecializationAxis(entry) || baseUnchanged) restored.push(entry);
        continue;
      }
      // A recognized axis can still contain a future value type the decoder
      // does not model. Its absence from the model is not an override deletion.
      if (!original.has(slot) && !current.has(slot)) {
        restored.push(entry);
        continue;
      }
      if (!current.has(slot)) continue; // The user removed this override.
      if (sameValue(current.get(slot), original.get(slot))) restored.push(entry);
      else if (remaining.has(slot)) restored.push({ ...entry, value: current.get(slot) });
      remaining.delete(slot);
    }
    for (const slot of remaining) restored.push({ ...specializationFields(slot), value: current.get(slot) });
    delete out[specs];
    if (restored.length || (Array.isArray(raw[specs]) && raw[specs].length === 0)) out[specs] = restored;
  }
}

function encodeGroup(g: Group, preserveSource = true): any {
  const o: any = {};
  preserve(o, g.raw, GROUP_KEYS);
  if (g.name) o.name = g.name;
  o.opacity = num(g.opacity);
  o["blend-mode"] = BLEND_OUT[g.blendMode];
  o.lighting = g.lighting;
  o.specular = g.specular.enabled;
  if (g.blurMaterial.enabled) o["blur-material"] = num(g.blurMaterial.strength);
  o.translucency = { enabled: g.translucency.enabled, value: num(g.translucency.value) };
  o.shadow = shadowEncode(g.shadow);
  o.position = posEncode(g.scale, g.position);
  o["is-hidden"] = g.isHidden;
  if (g.mirrorInRTL) o["asset-mirroring"] = { mirrorable: true };
  const specs: Record<string, any[]> = {};
  const add = (k: string, slot: string, v: any) => (specs[k] ??= []).push({ slot, value: v });
  for (const [slot, s] of Object.entries(g.specs)) {
    if (s.opacity != null) add("opacity-specializations", slot, num(s.opacity));
    if (s.blendMode != null) add("blend-mode-specializations", slot, BLEND_OUT[s.blendMode]);
    if (s.lighting != null) add("lighting-specializations", slot, s.lighting);
    if (s.specularEnabled != null) add("specular-specializations", slot, s.specularEnabled);
    if (s.blurMaterial != null) add("blur-material-specializations", slot, s.blurMaterial.enabled ? num(s.blurMaterial.strength) : 0);
    if (s.translucency != null) add("translucency-specializations", slot, { enabled: s.translucency.enabled, value: num(s.translucency.value) });
    if (s.shadow != null) add("shadow-specializations", slot, shadowEncode(s.shadow));
    if (s.position != null || s.scale != null) add("position-specializations", slot, posEncode(s.scale ?? g.scale, s.position ?? g.position));
    if (s.isHidden != null) add("hidden-specializations", slot, s.isHidden);
    if (s.mirrorInRTL != null) add("asset-mirroring-specializations", slot, { mirrorable: s.mirrorInRTL });
  }
  putSpecs(o, specs);
  if (preserveSource && g.raw) restoreSourceProperties(o, g.raw, encodeGroup(decodeGroup(g.raw, false), false), GROUP_PROPERTIES);
  o.layers = g.layers.map((layer) => encodeLayer(layer, preserveSource));
  return o;
}
function encodeLayer(l: Layer, preserveSource = true): any {
  const o: any = {};
  preserve(o, l.raw, LAYER_KEYS);
  if (l.name) o.name = l.name;
  if (l.imageName) o["image-name"] = l.imageName;
  o["is-glass"] = l.isGlass;
  if (l.fill.kind !== "none") o.fill = fillEncode(l.fill);
  o.opacity = num(l.opacity);
  o["blend-mode"] = BLEND_OUT[l.blendMode];
  o.position = posEncode(l.scale, l.position);
  o["is-hidden"] = l.isHidden;
  if (l.mirrorInRTL) o["asset-mirroring"] = { mirrorable: true };
  const specs: Record<string, any[]> = {};
  const add = (k: string, slot: string, v: any) => (specs[k] ??= []).push({ slot, value: v });
  for (const [slot, s] of Object.entries(l.specs)) {
    if (s.imageName !== undefined) add("image-name-specializations", slot, s.imageName);
    if (s.fill != null) add("fill-specializations", slot, fillEncode(s.fill));
    if (s.opacity != null) add("opacity-specializations", slot, num(s.opacity));
    if (s.blendMode != null) add("blend-mode-specializations", slot, BLEND_OUT[s.blendMode]);
    if (s.isGlass != null) add("glass-specializations", slot, s.isGlass);
    if (s.position != null || s.scale != null) add("position-specializations", slot, posEncode(s.scale ?? l.scale, s.position ?? l.position));
    if (s.isHidden != null) add("hidden-specializations", slot, s.isHidden);
    if (s.mirrorInRTL != null) add("asset-mirroring-specializations", slot, { mirrorable: s.mirrorInRTL });
  }
  putSpecs(o, specs);
  if (preserveSource && l.raw) restoreSourceProperties(o, l.raw, encodeLayer(decodeLayer(l.raw, false), false), LAYER_PROPERTIES);
  return o;
}

function encodePlatforms(ps: Platform[], squaresShared: boolean): any {
  const sq = new Set<string>(), ci = new Set<string>();
  for (const p of ps) {
    if (p === "iOS" || p === "iPadOS" || p === "tvOS") sq.add("iOS");
    else if (p === "macOS") sq.add("macOS");
    else if (p === "watchOS" || p === "visionOS") ci.add("watchOS");
  }
  if (sq.size === 0 && ci.size === 0) sq.add("iOS");
  const o: any = {};
  if (sq.size) o.squares = squaresShared ? "shared" : [...sq];
  if (ci.size) o.circles = [...ci];
  return o;
}

export function encodeIcon(doc: IconDocument): string {
  const root: any = {};
  preserve(root, doc.composition.extras, DOC_KEYS);
  root["supported-platforms"] = encodePlatforms(doc.supportedPlatforms, doc.squaresShared);
  root.fill = fillEncode(doc.composition.fill);
  if (doc.composition.implicitAssetMirroring) root["implicit-asset-mirroring"] = true;
  const fillSpecs: Record<string, any[]> = {};
  for (const [slot, fill] of Object.entries(doc.composition.fillSpecs ?? {}))
    (fillSpecs["fill-specializations"] ??= []).push({ slot, value: fillEncode(fill) });
  putSpecs(root, fillSpecs);
  const raw = doc.composition.extras;
  if (raw && typeof raw === "object") {
    const plat = decodePlatforms(raw["supported-platforms"]);
    const baseline: any = { "supported-platforms": encodePlatforms(plat.platforms, plat.squaresShared) };
    const rootFill = ownOrBase(raw, "fill");
    baseline.fill = fillEncode(rootFill === undefined ? defaultFill() : fillDecode(rootFill));
    if (raw["implicit-asset-mirroring"]) baseline["implicit-asset-mirroring"] = true;
    const entries: Record<string, any[]> = {};
    for (const { slot, value } of specEntries(raw, "fill-specializations"))
      (entries["fill-specializations"] ??= []).push({ slot, value: fillEncode(fillDecode(value)) });
    putSpecs(baseline, entries);
    restoreSourceProperties(root, raw, baseline, [property("fill"), { key: "supported-platforms" }, { key: "implicit-asset-mirroring" }]);
  }
  root.groups = doc.composition.groups.map((group) => encodeGroup(group));
  return JSON.stringify(root, null, 2);
}

/** Collect asset references from the final JSON, including preserved multi-axis overrides. */
export function iconAssetNames(jsonText: string): string[] {
  const root = JSON.parse(jsonText);
  const names = new Set<string>();
  for (const group of Array.isArray(root.groups) ? root.groups : []) {
    for (const layer of Array.isArray(group.layers) ? group.layers : []) {
      if (typeof layer["image-name"] === "string") names.add(layer["image-name"]);
      for (const entry of Array.isArray(layer["image-name-specializations"]) ? layer["image-name-specializations"] : [])
        if (typeof entry?.value === "string") names.add(entry.value);
    }
  }
  return [...names];
}

// ============================ decode ============================
function decodePlatforms(o: any): { platforms: Platform[]; squaresShared: boolean } {
  const out = new Set<Platform>();
  let squaresShared = false;
  const sq = o?.squares;
  if (sq === "shared") { squaresShared = true; out.add("iOS"); out.add("macOS"); }
  else if (Array.isArray(sq)) for (const n of sq) { if (n === "iOS") out.add("iOS"); else if (n === "macOS") out.add("macOS"); }
  const ci = Array.isArray(o?.circles) ? o.circles : [];
  for (const n of ci) if (n === "watchOS") out.add("watchOS");
  if (out.size === 0) { out.add("iOS"); squaresShared = true; }
  return { platforms: [...out], squaresShared };
}
function decodeGroupSpecs(o: any): Record<string, GroupSpec> {
  const out: Record<string, GroupSpec> = {};
  const upd = (slot: string, f: (s: GroupSpec) => void) => { (out[slot] ??= {}); f(out[slot]); };
  for (const { slot, value } of specEntries(o, "opacity-specializations")) if (typeof value === "number") upd(slot, (s) => (s.opacity = value));
  for (const { slot, value } of specEntries(o, "blend-mode-specializations")) upd(slot, (s) => (s.blendMode = blendParse(value)));
  for (const { slot, value } of specEntries(o, "lighting-specializations")) upd(slot, (s) => (s.lighting = (value === "individual" ? "individual" : "combined") as Lighting));
  for (const { slot, value } of specEntries(o, "specular-specializations")) if (typeof value === "boolean") upd(slot, (s) => (s.specularEnabled = value));
  for (const { slot, value } of specEntries(o, "blur-material-specializations")) upd(slot, (s) => (s.blurMaterial = blurDecode(value)));
  for (const { slot, value } of specEntries(o, "translucency-specializations")) if (value && typeof value === "object") upd(slot, (s) => (s.translucency = { enabled: !!value.enabled, value: value.value ?? 0.6 }));
  for (const { slot, value } of specEntries(o, "shadow-specializations")) if (value && typeof value === "object") upd(slot, (s) => (s.shadow = shadowDecode(value)));
  for (const { slot, value } of specEntries(o, "position-specializations")) {
    const p = posDecode(value);
    upd(slot, (s) => { s.position = p.pos; s.scale = p.scale; });
  }
  for (const { slot, value } of specEntries(o, "hidden-specializations")) if (typeof value === "boolean") upd(slot, (s) => (s.isHidden = value));
  for (const { slot, value } of specEntries(o, "asset-mirroring-specializations")) if (value && typeof value === "object") upd(slot, (s) => (s.mirrorInRTL = !!value.mirrorable));
  return out;
}
function decodeLayerSpecs(o: any): Record<string, LayerSpec> {
  const out: Record<string, LayerSpec> = {};
  const upd = (slot: string, f: (s: LayerSpec) => void) => { (out[slot] ??= {}); f(out[slot]); };
  for (const { slot, value } of specEntries(o, "image-name-specializations")) if (typeof value === "string" || value == null) upd(slot, (s) => (s.imageName = value ?? null));
  for (const { slot, value } of specEntries(o, "fill-specializations")) upd(slot, (s) => (s.fill = fillDecode(value)));
  for (const { slot, value } of specEntries(o, "opacity-specializations")) if (typeof value === "number") upd(slot, (s) => (s.opacity = value));
  for (const { slot, value } of specEntries(o, "blend-mode-specializations")) upd(slot, (s) => (s.blendMode = blendParse(value)));
  for (const { slot, value } of specEntries(o, "glass-specializations")) if (typeof value === "boolean") upd(slot, (s) => (s.isGlass = value));
  for (const { slot, value } of specEntries(o, "position-specializations")) {
    const p = posDecode(value);
    upd(slot, (s) => { s.position = p.pos; s.scale = p.scale; });
  }
  for (const { slot, value } of specEntries(o, "hidden-specializations")) if (typeof value === "boolean") upd(slot, (s) => (s.isHidden = value));
  for (const { slot, value } of specEntries(o, "asset-mirroring-specializations")) if (value && typeof value === "object") upd(slot, (s) => (s.mirrorInRTL = !!value.mirrorable));
  return out;
}
function decodeLayer(o: any, generateIds = true): Layer {
  const { scale, pos } = posDecode(ownOrBase(o, "position", "position-specializations"));
  const spec: Specular = defaultSpecular();
  const imageName = ownOrBase(o, "image-name", "image-name-specializations");
  const fill = ownOrBase(o, "fill", "fill-specializations");
  const isGlass = ownOrBase(o, "is-glass", "glass-specializations", "glass");
  const hidden = ownOrBase(o, "is-hidden", "hidden-specializations", "hidden");
  const mirror = ownOrBase(o, "asset-mirroring", "asset-mirroring-specializations");
  return {
    kind: "layer", id: generateIds ? newId() : 0, name: o.name ?? "Layer", isHidden: !!hidden,
    imageName: typeof imageName === "string" ? imageName : null, isGlass: isGlass ?? true,
    fill: fill === undefined ? { ...defaultFill(), kind: "none" } : fillDecode(fill),
    opacity: ownOrBase(o, "opacity", "opacity-specializations") ?? 1, position: pos, scale,
    blendMode: blendParse(ownOrBase(o, "blend-mode", "blend-mode-specializations")),
    specular: spec, mirrorInRTL: !!(mirror?.mirrorable), specs: decodeLayerSpecs(o), raw: o,
  };
}
function decodeGroup(o: any, generateIds = true): Group {
  const { scale, pos } = posDecode(ownOrBase(o, "position", "position-specializations"));
  const specular = ownOrBase(o, "specular", "specular-specializations");
  const shadow = ownOrBase(o, "shadow", "shadow-specializations");
  const translucency = ownOrBase(o, "translucency", "translucency-specializations");
  const mirror = ownOrBase(o, "asset-mirroring", "asset-mirroring-specializations");
  return {
    kind: "group", id: generateIds ? newId() : 0, name: o.name ?? "Group", isHidden: !!ownOrBase(o, "is-hidden", "hidden-specializations", "hidden"),
    layers: Array.isArray(o.layers) ? o.layers.map((layer: any) => decodeLayer(layer, generateIds)) : [],
    opacity: ownOrBase(o, "opacity", "opacity-specializations") ?? 1, position: pos, scale,
    blendMode: blendParse(ownOrBase(o, "blend-mode", "blend-mode-specializations")),
    glassEnabled: true, blurMaterial: blurDecode(ownOrBase(o, "blur-material", "blur-material-specializations")),
    specular: { ...defaultSpecular(), enabled: specular ?? true },
    shadow: shadowDecode(shadow),
    translucency: translucency ? { enabled: !!translucency.enabled, value: translucency.value ?? 0.6 } : defaultTranslucency(),
    lighting: ownOrBase(o, "lighting", "lighting-specializations") === "individual" ? "individual" : "combined",
    mirrorInRTL: !!(mirror?.mirrorable), specs: decodeGroupSpecs(o), raw: o,
  };
}

export function decodeIcon(jsonText: string, name: string): IconDocument {
  const root = JSON.parse(jsonText);
  const plat = decodePlatforms(root["supported-platforms"]);
  const rootFill = "fill" in root ? root.fill : baseSpecValue(root, "fill-specializations");
  const fillSpecs: Record<string, Fill> = {};
  for (const { slot, value } of specEntries(root, "fill-specializations")) fillSpecs[slot] = fillDecode(value);
  return {
    name: name || "Untitled",
    composition: {
      groups: Array.isArray(root.groups) ? root.groups.map((group: any) => decodeGroup(group)) : [],
      fill: rootFill === undefined ? defaultFill() : fillDecode(rootFill),
      fillSpecs,
      implicitAssetMirroring: !!root["implicit-asset-mirroring"],
      extras: root,
    },
    supportedPlatforms: plat.platforms, squaresShared: plat.squaresShared,
    previewPlatform: plat.platforms[0] ?? "iOS", previewRendition: "Default",
    background: rgba(0.92, 0.92, 0.94, 1), tintColor: rgba(0.2, 0.5, 1), tintStrength: 0, lightAngleDeg: 45,
  };
}
