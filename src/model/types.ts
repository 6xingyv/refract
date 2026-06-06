// TypeScript port of the Compose model (Model.kt). Faithful to IconComposerFoundation.IconComposition;
// see ../../ICON_FORMAT.md. Plain immutable data + helpers (no classes).

export interface IcColor { r: number; g: number; b: number; a: number }
export const rgba = (r: number, g: number, b: number, a = 1): IcColor => ({ r, g, b, a });

export type BlendMode =
  | "normal" | "plus-lighter" | "plus-darker" | "multiply" | "screen" | "overlay"
  | "soft-light" | "hard-light" | "darken" | "lighten";

export type Lighting = "individual" | "combined";
export type FillKind = "none" | "solid" | "linearGradient" | "automatic" | "automaticGradient";
export type ShadowKind = "automatic" | "neutral" | "layerColor" | "none";
export type PlatformMode = "Shared" | "Unique";

export type Platform = "iOS" | "iPadOS" | "macOS" | "watchOS" | "tvOS" | "visionOS";

export interface PlatformInfo {
  displayName: string; logicalCanvasSize: number; cornerRadiusPct: number; circle: boolean;
}
export const PLATFORMS: Record<Platform, PlatformInfo> = {
  iOS: { displayName: "iOS", logicalCanvasSize: 1024, cornerRadiusPct: 0.26, circle: false },
  iPadOS: { displayName: "iPadOS", logicalCanvasSize: 1024, cornerRadiusPct: 0.26, circle: false },
  macOS: { displayName: "macOS", logicalCanvasSize: 1024, cornerRadiusPct: 0.1855, circle: false },
  watchOS: { displayName: "watchOS", logicalCanvasSize: 1024, cornerRadiusPct: 0.5, circle: true },
  tvOS: { displayName: "tvOS", logicalCanvasSize: 1024, cornerRadiusPct: 0.1, circle: false },
  visionOS: { displayName: "visionOS", logicalCanvasSize: 1024, cornerRadiusPct: 0.5, circle: true },
};

// Concrete preview renditions (appearance variants).
export type Rendition =
  | "Default" | "Dark" | "Light" | "Mono" | "TintedDark" | "TintedLight" | "ClearDark" | "ClearLight";

export interface RenditionInfo { dark: boolean; appearanceCode: number }
// appearanceCode maps to common.wgsl.inc appearance(): 0 default,1 dark,2 light,3 mono,4 tinted,5 clear
export const RENDITIONS: Record<Rendition, RenditionInfo> = {
  Default: { dark: false, appearanceCode: 0 },
  Dark: { dark: true, appearanceCode: 1 },
  Light: { dark: false, appearanceCode: 2 },
  Mono: { dark: true, appearanceCode: 3 },
  TintedDark: { dark: true, appearanceCode: 4 },
  TintedLight: { dark: false, appearanceCode: 4 },
  ClearDark: { dark: true, appearanceCode: 5 },
  ClearLight: { dark: false, appearanceCode: 5 },
};

/** Appearance edit slots shown in the inspector: All (base) / Default / Dark / Mono. */
export type Appearance = "All" | "Default" | "Dark" | "Mono";
export const APPEARANCES: Appearance[] = ["All", "Default", "Dark", "Mono"];
/** The spec slot an appearance EDITS; "All" = base (null). */
export const slotOf = (a: Appearance): string | null => (a === "All" ? null : a);
/** The rendition an appearance previews (drives the dark/mono appearance code). */
export const renditionOf = (a: Appearance): Rendition => (a === "Dark" ? "Dark" : a === "Mono" ? "Mono" : "Default");

/** Natural spec slot a RENDITION resolves with (for variant thumbnails). Falls back to base when absent. */
export function specSlot(r: Rendition): string | null {
  switch (r) {
    case "Dark": return "Dark";
    case "Mono": case "TintedLight": case "TintedDark": return "Mono";
    case "Default": case "Light": return "Default";
    default: return null;
  }
}

export interface Fill {
  kind: FillKind; primaryColor: IcColor; secondaryColor: IcColor; orientationDeg: number;
}
export const defaultFill = (): Fill => ({
  kind: "automatic",
  primaryColor: rgba(0.36, 0.66, 1), secondaryColor: rgba(0.18, 0.42, 0.95), orientationDeg: 90,
});

export interface BlurMaterial { enabled: boolean; strength: number }
export const defaultBlur = (): BlurMaterial => ({ enabled: false, strength: 0.5 });

export interface Specular {
  enabled: boolean; height: number; spread: number; biasAmount: number; curvature: number; color: IcColor;
}
export const defaultSpecular = (): Specular => ({
  enabled: true, height: 3, spread: 0.35, biasAmount: 0.4, curvature: 0.6, color: rgba(0.95, 0.97, 1, 0.9),
});

export interface Shadow {
  kind: ShadowKind; opacity: number; enabled: boolean; radius: number; color: IcColor;
}
export const defaultShadow = (): Shadow => ({
  kind: "neutral", opacity: 0.35, enabled: true, radius: 24, color: rgba(0, 0, 0, 1),
});

export interface Translucency { enabled: boolean; value: number }
export const defaultTranslucency = (): Translucency => ({ enabled: false, value: 0.6 });

export interface Position { x: number; y: number }

// Sparse per-appearance overrides (null fields inherit base).
export interface GroupSpec {
  opacity?: number; blendMode?: BlendMode; glassEnabled?: boolean; specularEnabled?: boolean;
  blurMaterial?: BlurMaterial; translucency?: Translucency; shadow?: Shadow; lighting?: Lighting;
  isHidden?: boolean; position?: Position; scale?: number; mirrorInRTL?: boolean;
}
export interface LayerSpec {
  imageName?: string | null; fill?: Fill; opacity?: number; blendMode?: BlendMode; isGlass?: boolean;
  isHidden?: boolean; position?: Position; scale?: number; mirrorInRTL?: boolean;
}

export interface Layer {
  kind: "layer"; id: number; name: string; isHidden: boolean;
  imageName: string | null; isGlass: boolean; fill: Fill;
  opacity: number; position: Position; scale: number; blendMode: BlendMode;
  specular: Specular; mirrorInRTL: boolean; specs: Record<string, LayerSpec>;
  raw?: any;
}

export interface Group {
  kind: "group"; id: number; name: string; isHidden: boolean; layers: Layer[];
  opacity: number; position: Position; scale: number; blendMode: BlendMode;
  glassEnabled: boolean; blurMaterial: BlurMaterial; specular: Specular; shadow: Shadow;
  translucency: Translucency; lighting: Lighting; mirrorInRTL: boolean;
  specs: Record<string, GroupSpec>; raw?: any;
}

export interface IconComposition {
  groups: Group[]; fill: Fill; fillSpecs?: Record<string, Fill>;
  implicitAssetMirroring?: boolean; extras?: any;
}

export interface IconDocument {
  name: string; composition: IconComposition;
  supportedPlatforms: Platform[];
  /** true => iOS/macOS share one square icon (.icon squares:"shared"); false => split (squares:[...]). */
  squaresShared: boolean;
  previewPlatform: Platform; previewRendition: Rendition;
  background: IcColor; tintColor: IcColor; tintStrength: number; lightAngleDeg: number;
}

// ---- ids ----
let nextId = 1000;
export const newId = () => ++nextId;

export const newLayer = (name: string, over: Partial<Layer> = {}): Layer => ({
  kind: "layer", id: newId(), name, isHidden: false, imageName: null, isGlass: true,
  fill: defaultFill(), opacity: 1, position: { x: 0, y: 0 }, scale: 1, blendMode: "normal",
  specular: defaultSpecular(), mirrorInRTL: false, specs: {}, ...over,
});

export const newGroup = (name: string, over: Partial<Group> = {}): Group => ({
  kind: "group", id: newId(), name, isHidden: false, layers: [], opacity: 1,
  position: { x: 0, y: 0 }, scale: 1, blendMode: "normal", glassEnabled: true,
  blurMaterial: defaultBlur(), specular: defaultSpecular(), shadow: defaultShadow(),
  translucency: defaultTranslucency(), lighting: "combined", mirrorInRTL: false, specs: {}, ...over,
});

// ---- specialization resolution (effective values for a slot) ----
export function resolveGroup(g: Group, slot: string | null, platformSlot?: string | null): Group {
  const apply = (base: Group, s?: GroupSpec): Group => {
    if (!s) return base;
    return {
      ...base,
      opacity: s.opacity ?? base.opacity,
      blendMode: s.blendMode ?? base.blendMode,
      glassEnabled: s.glassEnabled ?? base.glassEnabled,
      specular: s.specularEnabled != null ? { ...base.specular, enabled: s.specularEnabled } : base.specular,
      blurMaterial: s.blurMaterial ?? base.blurMaterial,
      translucency: s.translucency ?? base.translucency,
      shadow: s.shadow ?? base.shadow,
      lighting: s.lighting ?? base.lighting,
      isHidden: s.isHidden ?? base.isHidden,
      position: s.position ?? base.position,
      scale: s.scale ?? base.scale,
      mirrorInRTL: s.mirrorInRTL ?? base.mirrorInRTL,
    };
  };
  let out = slot ? apply(g, g.specs[slot]) : g;
  if (platformSlot && platformSlot !== slot) out = apply(out, g.specs[platformSlot]);
  return out;
}
export function resolveLayer(l: Layer, slot: string | null, platformSlot?: string | null): Layer {
  const apply = (base: Layer, s?: LayerSpec): Layer => {
    if (!s) return base;
    return {
      ...base,
      imageName: "imageName" in s ? s.imageName ?? null : base.imageName,
      fill: s.fill ?? base.fill,
      opacity: s.opacity ?? base.opacity,
      blendMode: s.blendMode ?? base.blendMode,
      isGlass: s.isGlass ?? base.isGlass,
      isHidden: s.isHidden ?? base.isHidden,
      position: s.position ?? base.position,
      scale: s.scale ?? base.scale,
      mirrorInRTL: s.mirrorInRTL ?? base.mirrorInRTL,
    };
  };
  let out = slot ? apply(l, l.specs[slot]) : l;
  if (platformSlot && platformSlot !== slot) out = apply(out, l.specs[platformSlot]);
  return out;
}

export const resolveCompositionFill = (composition: IconComposition, slot: string | null): Fill =>
  slot ? composition.fillSpecs?.[slot] ?? composition.fill : composition.fill;

export const allLayers = (doc: IconDocument): Layer[] => doc.composition.groups.flatMap((g) => g.layers);

export const blendDisplay = (b: BlendMode): string =>
  ({ "normal": "Normal", "plus-lighter": "Plus Lighter", "plus-darker": "Plus Darker", "multiply": "Multiply",
     "screen": "Screen", "overlay": "Overlay", "soft-light": "Soft Light", "hard-light": "Hard Light",
     "darken": "Darken", "lighten": "Lighten" }[b]);
