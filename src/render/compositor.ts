// Composites the document to a canvas: rasterize each layer's asset -> run the glass pipeline per
// glass layer (background = composited-so-far) -> draw with the layer's transform/blend -> chiclet mask.
// Browser port of Compositor.kt (Skia -> Canvas2D + WebGPU).
import {
  IconDocument, Group, Layer, Rendition, IcColor, Fill, PLATFORMS, RENDITIONS, specSlot, resolveGroup, resolveLayer,
  resolveCompositionFill,
} from "../model/types";
import { Renderer } from "./renderer";
import { buildUniforms } from "./uniforms";
import { squircle } from "./squircle";
import { paintBackdrop, type BackdropSpec } from "./backdrop";

export interface AssetEntry { name: string; dataUrl: string }

/** Appearance render mode derived from the previewed rendition's appearance code. */
interface AppearanceMode { monoFamily: boolean; tinted: boolean; hasBackdrop: boolean }

export class AssetStore {
  private images = new Map<string, HTMLImageElement>();

  async set(entries: AssetEntry[]) {
    this.images.clear();
    await Promise.all(entries.map((e) => this.add(e.name, e.dataUrl)));
  }
  async add(name: string, dataUrl: string) {
    const img = await loadImage(dataUrl);
    this.images.set(name, img);
  }
  get(name: string | null): HTMLImageElement | undefined {
    return name ? this.images.get(name) : undefined;
  }
  /** Original data URL of a stored asset (for re-encoding on save). */
  srcOf(name: string): string | undefined {
    return this.images.get(name)?.src;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

const blendOp = (b: string): GlobalCompositeOperation => {
  switch (b) {
    case "plus-lighter": return "lighter";
    case "plus-darker": case "multiply": return "multiply";
    case "screen": return "screen";
    case "overlay": return "overlay";
    case "soft-light": return "soft-light";
    case "hard-light": return "hard-light";
    case "darken": return "darken";
    case "lighten": return "lighten";
    default: return "source-over";
  }
};

function tmpCanvas(size: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  return c;
}
function tmpCanvasWH(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

export class Compositor {
  constructor(private renderer: Renderer | null, private assets: AssetStore) {}

  /** Rasterize a layer's asset to a size x size canvas (scaled-to-fit, 2x supersampled). */
  private rasterizeShape(layer: Layer, size: number): ImageData {
    const img = this.assets.get(layer.imageName);
    // SVG / placeholder = vector -> supersample 4x for crisp edges; raster only 2x.
    const isVector = !layer.imageName || layer.imageName.toLowerCase().endsWith(".svg");
    const ss = isVector ? 4 : 2;
    const r = size * ss;
    const c = tmpCanvas(r);
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, r, r);
    if (img) {
      const iw = img.naturalWidth || r, ih = img.naturalHeight || r;
      const scale = Math.min(r / iw, r / ih);
      const w = iw * scale, h = ih * scale;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, (r - w) / 2, (r - h) / 2, w, h);
    } else {
      // placeholder: centred squircle (white) so the glass effect shows out of the box
      const inset = r * 0.16, rad = r * 0.22, sz = r - 2 * inset;
      ctx.fillStyle = "#fff";
      squircle(ctx, inset, inset, sz, sz, rad);
      ctx.fill();
    }
    // downsample to size
    const out = tmpCanvas(size);
    const octx = out.getContext("2d")!;
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = "high";
    octx.drawImage(c, 0, 0, size, size);
    return octx.getImageData(0, 0, size, size);
  }

  /** Cheap per-layer preview thumbnail (asset image, or fill-tinted placeholder); no glass/bg/chiclet. */
  renderLayerThumb(layer: Layer, size: number): HTMLCanvasElement {
    const shape = this.rasterizeShape(layer, size);
    const data = layer.imageName ? shape : tintShape(shape, layer.fill.primaryColor);
    const c = tmpCanvas(size);
    c.getContext("2d")!.putImageData(data, 0, 0);
    return c;
  }

  async render(doc: IconDocument, size: number, slot: string | null = specSlot(doc.previewRendition), backdrop?: BackdropSpec): Promise<HTMLCanvasElement> {
    const canvas = tmpCanvas(size);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.clearRect(0, 0, size, size);

    // Mono/Tinted: the whole icon turns to clear glass; with a backdrop it refracts the canvas
    // background, and the system optionally tints the BACKGROUND while the foreground stays white.
    const code = RENDITIONS[doc.previewRendition].appearanceCode;
    const ap: AppearanceMode = {
      monoFamily: code === 3 || code === 4,
      tinted: code === 4 || ((code === 3) && doc.tintStrength > 0),
      hasBackdrop: !!backdrop && !!this.renderer,
    };

    // Base. Default/Dark: paint the backdrop (the glass refracts it) + the composition fill.
    // Mono: paint a neutral mid-grey so the clear glass refracts grey (not black); the real backdrop
    // colour is applied at the very end via a plus-lighter/darker modulation so the icon blends in.
    if (ap.monoFamily) {
      if (ap.hasBackdrop) { ctx.fillStyle = "#808080"; ctx.fillRect(0, 0, size, size); }
    } else {
      if (backdrop) paintBackdrop(ctx, size, size, backdrop);
      // Chiclet glass BODY = refract ONLY what's behind the glass (the backdrop) into a shaped slab.
      // The design (colour-tint) is painted ON TOP next, so it sits on the glass and is NOT refracted
      // by its own container; the highlight rim then goes on top of that. Order: refraction → colour → rim.
      if (ap.hasBackdrop && backdrop) await this.applyChicletRefraction(ctx, doc, size, backdrop);
      paintBackground(ctx, doc, size, slot);
    }

    // hierarchy order is front-to-back; composite back-to-front
    for (const groupRaw of [...doc.composition.groups].reverse()) {
      const group = resolveGroup(groupRaw, slot, doc.previewPlatform);
      if (group.isHidden) continue;
      for (const layerRaw of [...group.layers].reverse()) {
        const layer = resolveLayer(layerRaw, slot, doc.previewPlatform);
        if (layer.isHidden) continue;
        await this.drawLayer(ctx, doc, group, layer, size, ap);
      }
    }

    // Container: mask to the chiclet shape, then a clean continuous rim. The per-layer glass already
    // refracts what's below it and carries each colour at the CORRECT position; a separate container
    // refraction displaced the whole colour layer relative to the rim, so it's removed.
    applyChiclet(ctx, canvas, doc, size);
    this.drawChicletRim(ctx, doc, size);

    // Mono (untinted): modulate the real backdrop by the icon's greyscale luminance (plus-lighter /
    // plus-darker) so it merges with the scene instead of reading as a flat black-and-white filter.
    if (ap.monoFamily && !ap.tinted && ap.hasBackdrop && backdrop) applyMonoBlend(ctx, size, backdrop);
    return canvas;
  }

  /**
   * Full preview SCENE: one canvas the size of the preview pane, the backdrop filling it and the
   * icon composited centred on it (glass refracting the same backdrop). The backdrop is therefore
   * part of the same canvas — no separate CSS layer that lags behind the icon when the bg changes.
   * Rendered at 2x for retina sharpness; the icon is centred in the area between the top/bottom bars.
   */
  async renderScene(doc: IconDocument, cssW: number, cssH: number, slot: string | null, backdrop: BackdropSpec | undefined, zoom: number): Promise<HTMLCanvasElement> {
    // retina-ish sharpness, but cap the longest edge so toDataURL of the scene stays cheap
    const SC = Math.max(1, Math.min(2, 1800 / Math.max(cssW, cssH, 1)));
    const W = Math.max(2, Math.round(cssW * SC)), H = Math.max(2, Math.round(cssH * SC));
    // window-level layout: side panels (Hierarchy 230, Inspector 300) + preview bars (top 44, bottom 92)
    const LEFT = 230 * SC, RIGHT = 300 * SC, TOP = 44 * SC, BOTTOM = 92 * SC;
    const scene = tmpCanvasWH(W, H);
    const sctx = scene.getContext("2d")!;
    if (backdrop) paintBackdrop(sctx, W, H, backdrop);
    const cw = Math.max(120, W - LEFT - RIGHT), ah = Math.max(120, H - TOP - BOTTOM);
    const iconSize = Math.max(48, Math.round(Math.min(cw, ah) * 0.62 * Math.min(2.5, Math.max(0.4, zoom))));
    const icon = await this.render(doc, iconSize, slot, backdrop);
    sctx.drawImage(icon, Math.round(LEFT + cw / 2 - iconSize / 2), Math.round(TOP + ah / 2 - iconSize / 2));
    return scene;
  }

  /**
   * Chiclet glass BODY: refract ONLY the backdrop (what's behind the icon) through the chiclet
   * shape and REPLACE the canvas with the shaped slab. The design (colour) is composited on top
   * afterwards, so it is never displaced by its own container's refraction. Rendered at a padded
   * resolution so the shape outline is JFA-seeded off the canvas edge, then cropped to full-bleed.
   */
  private async applyChicletRefraction(ctx: CanvasRenderingContext2D, doc: IconDocument, size: number, backdrop: BackdropSpec) {
    const pad = Math.max(4, Math.round(size * 0.05));
    const ps = size + 2 * pad;
    const p = PLATFORMS[doc.previewPlatform];
    const sc = tmpCanvas(ps); const sx = sc.getContext("2d")!;
    sx.fillStyle = "#fff";
    if (p.circle) { sx.beginPath(); sx.arc(ps / 2, ps / 2, size / 2, 0, Math.PI * 2); sx.fill(); }
    else { squircle(sx, pad, pad, size, size, size * p.cornerRadiusPct); sx.fill(); }
    const bc = tmpCanvas(ps); const bx = bc.getContext("2d")!;
    paintBackdrop(bx, ps, ps, backdrop); // the only thing refracted is the backdrop
    const out = await this.renderer!.render(
      new Uint8Array(sx.getImageData(0, 0, ps, ps).data.buffer),
      new Uint8Array(bx.getImageData(0, 0, ps, ps).data.buffer),
      ps, chicletUniforms(ps, doc),
    );
    const oc = tmpCanvas(ps); oc.getContext("2d")!.putImageData(new ImageData(out, ps, ps), 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(oc, -pad, -pad); // crop the centre back to full-bleed
  }

  /**
   * Clean, CONTINUOUS container highlight rim. Drawn as a light-directional path stroke along the
   * chiclet outline (not derived from the SDF, which produced a visible medial-axis seam at the
   * corner/edge junction). Brightest on the lit side, fading around, softened, clipped to the icon.
   */
  private drawChicletRim(ctx: CanvasRenderingContext2D, doc: IconDocument, size: number) {
    const p = PLATFORMS[doc.previewPlatform];
    const lw = Math.max(1.5, size * 0.016);
    const inset = lw / 2;
    const cx = size / 2, cy = size / 2, R = size / 2;
    const rc = tmpCanvas(size); const rx = rc.getContext("2d")!;
    rx.lineWidth = lw; rx.lineJoin = "round"; rx.lineCap = "round";
    const a = (doc.lightAngleDeg * Math.PI) / 180;
    const dx = Math.cos(a), dy = Math.sin(a);
    const g = rx.createLinearGradient(cx - dx * R, cy - dy * R, cx + dx * R, cy + dy * R);
    g.addColorStop(0.0, "rgba(255,255,255,0.5)");
    g.addColorStop(0.4, "rgba(255,255,255,0)");
    
    g.addColorStop(0.7, "rgba(255,255,255,0)");
    g.addColorStop(1.0, "rgba(255,255,255,0.2)");
    rx.strokeStyle = g;
    if (p.circle) { rx.beginPath(); rx.arc(cx, cy, R - inset, 0, Math.PI * 2); rx.stroke(); }
    else { squircle(rx, inset, inset, size - 2 * inset, size - 2 * inset, size * p.cornerRadiusPct - inset); rx.stroke(); }
    const soft = tmpCanvas(size); const sftx = soft.getContext("2d")!;
    sftx.filter = `blur(${Math.max(0.6, size * 0.0035)}px)`;
    sftx.drawImage(rc, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = "source-atop"; // overlay only where the icon already is
    ctx.drawImage(soft, 0, 0);
    ctx.restore();
  }

  private async drawLayer(ctx: CanvasRenderingContext2D, doc: IconDocument, group: Group, layer: Layer, size: number, ap: AppearanceMode) {
    const shapeData = this.rasterizeShape(layer, size);
    let layerCanvas: HTMLCanvasElement;
    // Mono/Tinted (with a backdrop to refract): EVERY layer becomes clear glass, then the composite
    // maps it to greyscale (Mono, code 3) or greyscale x tint (Tinted, code 4). Non-mono: glass layers only.
    const renderGlass = group.glassEnabled && !!this.renderer && (ap.monoFamily ? ap.hasBackdrop : layer.isGlass);
    if (renderGlass) {
      const bg = ctx.getImageData(0, 0, size, size);
      const sampled = layer.imageName ? sampledColor(shapeData) : null;
      // Mono: ONLY the (originally non-glass) background becomes clear glass — transparent, no
      // blur, no colour body — so it refracts the backdrop. Real glass layers keep their blur and
      // translucency. The appearance code maps everything to greyscale (Mono) / greyscale x tint (Tinted).
      const clearBg = ap.monoFamily && !layer.isGlass;
      const g2 = clearBg ? { ...group, translucency: { enabled: true, value: 1 }, blurMaterial: { enabled: false, strength: 0 } } : group;
      const layerU = clearBg ? { ...layer, isGlass: true, fill: { ...layer.fill, kind: "none" as const } } : layer;
      const docU = ap.monoFamily ? ({ ...doc, previewRendition: (ap.tinted ? "TintedLight" : "Mono") as Rendition }) : doc;
      const u = buildUniforms(size, docU, g2, layerU, sampled, layerU.imageName != null);
      const out = await this.renderer!.render(new Uint8Array(shapeData.data.buffer), new Uint8Array(bg.data.buffer), size, u);
      layerCanvas = imageToCanvas(new ImageData(out, size, size));
    } else if (ap.monoFamily) {
      // no-WebGPU fallback: mono = white; tinted = the tint colour (whole icon)
      const col: IcColor = ap.tinted ? doc.tintColor : { r: 1, g: 1, b: 1, a: 1 };
      layerCanvas = imageToCanvas(tintShape(shapeData, col));
    } else {
      // non-glass: tint by fill colour
      layerCanvas = layer.fill.kind === "none" && layer.imageName
        ? imageToCanvas(shapeData)
        : imageToCanvas(fillShape(shapeData, layer.fill, RENDITIONS[doc.previewRendition].dark));
    }
    ctx.save();
    const k = size / 1024;
    const cx = size / 2, cy = size / 2;
    ctx.translate((group.position.x + layer.position.x) * k, (group.position.y + layer.position.y) * k);
    ctx.translate(cx, cy);
    ctx.scale(group.scale * layer.scale, group.scale * layer.scale);
    ctx.translate(-cx, -cy);
    ctx.globalAlpha = layer.opacity * group.opacity;
    ctx.globalCompositeOperation = blendOp(layer.blendMode);
    ctx.drawImage(layerCanvas, 0, 0);
    ctx.restore();
  }
}

// ---- helpers ----
function imageToCanvas(data: ImageData): HTMLCanvasElement {
  const c = tmpCanvas(data.width);
  c.getContext("2d")!.putImageData(data, 0, 0);
  return c;
}

/**
 * Uniforms for the chiclet glass BODY: refract the (backdrop) bg with NO colour body (glassCol
 * opacity 0) and NO SDF specular (specularOn 0 — the rim is drawn in Canvas2D), appearance code 0.
 */
function chicletUniforms(size: number, doc: IconDocument): Float32Array<ArrayBuffer> {
  const res = size, texel = 1 / size;
  const lr = (doc.lightAngleDeg * Math.PI) / 180;
  const ldx = Math.cos(lr), ldy = Math.sin(lr);
  return new Float32Array([
    res, res, texel, texel,
    0.18 * res, 0.06, 0.03 * res, 0.7,           // sdfRange, height, refractScale (edge bevel), curvature
    ldx, ldy, 0.3, 0.4,                          // lightDir, spread, biasAmount
    0.5, 0, 0, 0,                                // glowRadiusNorm, blur, shadowRadius, shadowOpacity
    0, 0, 0, 0,                                  // jfaStep, blurDir, appearanceCode=0
    1, 1, 1, 0,                                  // glassCol white, opacity 0 (no colour body)
    doc.tintColor.r, doc.tintColor.g, doc.tintColor.b, 0,
    0, 0, 0, 0,                                  // shadowCol
    0, 0, 0, 0,                                  // shadowOff, specularOn=0, glowOn
    1, 0, 0, 0,                                  // glassOn=1, translucency, assetColorOn, layerColorShadowOn
    0, 0, 0, 0,
    0, 0, 0, 0,
  ]);
}

const clampByte = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * Mono blend: replace the greyscale icon body with the REAL backdrop modulated by the icon's
 * luminance (centred at mid-grey) — plus-lighter for highlights, plus-darker for shadows. The icon
 * then merges into the scene (the backdrop colour shows through) instead of reading as flat B&W.
 */
function applyMonoBlend(ctx: CanvasRenderingContext2D, size: number, backdrop: BackdropSpec) {
  const icon = ctx.getImageData(0, 0, size, size);
  const bdC = tmpCanvas(size); const bx = bdC.getContext("2d")!;
  paintBackdrop(bx, size, size, backdrop);
  const b = bx.getImageData(0, 0, size, size).data;
  const d = icon.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; // 0..255
    const delta = (lum - 128) * 2;                                  // mid-grey -> no change
    d[i] = clampByte(b[i] + delta);
    d[i + 1] = clampByte(b[i + 1] + delta);
    d[i + 2] = clampByte(b[i + 2] + delta);
  }
  ctx.putImageData(icon, 0, 0);
}

function tintShape(shape: ImageData, color: IcColor): ImageData {
  const out = new ImageData(shape.width, shape.height);
  const r = (color.r * 255) | 0, g = (color.g * 255) | 0, b = (color.b * 255) | 0;
  for (let i = 0; i < shape.data.length; i += 4) {
    out.data[i] = r; out.data[i + 1] = g; out.data[i + 2] = b; out.data[i + 3] = shape.data[i + 3];
  }
  return out;
}

function mix(a: IcColor, b: IcColor, t: number): IcColor {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    a: a.a + (b.a - a.a) * t,
  };
}

function fillShape(shape: ImageData, fill: Fill, dark: boolean): ImageData {
  const out = new ImageData(shape.width, shape.height);
  if (fill.kind === "none") return out;

  const [x0, y0, x1, y1] = gradientLine(Math.max(shape.width, shape.height), fill.orientationDeg);
  const vx = x1 - x0, vy = y1 - y0;
  const denom = vx * vx + vy * vy || 1;
  const gradientStop = fill.kind === "automaticGradient" ? shade(fill.primaryColor, dark ? 0.55 : 0.78) : fill.secondaryColor;

  for (let y = 0; y < shape.height; y++) {
    for (let x = 0; x < shape.width; x++) {
      const i = (y * shape.width + x) * 4;
      const alpha = shape.data[i + 3] / 255;
      if (alpha <= 0) continue;
      const t = fill.kind === "linearGradient" || fill.kind === "automaticGradient"
        ? Math.max(0, Math.min(1, ((x - x0) * vx + (y - y0) * vy) / denom))
        : 0;
      const c = fill.kind === "linearGradient" || fill.kind === "automaticGradient" ? mix(fill.primaryColor, gradientStop, t) : fill.primaryColor;
      out.data[i] = Math.round(c.r * 255);
      out.data[i + 1] = Math.round(c.g * 255);
      out.data[i + 2] = Math.round(c.b * 255);
      out.data[i + 3] = Math.round(alpha * c.a * 255);
    }
  }
  return out;
}

function sampledColor(data: ImageData): IcColor | null {
  let r = 0, g = 0, b = 0, aSum = 0;
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    if (a <= 0.02) continue;
    r += (d[i] / 255) * a; g += (d[i + 1] / 255) * a; b += (d[i + 2] / 255) * a; aSum += a;
  }
  if (aSum <= 0) return null;
  return { r: r / aSum, g: g / aSum, b: b / aSum, a: Math.max(0.35, Math.min(1, aSum / (d.length / 4))) };
}

function cssColor(c: IcColor): string {
  const to = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255);
  return `rgba(${to(c.r)},${to(c.g)},${to(c.b)},${c.a})`;
}

function gradientLine(size: number, deg: number): [number, number, number, number] {
  const r = (deg * Math.PI) / 180;
  const dx = Math.cos(r) * size * 0.5;
  const dy = Math.sin(r) * size * 0.5;
  return [size / 2 - dx, size / 2 - dy, size / 2 + dx, size / 2 + dy];
}

function shade(c: IcColor, amount: number): IcColor {
  return {
    r: Math.max(0, Math.min(1, c.r * amount)),
    g: Math.max(0, Math.min(1, c.g * amount)),
    b: Math.max(0, Math.min(1, c.b * amount)),
    a: c.a,
  };
}

function paintBackground(ctx: CanvasRenderingContext2D, doc: IconDocument, size: number, slot: string | null) {
  const f: Fill = resolveCompositionFill(doc.composition, slot);
  const dark = RENDITIONS[doc.previewRendition].dark;
  if (f.kind === "none") return;
  if (f.kind === "solid") {
    ctx.fillStyle = cssColor(f.primaryColor);
    ctx.fillRect(0, 0, size, size);
    return;
  }
  const line = gradientLine(size, f.kind === "automatic" ? 90 : f.orientationDeg);
  const grad = ctx.createLinearGradient(...line);
  if (f.kind === "linearGradient") {
    grad.addColorStop(0, cssColor(f.primaryColor));
    grad.addColorStop(1, cssColor(f.secondaryColor));
  } else if (f.kind === "automaticGradient") {
    grad.addColorStop(0, cssColor(f.primaryColor));
    grad.addColorStop(1, cssColor(shade(f.primaryColor, dark ? 0.55 : 0.78)));
  } else {
    // automatic: system background gradient
    if (dark) { grad.addColorStop(0, "rgb(60,60,66)"); grad.addColorStop(1, "rgb(24,24,28)"); }
    else { grad.addColorStop(0, "rgb(246,247,250)"); grad.addColorStop(1, "rgb(219,222,230)"); }
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
}

function applyChiclet(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, doc: IconDocument, size: number) {
  const p = PLATFORMS[doc.previewPlatform];
  const mask = tmpCanvas(size);
  const mc = mask.getContext("2d")!;
  mc.fillStyle = "#fff";
  if (p.circle) { mc.beginPath(); mc.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); mc.fill(); }
  else { squircle(mc, 0, 0, size, size, size * p.cornerRadiusPct); mc.fill(); }
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = "source-over";
}
