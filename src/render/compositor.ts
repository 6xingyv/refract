// Composites the document to a canvas: rasterize each layer's asset -> run the glass pipeline per
// glass layer (background = composited-so-far) -> draw with the layer's transform/blend -> chiclet mask.
// Browser port of Compositor.kt (Skia -> Canvas2D + WebGPU).
import {
  IconDocument, Group, Layer, Rendition, IcColor, Fill, PLATFORMS, RENDITIONS, specSlot, resolveGroup, resolveLayer,
  resolveCompositionFill,
} from "../model/types";
import { Renderer } from "./renderer";
import { buildUniforms, type ShapeBounds } from "./uniforms";
import { squircle } from "./squircle";
import { paintBackdrop, type BackdropSpec } from "./backdrop";

export interface AssetEntry { name: string; dataUrl: string }

/** Appearance render mode derived from the previewed rendition's appearance code. */
interface AppearanceMode { monoFamily: boolean; tinted: boolean; hasBackdrop: boolean }
interface ShapeCacheEntry { data: ImageData; sampled: IcColor | null; bounds: ShapeBounds }
interface LayerDrawItem { kind: "layer"; group: Group; layer: Layer; shape: ImageData }
interface CombinedPart { layer: Layer; shape: ImageData }
interface CombinedDrawItem {
  kind: "combined";
  group: Group;
  layer: Layer;
  shape: ImageData;
  color: ImageData;
  shapeKey: string;
  bounds: ShapeBounds;
  clearBg: boolean;
}
type DrawItem = LayerDrawItem | CombinedDrawItem;

export interface RenderOptions {
  layer?: "combined" | "foreground" | "background";
  clipChiclet?: boolean;
  chicletHighlight?: boolean;
  materialAlphaMask?: boolean;
}

export class AssetStore {
  private images = new Map<string, HTMLImageElement>();
  private version = 0;

  get revision() {
    return this.version;
  }

  async set(entries: AssetEntry[]) {
    this.images.clear();
    await Promise.all(entries.map((e) => this.add(e.name, e.dataUrl)));
    this.version += 1;
  }
  async add(name: string, dataUrl: string) {
    const img = await loadImage(dataUrl);
    this.images.set(name, img);
    this.version += 1;
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

export class Compositor {
  private shapeCache = new Map<string, ShapeCacheEntry>();
  private chicletCache = new Map<string, HTMLCanvasElement>();

  constructor(private renderer: Renderer | null, private assets: AssetStore) {}

  private shapeKey(layer: Layer, size: number) {
    return `${this.assets.revision}:${layer.imageName ?? "__placeholder"}:${size}`;
  }

  private layerRenderKey(doc: IconDocument, layer: Layer, size: number, clearBg: boolean) {
    const base = this.shapeKey(layer, size);
    return clearBg || layer.fill.kind === "none"
      ? base
      : `${base}:fill:${doc.previewRendition}:${JSON.stringify(layer.fill)}`;
  }

  private chicletKey(doc: IconDocument, size: number, backdrop: BackdropSpec) {
    const bg = backdrop.kind === "image" ? `image:${backdrop.image}` : `color:${backdrop.color}`;
    return `${doc.previewPlatform}:${size}:${bg}`;
  }

  /** Rasterize a layer's asset to a size x size canvas (scaled-to-fit, 2x supersampled). */
  private rasterizeShape(layer: Layer, size: number): ImageData {
    const key = this.shapeKey(layer, size);
    const cached = this.shapeCache.get(key);
    if (cached) return cached.data;

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
    const data = octx.getImageData(0, 0, size, size);
    this.shapeCache.set(key, { data, sampled: layer.imageName ? sampledColor(data) : null, bounds: shapeAlphaBounds(data) });
    if (this.shapeCache.size > 96) this.shapeCache.delete(this.shapeCache.keys().next().value!);
    return data;
  }

  private sampledShapeColor(layer: Layer, size: number, shape: ImageData): IcColor | null {
    if (!layer.imageName) return null;
    const key = this.shapeKey(layer, size);
    const cached = this.shapeCache.get(key);
    if (cached) return cached.sampled;
    const sampled = sampledColor(shape);
    this.shapeCache.set(key, { data: shape, sampled, bounds: shapeAlphaBounds(shape) });
    return sampled;
  }

  private shapeBounds(layer: Layer, size: number, shape: ImageData): ShapeBounds {
    const key = this.shapeKey(layer, size);
    const cached = this.shapeCache.get(key);
    if (cached) return cached.bounds;
    const bounds = shapeAlphaBounds(shape);
    this.shapeCache.set(key, { data: shape, sampled: layer.imageName ? sampledColor(shape) : null, bounds });
    return bounds;
  }

  private glassLayerOn(group: Group, layer: Layer, ap: AppearanceMode) {
    return group.glassEnabled && !!this.renderer && (ap.monoFamily ? ap.hasBackdrop : layer.isGlass);
  }

  private glassLayerContributesToCombined(group: Group, layer: Layer) {
    return group.glassEnabled && !!this.renderer && layer.isGlass;
  }

  private glassUniformInputs(doc: IconDocument, group: Group, layer: Layer, ap: AppearanceMode, clearBg: boolean) {
    const g2 = clearBg ? { ...group, translucency: { enabled: true, value: 1 }, blurMaterial: { enabled: false, strength: 0 } } : group;
    const layerU = clearBg ? { ...layer, isGlass: true, fill: { ...layer.fill, kind: "none" as const } } : layer;
    const docU = ap.monoFamily ? ({ ...doc, previewRendition: (ap.tinted ? "TintedLight" : "Mono") as Rendition }) : doc;
    return { docU, g2, layerU };
  }

  private buildDrawItems(doc: IconDocument, size: number, slot: string | null, ap: AppearanceMode): DrawItem[] {
    const drawItems: DrawItem[] = [];
    for (const groupRaw of [...doc.composition.groups].reverse()) {
      const group = resolveGroup(groupRaw, slot, doc.previewPlatform);
      if (group.isHidden) continue;

      let combinedRun: CombinedPart[] = [];
      let runClearBg = false;
      const flushCombinedRun = () => {
        if (!combinedRun.length) return;
        drawItems.push(this.makeCombinedItem(doc, group, combinedRun, size, runClearBg));
        combinedRun = [];
      };

      for (const layerRaw of [...group.layers].reverse()) {
        const layer = resolveLayer(layerRaw, slot, doc.previewPlatform);
        if (layer.isHidden) continue;
        const shape = this.rasterizeShape(layer, size);
        const renderGlass = this.glassLayerOn(group, layer, ap);
        const clearBg = ap.monoFamily && !layer.isGlass;
        const combine = group.lighting === "combined" && this.glassLayerContributesToCombined(group, layer);

        if (combine) {
          if (combinedRun.length && runClearBg !== clearBg) flushCombinedRun();
          runClearBg = clearBg;
          combinedRun.push({ layer, shape });
        } else {
          flushCombinedRun();
          drawItems.push({ kind: "layer", group, layer, shape });
        }
      }
      flushCombinedRun();
    }
    return drawItems;
  }

  private makeCombinedItem(doc: IconDocument, group: Group, parts: CombinedPart[], size: number, clearBg: boolean): CombinedDrawItem {
    const alphaCanvas = tmpCanvas(size);
    const alphaCtx = alphaCanvas.getContext("2d")!;
    const colorCanvas = tmpCanvas(size);
    const colorCtx = colorCanvas.getContext("2d")!;
    const dark = RENDITIONS[doc.previewRendition].dark;

    for (const { layer, shape } of parts) {
      const shapeCanvas = imageToCanvas(shape);
      alphaCtx.save();
      applyLayerTransform(alphaCtx, group, layer, size);
      alphaCtx.globalAlpha = layer.opacity;
      alphaCtx.drawImage(shapeCanvas, 0, 0);
      alphaCtx.restore();

      const colorShape = clearBg ? transparentShapeColor(shape) : glassColorShape(shape, layer, dark);
      colorCtx.save();
      applyLayerTransform(colorCtx, group, layer, size);
      colorCtx.globalAlpha = layer.opacity;
      colorCtx.globalCompositeOperation = blendOp(layer.blendMode);
      colorCtx.drawImage(imageToCanvas(colorShape), 0, 0);
      colorCtx.restore();
    }

    const shape = alphaCtx.getImageData(0, 0, size, size);
    const color = colorCtx.getImageData(0, 0, size, size);
    const layer = {
      ...parts[0].layer,
      imageName: null,
      isGlass: true,
      fill: { ...parts[0].layer.fill, kind: "none" as const },
      opacity: 1,
      position: { x: 0, y: 0 },
      scale: 1,
      blendMode: "normal" as const,
      specular: { ...group.specular, enabled: false },
    };

    return {
      kind: "combined",
      group,
      layer,
      shape,
      color,
      shapeKey: this.combinedShapeKey(doc, group, parts, size, clearBg),
      bounds: shapeAlphaBounds(shape),
      clearBg,
    };
  }

  private combinedShapeKey(doc: IconDocument, group: Group, parts: CombinedPart[], size: number, clearBg: boolean) {
    const partKey = parts.map(({ layer }) => ({
      id: layer.id,
      imageName: layer.imageName,
      fill: layer.fill,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      position: layer.position,
      scale: layer.scale,
      isGlass: layer.isGlass,
    }));
    return `combined:${this.assets.revision}:${doc.previewPlatform}:${doc.previewRendition}:${size}:${clearBg}:${group.id}:${group.position.x},${group.position.y},${group.scale}:${JSON.stringify(partKey)}`;
  }

  /** Cheap per-layer preview thumbnail; applies fill when present, with no glass/bg/chiclet. */
  renderLayerThumb(layer: Layer, size: number): HTMLCanvasElement {
    const shape = this.rasterizeShape(layer, size);
    const data = layer.imageName && layer.fill.kind === "none" ? shape : fillShape(shape, layer.fill, false);
    const c = tmpCanvas(size);
    c.getContext("2d")!.putImageData(data, 0, 0);
    return c;
  }

  async render(
    doc: IconDocument,
    size: number,
    slot: string | null = specSlot(doc.previewRendition),
    backdrop?: BackdropSpec,
    options: RenderOptions = {},
  ): Promise<HTMLCanvasElement> {
    const canvas = tmpCanvas(size);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.clearRect(0, 0, size, size);
    const layer = options.layer ?? "combined";
    const includeBackground = layer !== "foreground";
    const includeForeground = layer !== "background";
    const clipChiclet = options.clipChiclet ?? true;
    const chicletHighlight = options.chicletHighlight ?? clipChiclet;
    const materialAlphaMask = options.materialAlphaMask ?? false;

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
    if (!includeBackground) {
      // A layered foreground export must retain a transparent base.
    } else if (ap.monoFamily) {
      if (layer === "background") {
        paintBackground(ctx, doc, size, slot);
      } else if (ap.hasBackdrop) {
        ctx.fillStyle = "#808080";
        ctx.fillRect(0, 0, size, size);
      }
    } else {
      // Chiclet glass BODY = refract ONLY what's behind the glass (the backdrop) into a shaped slab.
      // The design (colour-tint) is painted ON TOP next, so it sits on the glass and is NOT refracted
      // by its own container; the highlight rim then goes on top of that. Order: refraction → colour → rim.
      if (ap.hasBackdrop && backdrop) await this.applyChicletRefraction(ctx, doc, size, backdrop);
      else if (backdrop) paintBackdrop(ctx, size, size, backdrop);
      paintBackground(ctx, doc, size, slot);
    }

    const drawItems = includeForeground ? this.buildDrawItems(doc, size, slot, ap) : [];
    if (includeForeground && this.renderer) {
      const prepares: {
        shape: Uint8Array<ArrayBuffer>;
        size: number;
        uniforms: Float32Array<ArrayBuffer>;
        shapeKey: string;
      }[] = [];
      for (const item of drawItems) {
        if (item.kind === "layer" && !this.glassLayerOn(item.group, item.layer, ap)) continue;
        const clearBg = item.kind === "combined" ? item.clearBg : ap.monoFamily && !item.layer.isGlass;
        const { docU, g2, layerU } = this.glassUniformInputs(doc, item.group, item.layer, ap, clearBg);
        const sampled = item.kind === "combined" ? null : this.sampledShapeColor(item.layer, size, item.shape);
        const usesColorTexture = item.kind === "combined" ? true : glassUsesColorTexture(layerU, clearBg);
        const bounds = item.kind === "combined" ? item.bounds : this.shapeBounds(item.layer, size, item.shape);
        const u = buildUniforms(size, docU, g2, layerU, sampled, usesColorTexture, bounds);
        if (materialAlphaMask) u[44] = 1;
        prepares.push({
          shape: new Uint8Array(item.shape.data.buffer),
          size,
          uniforms: u,
          shapeKey: item.kind === "combined" ? item.shapeKey : this.layerRenderKey(docU, layerU, size, clearBg),
        });
      }
      if (prepares.length) this.renderer.prepareShapes(prepares);
    }

    // hierarchy order is front-to-back; composite back-to-front. Shape/SDF preparation above is
    // independent per layer; this loop remains serial because each glass layer samples the pixels
    // already composited below it.
    for (const item of drawItems) {
      if (item.kind === "combined") await this.drawCombined(ctx, doc, item, size, ap, materialAlphaMask);
      else await this.drawLayer(ctx, doc, item.group, item.layer, item.shape, size, ap, materialAlphaMask);
    }

    // Container: mask to the chiclet shape, then a clean continuous rim. The per-layer glass already
    // refracts what's below it and carries each colour at the CORRECT position; a separate container
    // refraction displaced the whole colour layer relative to the rim, so it's removed.
    if (clipChiclet) applyChiclet(ctx, canvas, doc, size);
    if (chicletHighlight && includeBackground) this.drawChicletRim(ctx, doc, size);

    // Mono (untinted): modulate the real backdrop by the icon's greyscale luminance (plus-lighter /
    // plus-darker) so it merges with the scene instead of reading as a flat black-and-white filter.
    if (ap.monoFamily && !ap.tinted && ap.hasBackdrop && backdrop) applyMonoBlend(ctx, size, backdrop);
    return canvas;
  }

  /**
   * Chiclet glass BODY: refract ONLY the backdrop (what's behind the icon) through the chiclet
   * shape and REPLACE the canvas with the shaped slab. The design (colour) is composited on top
   * afterwards, so it is never displaced by its own container's refraction. Rendered at a padded
   * resolution so the shape outline is JFA-seeded off the canvas edge, then cropped to full-bleed.
   */
  private async applyChicletRefraction(ctx: CanvasRenderingContext2D, doc: IconDocument, size: number, backdrop: BackdropSpec) {
    const key = this.chicletKey(doc, size, backdrop);
    const cached = this.chicletCache.get(key);
    if (cached) {
      this.chicletCache.delete(key);
      this.chicletCache.set(key, cached);
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(cached, 0, 0);
      return;
    }

    const pad = Math.max(4, Math.round(size * 0.05));
    const ps = size + 2 * pad;
    const p = PLATFORMS[doc.previewPlatform];
    const sc = tmpCanvas(ps); const sx = sc.getContext("2d")!;
    sx.fillStyle = "#fff";
    if (p.circle) { sx.beginPath(); sx.arc(ps / 2, ps / 2, size / 2, 0, Math.PI * 2); sx.fill(); }
    else { squircle(sx, pad, pad, size, size, size * p.cornerRadiusPct); sx.fill(); }
    const bc = tmpCanvas(ps); const bx = bc.getContext("2d")!;
    paintBackdrop(bx, ps, ps, backdrop); // the only thing refracted is the backdrop
    const chicletShape = new Uint8Array(sx.getImageData(0, 0, ps, ps).data.buffer);
    const out = await this.renderer!.render(
      chicletShape,
      chicletShape,
      new Uint8Array(bx.getImageData(0, 0, ps, ps).data.buffer),
      ps, chicletUniforms(ps, doc), `chiclet:${doc.previewPlatform}:${ps}`,
    );
    const oc = tmpCanvas(ps); oc.getContext("2d")!.putImageData(new ImageData(out, ps, ps), 0, 0);
    const cropped = tmpCanvas(size);
    cropped.getContext("2d")!.drawImage(oc, -pad, -pad); // crop the centre back to full-bleed
    this.chicletCache.set(key, cropped);
    if (this.chicletCache.size > 24) this.chicletCache.delete(this.chicletCache.keys().next().value!);
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(cropped, 0, 0);
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

  private async drawLayer(
    ctx: CanvasRenderingContext2D,
    doc: IconDocument,
    group: Group,
    layer: Layer,
    shapeData: ImageData,
    size: number,
    ap: AppearanceMode,
    materialAlphaMask = false,
  ) {
    let layerCanvas: HTMLCanvasElement;
    // Mono/Tinted (with a backdrop to refract): EVERY layer becomes clear glass, then the composite
    // maps it to greyscale (Mono, code 3) or greyscale x tint (Tinted, code 4). Non-mono: glass layers only.
    const renderGlass = this.glassLayerOn(group, layer, ap);
    if (renderGlass) {
      const bg = ctx.getImageData(0, 0, size, size);
      const sampled = this.sampledShapeColor(layer, size, shapeData);
      // Mono: ONLY the (originally non-glass) background becomes clear glass — transparent, no
      // blur, no colour body — so it refracts the backdrop. Real glass layers keep their blur and
      // translucency. The appearance code maps everything to greyscale (Mono) / greyscale x tint (Tinted).
      const clearBg = ap.monoFamily && !layer.isGlass;
      const { docU, g2, layerU } = this.glassUniformInputs(doc, group, layer, ap, clearBg);
      const colorShape = clearBg ? transparentShapeColor(shapeData) : glassColorShape(shapeData, layerU, RENDITIONS[doc.previewRendition].dark);
      const usesColorTexture = glassUsesColorTexture(layerU, clearBg);
      const u = buildUniforms(size, docU, g2, layerU, sampled, usesColorTexture, this.shapeBounds(layer, size, shapeData));
      if (materialAlphaMask) u[44] = 1;
      const shapeBytes = new Uint8Array(shapeData.data.buffer);
      const out = await this.renderer!.render(
        shapeBytes,
        new Uint8Array(colorShape.data.buffer),
        new Uint8Array(bg.data.buffer),
        size,
        u,
        this.layerRenderKey(docU, layerU, size, clearBg),
      );
      layerCanvas = imageToCanvas(new ImageData(out, size, size));
    } else if (ap.monoFamily) {
      // no-WebGPU / no-backdrop fallback: apply the layer fill first, then the appearance filter.
      const colorShape = layer.fill.kind === "none" && layer.imageName
        ? shapeData
        : fillShape(shapeData, layer.fill, RENDITIONS[doc.previewRendition].dark);
      layerCanvas = imageToCanvas(filterAppearance(colorShape, doc, ap));
    } else {
      // non-glass: tint by fill colour
      layerCanvas = layer.fill.kind === "none" && layer.imageName
        ? imageToCanvas(shapeData)
        : imageToCanvas(fillShape(shapeData, layer.fill, RENDITIONS[doc.previewRendition].dark));
    }
    ctx.save();
    applyLayerTransform(ctx, group, layer, size);
    ctx.globalAlpha = layer.opacity * group.opacity;
    ctx.globalCompositeOperation = blendOp(layer.blendMode);
    ctx.drawImage(layerCanvas, 0, 0);
    ctx.restore();
  }

  private async drawCombined(
    ctx: CanvasRenderingContext2D,
    doc: IconDocument,
    item: CombinedDrawItem,
    size: number,
    ap: AppearanceMode,
    materialAlphaMask = false,
  ) {
    const bg = ctx.getImageData(0, 0, size, size);
    const { docU, g2, layerU } = this.glassUniformInputs(doc, item.group, item.layer, ap, item.clearBg);
    const u = buildUniforms(size, docU, g2, layerU, null, true, item.bounds);
    if (materialAlphaMask) u[44] = 1;
    const out = await this.renderer!.render(
      new Uint8Array(item.shape.data.buffer),
      new Uint8Array(item.color.data.buffer),
      new Uint8Array(bg.data.buffer),
      size,
      u,
      item.shapeKey,
    );
    const layerCanvas = imageToCanvas(new ImageData(out, size, size));
    ctx.save();
    ctx.globalAlpha = item.group.opacity;
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

function applyLayerTransform(ctx: CanvasRenderingContext2D, group: Group, layer: Layer, size: number) {
  const k = size / 1024;
  const cx = size / 2, cy = size / 2;
  ctx.translate((group.position.x + layer.position.x) * k, (group.position.y + layer.position.y) * k);
  ctx.translate(cx, cy);
  ctx.scale(group.scale * layer.scale, group.scale * layer.scale);
  ctx.translate(-cx, -cy);
}

function transparentShapeColor(shape: ImageData): ImageData {
  return new ImageData(shape.width, shape.height);
}

function glassUsesColorTexture(layer: Layer, clearBg: boolean): boolean {
  return !clearBg && (layer.imageName != null || layer.fill.kind !== "none");
}

function glassColorShape(shape: ImageData, layer: Layer, dark: boolean): ImageData {
  if (layer.imageName && layer.fill.kind === "none") return shape;
  const out = fillShape(shape, layer.fill, dark);
  if (layer.fill.kind === "none") return out;
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = Math.round(out.data[i] * 0.65);
  return out;
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
    0, 1, 0, 0,
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

function filterAppearance(shape: ImageData, doc: IconDocument, ap: AppearanceMode): ImageData {
  const out = new ImageData(shape.width, shape.height);
  const tintStrength = ap.tinted ? Math.max(0, Math.min(1, doc.tintStrength)) : 0;
  for (let i = 0; i < shape.data.length; i += 4) {
    const r = shape.data[i];
    const g = shape.data[i + 1];
    const b = shape.data[i + 2];
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (!ap.tinted) {
      out.data[i] = Math.round(luma);
      out.data[i + 1] = Math.round(luma);
      out.data[i + 2] = Math.round(luma);
      out.data[i + 3] = shape.data[i + 3];
      continue;
    }
    const tr = Math.min(255, luma * doc.tintColor.r * 2);
    const tg = Math.min(255, luma * doc.tintColor.g * 2);
    const tb = Math.min(255, luma * doc.tintColor.b * 2);
    out.data[i] = Math.round(r + (tr - r) * tintStrength);
    out.data[i + 1] = Math.round(g + (tg - g) * tintStrength);
    out.data[i + 2] = Math.round(b + (tb - b) * tintStrength);
    out.data[i + 3] = shape.data[i + 3];
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

function shapeAlphaBounds(data: ImageData): ShapeBounds {
  let minY = data.height;
  let maxY = -1;
  const d = data.data;
  for (let y = 0; y < data.height; y++) {
    const row = y * data.width * 4;
    for (let x = 0; x < data.width; x++) {
      if (d[row + x * 4 + 3] <= 2) continue;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      break;
    }
  }
  if (maxY < minY) return { top: 0, bottom: 1 };
  return {
    top: minY / data.height,
    bottom: (maxY + 1) / data.height,
  };
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
