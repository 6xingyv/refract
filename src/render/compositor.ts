// Composites the document to a canvas: rasterize each layer's asset -> run the glass pipeline per
// glass layer (background = composited-so-far) -> draw with the layer's transform/blend -> chiclet mask.
// Browser port of Compositor.kt (Skia -> Canvas2D + WebGPU).
import {
  IconDocument, Group, Layer, IcColor, Fill, PLATFORMS, RENDITIONS, specSlot, resolveGroup, resolveLayer,
  resolveCompositionFill,
} from "../model/types";
import { Renderer } from "./renderer";
import { buildUniforms, type ShapeBounds } from "./uniforms";
import { squircle } from "./squircle";
import { paintBackdrop, type BackdropSpec } from "./backdrop";
import { materialAppearance, artworkColorMatrix, backdropColorMatrix, transformAppearance, type MaterialAppearance } from "./appearance";
import { chicletHighlightUniforms } from "./highlightParameters";
import { svgCoverageSource } from "./svgCoverage";
import { materialBlendCode } from "./blendParameters";
import { COATING_BLEND_SLOT } from "./uniformLayout";

export interface AssetEntry { name: string; dataUrl: string }

/** Appearance render mode derived from the previewed rendition's appearance code. */
interface AppearanceMode extends MaterialAppearance { monoFamily: boolean }
interface ShapeCacheEntry {
  data: ImageData;
  sampled: IcColor | null;
  bounds: ShapeBounds;
  glassShape?: ImageData;
}
interface LayerDrawItem {
  kind: "layer"; group: Group; layer: Layer;
  shape: ImageData; geometry: ImageData; color: ImageData;
  bounds: ShapeBounds; shapeKey: string;
}
interface CombinedPart { layer: Layer; shape: ImageData }
interface CombinedDrawItem {
  kind: "combined";
  group: Group;
  layer: Layer;
  shape: ImageData;
  color: ImageData;
  shapeKey: string;
  bounds: ShapeBounds;
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
  private coverageImages = new Map<string, HTMLImageElement>();
  private version = 0;

  get revision() {
    return this.version;
  }

  async set(entries: AssetEntry[]) {
    this.images.clear();
    this.coverageImages.clear();
    await Promise.all(entries.map((e) => this.add(e.name, e.dataUrl)));
    this.version += 1;
  }
  async add(name: string, dataUrl: string) {
    const img = await loadImage(dataUrl);
    let coverage: HTMLImageElement | undefined;
    if (name.toLowerCase().endsWith(".svg")) {
      const source = await (await fetch(dataUrl)).text();
      const coverageSource = svgCoverageSource(source);
      if (coverageSource) coverage = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(coverageSource)}`);
    }
    this.images.set(name, img);
    if (coverage) this.coverageImages.set(name, coverage);
    else this.coverageImages.delete(name);
    this.version += 1;
  }
  get(name: string | null): HTMLImageElement | undefined {
    return name ? this.images.get(name) : undefined;
  }
  /** Vector paint made opaque; original artwork remains available through get(). */
  coverageOf(name: string): HTMLImageElement | undefined {
    return this.coverageImages.get(name);
  }
  entries(): AssetEntry[] {
    return [...this.images.entries()].map(([name, image]) => ({ name, dataUrl: image.src }));
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

/** Shared sampling keeps the source alpha / coverage ratio aligned at edges. */
function rasterizeAsset(img: HTMLImageElement | undefined, size: number, isVector: boolean): ImageData {
  const r = size * (isVector ? 4 : 2);
  const canvas = tmpCanvas(r);
  const ctx = canvas.getContext("2d")!;
  if (img) {
    const iw = img.naturalWidth || r, ih = img.naturalHeight || r;
    const scale = Math.min(r / iw, r / ih);
    const w = iw * scale, h = ih * scale;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (r - w) / 2, (r - h) / 2, w, h);
  } else {
    const inset = r * 0.16, radius = r * 0.22, extent = r - 2 * inset;
    ctx.fillStyle = "#fff";
    squircle(ctx, inset, inset, extent, extent, radius);
    ctx.fill();
  }
  const out = tmpCanvas(size);
  const octx = out.getContext("2d")!;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(canvas, 0, 0, size, size);
  return octx.getImageData(0, 0, size, size);
}

export class Compositor {
  private shapeCache = new Map<string, ShapeCacheEntry>();
  private chicletCache = new Map<string, HTMLCanvasElement>();
  private renderQueue: Promise<unknown> = Promise.resolve();
  private preparedItems?: { key: string; items: DrawItem[] };

  constructor(private renderer: Renderer | null, private assets: AssetStore) {}

  private shapeKey(layer: Layer, size: number) {
    return `${this.assets.revision}:${layer.imageName ?? "__placeholder"}:${size}`;
  }

  private cacheShape(key: string, entry: ShapeCacheEntry) {
    this.shapeCache.delete(key);
    this.shapeCache.set(key, entry);
    let bytes = [...this.shapeCache.values()].reduce((n, v) => n + v.data.data.byteLength + (v.glassShape?.data.byteLength ?? 0), 0);
    for (const [oldKey, value] of this.shapeCache) {
      if (this.shapeCache.size <= 96 && bytes <= 64 * 1024 * 1024) break;
      this.shapeCache.delete(oldKey);
      bytes -= value.data.data.byteLength + (value.glassShape?.data.byteLength ?? 0);
    }
  }

  private layerRenderKey(doc: IconDocument, layer: Layer, size: number) {
    // Opacity now belongs to the coating texture. Shadow resources share this
    // key and must be rebuilt when the coating's alpha changes.
    const base = `${this.shapeKey(layer, size)}:glass-geometry:coat-opacity:${layer.opacity}`;
    return layer.fill.kind === "none"
      ? base
      : `${base}:fill:${doc.previewRendition}:${JSON.stringify(layer.fill)}`;
  }

  private chicletKey(doc: IconDocument, size: number, backdrop: BackdropSpec) {
    const bg = backdrop.kind === "image" ? `image:${backdrop.image}` : `color:${backdrop.color}`;
    return `${doc.previewPlatform}:${size}:${bg}:${backdropColorMatrix(doc).join(",")}`;
  }

  /** Rasterize artwork and coverage with identical aspect fit and antialiasing. */
  private rasterizeShape(layer: Layer, size: number): ImageData {
    const key = this.shapeKey(layer, size);
    const cached = this.shapeCache.get(key);
    if (cached) return cached.data;

    const img = this.assets.get(layer.imageName);
    // SVG / placeholder = vector -> supersample 4x for crisp edges; raster only 2x.
    const isVector = !layer.imageName || layer.imageName.toLowerCase().endsWith(".svg");
    const data = rasterizeAsset(img, size, isVector);
    this.cacheShape(key, { data, sampled: layer.imageName ? sampledColor(data) : null, bounds: shapeAlphaBounds(data) });
    return data;
  }

  private sampledShapeColor(layer: Layer, size: number, shape: ImageData): IcColor | null {
    if (!layer.imageName) return null;
    const key = this.shapeKey(layer, size);
    const cached = this.shapeCache.get(key);
    if (cached) return cached.sampled;
    const sampled = sampledColor(shape);
    this.cacheShape(key, { data: shape, sampled, bounds: shapeAlphaBounds(shape) });
    return sampled;
  }

  /** Geometry excludes paint opacity; colorData keeps the original artwork alpha. */
  private glassAlphaShape(layer: Layer, size: number, shape: ImageData): ImageData {
    if (!layer.imageName) return shape;
    const coverage = this.assets.coverageOf(layer.imageName);
    const isPng = layer.imageName.toLowerCase().endsWith(".png");
    if (!coverage && !isPng) return shape;
    const key = this.shapeKey(layer, size);
    const cached = this.shapeCache.get(key);
    if (cached?.glassShape) return cached.glassShape;
    const glassShape = coverage ? rasterizeAsset(coverage, size, true) : normalizePngShapeCoverage(shape);
    if (cached) this.cacheShape(key, { ...cached, glassShape });
    else this.cacheShape(key, {
      data: shape,
      sampled: sampledColor(shape),
      bounds: shapeAlphaBounds(shape),
      glassShape,
    });
    return glassShape;
  }

  private glassLayerOn(group: Group, layer: Layer) {
    return group.glassEnabled && !!this.renderer && layer.isGlass;
  }

  private buildDrawItems(doc: IconDocument, size: number, slot: string | null, ap: AppearanceMode): DrawItem[] {
    // Geometry/group preparation survives light and tint changes. Keep just the
    // current composition so old documents do not accumulate prepared bitmaps.
    const key = JSON.stringify([this.assets.revision, doc.composition, doc.previewPlatform, doc.previewRendition, size, slot]);
    if (this.preparedItems?.key === key) return this.preparedItems.items;
    const drawItems: DrawItem[] = [];
    for (const groupRaw of [...doc.composition.groups].reverse()) {
      const group = resolveGroup(groupRaw, slot, doc.previewPlatform);
      if (group.isHidden || group.opacity <= 0) continue;

      let combinedRun: CombinedPart[] = [];
      const flushCombinedRun = () => {
        if (!combinedRun.length) return;
        drawItems.push(this.makeCombinedItem(doc, group, combinedRun, size));
        combinedRun = [];
      };

      for (const layerRaw of [...group.layers].reverse()) {
        const layer = resolveLayer(layerRaw, slot, doc.previewPlatform);
        // Disabled appearance alternatives must neither add glass geometry nor
        // split a Combined run just because their authored blend is non-Normal.
        if (layer.isHidden || layer.opacity <= 0) continue;
        const shape = this.rasterizeShape(layer, size);
        const combine = group.lighting === "combined" && this.glassLayerOn(group, layer);

        if (combine) {
          combinedRun.push({ layer, shape });
        } else {
          flushCombinedRun();
          // Place geometry and artwork in the icon's coordinates before the
          // material pass, so displaced/scaled glass samples the correct backdrop.
          const geometry = transformShape(this.glassAlphaShape(layer, size, shape), group, layer, size);
          const artwork = glassColorShape(shape, layer, ap.dark);
          const coating = this.glassLayerOn(group, layer) ? artworkOpacity(artwork, layer.opacity) : artwork;
          const color = transformShape(coating, group, layer, size);
          const shapeKey = `${this.layerRenderKey(doc, layer, size)}:transform:${JSON.stringify([group.position, group.scale, layer.position, layer.scale])}`;
          drawItems.push({ kind: "layer", group, layer, shape, geometry, color, bounds: shapeAlphaBounds(geometry), shapeKey });
        }
      }
      flushCombinedRun();
    }
    this.preparedItems = { key, items: drawItems };
    return drawItems;
  }

  private makeCombinedItem(doc: IconDocument, group: Group, parts: CombinedPart[], size: number): CombinedDrawItem {
    const alphaCanvas = tmpCanvas(size);
    const alphaCtx = alphaCanvas.getContext("2d")!;
    const colorCanvas = tmpCanvas(size);
    const colorCtx = colorCanvas.getContext("2d")!;
    const dark = RENDITIONS[doc.previewRendition].dark;

    for (const { layer, shape } of parts) {
      const shapeCanvas = imageToCanvas(this.glassAlphaShape(layer, size, shape));
      alphaCtx.save();
      applyLayerTransform(alphaCtx, group, layer, size);
      // The glass surface covers the path even when its coating is translucent.
      // Games' body is 60% white: weighting geometry by 0.6 cancels that coating
      // alpha and then lets 40% of the sharp lower group bypass material Blur.
      alphaCtx.drawImage(shapeCanvas, 0, 0);
      alphaCtx.restore();

      const colorShape = glassColorShape(shape, layer, dark);
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
      shapeKey: this.combinedShapeKey(doc, group, parts, size),
      bounds: shapeAlphaBounds(shape),
    };
  }

  private combinedShapeKey(doc: IconDocument, group: Group, parts: CombinedPart[], size: number) {
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
    return `combined:${this.assets.revision}:${doc.previewPlatform}:${doc.previewRendition}:${size}:${group.id}:${group.position.x},${group.position.y},${group.scale}:${JSON.stringify(partKey)}`;
  }

  /** Cheap per-layer preview thumbnail; applies fill when present, with no glass/bg/chiclet. */
  renderLayerThumb(layer: Layer, size: number, dark = false): HTMLCanvasElement {
    const shape = this.rasterizeShape(layer, size);
    const data = layer.imageName && layer.fill.kind === "none" ? shape : fillShape(shape, layer.fill, dark);
    const c = tmpCanvas(size);
    c.getContext("2d")!.putImageData(data, 0, 0);
    return c;
  }

  render(
    doc: IconDocument,
    size: number,
    slot: string | null = specSlot(doc.previewRendition),
    backdrop?: BackdropSpec,
    options: RenderOptions = {},
  ): Promise<HTMLCanvasElement> {
    // Preview, thumbnails and exports share one renderer. Keep the complete
    // frame exclusive across awaits, including GPU readback and cache cleanup.
    const job = this.renderQueue.then(() => this.renderFrame(doc, size, slot, backdrop, options));
    this.renderQueue = job.catch(() => undefined);
    return job;
  }

  private async renderFrame(
    doc: IconDocument,
    size: number,
    slot: string | null,
    backdrop: BackdropSpec | undefined,
    options: RenderOptions,
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

    // Resolve artwork independently of display material/brightness.
    const material = materialAppearance(doc.previewRendition);
    const ap: AppearanceMode = {
      ...material,
      monoFamily: material.material !== "color",
    };

    // Base. Default/Dark: paint the backdrop (the glass refracts it) + the composition fill.
    // Clear/Mono must sample the real backdrop too. A neutral placeholder followed
    // by luminance modulation loses the detail that blur/refraction should act on.
    if (includeBackground) {
      if (backdrop && this.renderer) await this.applyChicletRefraction(ctx, doc, size, backdrop);
      else if (backdrop) {
        paintBackdrop(ctx, size, size, backdrop);
        if (ap.monoFamily) ctx.putImageData(transformAppearance(ctx.getImageData(0, 0, size, size), backdropColorMatrix(doc)), 0, 0);
      }
      // Mono's container samples the wallpaper; painting the authored opaque
      // background on it would hide the gradient. Background-only exports use
      // the same material base as the combined render.
      if (!ap.monoFamily) paintBackground(ctx, doc, size, slot);
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
        if (item.kind === "layer" && !this.glassLayerOn(item.group, item.layer)) continue;
        const sampled = item.kind === "combined" ? null : this.sampledShapeColor(item.layer, size, item.shape);
        const usesColorTexture = item.kind === "combined" ? true : glassUsesColorTexture(item.layer);
        const bounds = item.bounds;
        const u = buildUniforms(size, doc, item.group, item.layer, sampled, usesColorTexture, bounds);
        if (materialAlphaMask) u[44] = 1;
        const alphaShape = item.kind === "combined"
          ? item.shape
          : item.geometry;
        prepares.push({
          shape: new Uint8Array(alphaShape.data.buffer),
          size,
          uniforms: u,
          shapeKey: item.shapeKey,
        });
      }
      if (prepares.length) this.renderer.prepareShapes(prepares);
    }

    // hierarchy order is front-to-back; composite back-to-front. Shape/SDF preparation above is
    // independent per layer; this loop remains serial because each glass layer samples the pixels
    // already composited below it.
    // Composite each group once. Applying group opacity to every child made
    // overlapping children more opaque and entirely ignored the group's blend.
    for (let i = 0; i < drawItems.length;) {
      const group = drawItems[i].group;
      let end = i + 1;
      while (end < drawItems.length && drawItems[end].group.id === group.id) end++;
      const items = drawItems.slice(i, end);
      if (group.opacity <= 0) { i = end; continue; }
      // A complete Combined group can blend its coating in the material pass.
      // Its sampled receiver must bypass the group's blend operation.
      const materialGroupBlend = this.renderer != null && items.length === 1 && items[0].kind === "combined";
      const receiverShadow = materialGroupBlend || (group.blendMode === "normal"
        && items.every(item => item.kind === "combined" || item.layer.blendMode === "normal")
        && items.some(item => item.kind === "combined" || this.glassLayerOn(group, item.layer)));
      if (receiverShadow) {
        // plusDarker cannot be represented by a transparent source-over layer:
        // it can subtract RGB from the receiver. Render a complete group scene
        // and interpolate its premultiplied result once for group opacity.
        const sceneCanvas = tmpCanvas(size);
        const sceneCtx = sceneCanvas.getContext("2d", { willReadFrequently: true })!;
        sceneCtx.drawImage(canvas, 0, 0);
        for (const item of items) {
          if (item.kind === "combined") await this.drawCombined(sceneCtx, doc, item, size, materialAlphaMask, sceneCtx, true, materialGroupBlend);
          else await this.drawLayer(sceneCtx, doc, item, size, ap, materialAlphaMask, sceneCtx, true);
        }
        const opacity = Math.min(1, Math.max(0, group.opacity));
        if (opacity === 1) {
          ctx.save();
          ctx.globalCompositeOperation = "copy";
          ctx.drawImage(sceneCanvas, 0, 0);
          ctx.restore();
        } else if (opacity > 0) {
          const base = ctx.getImageData(0, 0, size, size);
          ctx.putImageData(mixScenes(base, sceneCtx.getImageData(0, 0, size, size), opacity), 0, 0);
        }
        i = end;
        continue;
      }
      const groupCanvas = tmpCanvas(size);
      const groupCtx = groupCanvas.getContext("2d")!;
      const sceneCanvas = tmpCanvas(size);
      const sceneCtx = sceneCanvas.getContext("2d", { willReadFrequently: true })!;
      do {
        sceneCtx.clearRect(0, 0, size, size);
        sceneCtx.drawImage(canvas, 0, 0);
        sceneCtx.drawImage(groupCanvas, 0, 0);
        const item = drawItems[i++];
        if (item.kind === "combined") await this.drawCombined(groupCtx, doc, item, size, materialAlphaMask, sceneCtx);
        else await this.drawLayer(groupCtx, doc, item, size, ap, materialAlphaMask, sceneCtx);
      } while (i < drawItems.length && drawItems[i].group.id === group.id);
      ctx.save();
      ctx.globalAlpha = group.opacity;
      ctx.globalCompositeOperation = blendOp(group.blendMode);
      ctx.drawImage(groupCanvas, 0, 0);
      ctx.restore();
    }

    // Clip the complete scene, then shade the container's contour. Its body
    // refracts the backdrop before artwork is drawn; the highlight pass preserves
    // the receiver scene's alpha and does not displace artwork.
    if (clipChiclet) applyChiclet(ctx, canvas, doc, size);
    if (chicletHighlight && includeBackground) await this.drawChicletRim(ctx, doc, size);

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

    const { pad, size: ps, shape } = rasterizeChiclet(doc, size);
    const bc = tmpCanvas(ps); const bx = bc.getContext("2d")!;
    paintBackdrop(bx, ps, ps, backdrop); // the only thing refracted is the backdrop
    const chicletShape = new Uint8Array(shape.data.buffer);
    const out = await this.renderer!.render(
      chicletShape,
      chicletShape,
      new Uint8Array(bx.getImageData(0, 0, ps, ps).data.buffer),
      ps, chicletUniforms(ps, doc), `chiclet:${doc.previewPlatform}:${ps}`, backdropColorMatrix(doc),
    );
    const oc = tmpCanvas(ps); oc.getContext("2d")!.putImageData(new ImageData(out, ps, ps), 0, 0);
    const cropped = tmpCanvas(size);
    cropped.getContext("2d")!.drawImage(oc, -pad, -pad); // crop the centre back to full-bleed
    this.chicletCache.set(key, cropped);
    let bytes = [...this.chicletCache.values()].reduce((n, c) => n + c.width * c.height * 4, 0);
    for (const [oldKey, value] of this.chicletCache) {
      if (this.chicletCache.size <= 24 && bytes <= 32 * 1024 * 1024) break;
      this.chicletCache.delete(oldKey);
      bytes -= value.width * value.height * 4;
    }
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(cropped, 0, 0);
  }

  /**
   * Container highlights use their own material profiles and the actual contour
   * normals. Padding seeds the full-bleed outline outside the output canvas.
   */
  private async drawChicletRim(ctx: CanvasRenderingContext2D, doc: IconDocument, size: number) {
    if (this.renderer) {
      const { pad, size: ps, shape } = rasterizeChiclet(doc, size);
      const receiver = tmpCanvas(ps);
      const rx = receiver.getContext("2d")!;
      rx.drawImage(ctx.canvas, pad, pad);
      const out = await this.renderer.renderChicletHighlight(
        new Uint8Array(shape.data.buffer), new Uint8Array(rx.getImageData(0, 0, ps, ps).data.buffer),
        ps, chicletHighlightUniforms(ps, size, doc), `chiclet:${doc.previewPlatform}:${ps}`,
      );
      ctx.putImageData(new ImageData(out, ps, ps), -pad, -pad);
      return;
    }
    // Canvas-only fallback retains an approximate directional rim.
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
    item: LayerDrawItem,
    size: number,
    ap: AppearanceMode,
    materialAlphaMask = false,
    sceneCtx = ctx,
    sceneOutput = false,
  ) {
    const { group, layer, shape: shapeData } = item;
    let layerCanvas: HTMLCanvasElement;
    // The display mode selects material color transforms; the artwork slot has
    // already been resolved during preparation.
    const renderGlass = this.glassLayerOn(group, layer);
    if (renderGlass) {
      const bg = sceneCtx.getImageData(0, 0, size, size);
      const sampled = this.sampledShapeColor(layer, size, shapeData);
      const colorShape = item.color;
      const usesColorTexture = glassUsesColorTexture(layer);
      const u = buildUniforms(size, doc, group, layer, sampled, usesColorTexture, item.bounds);
      if (materialAlphaMask) u[44] = 1;
      // Coating opacity is already baked into item.color. Fade the whole glass
      // surface only at the group boundary, after its blurred receiver is composed.
      if (sceneOutput) u[45] = 1;
      const alphaShape = item.geometry;
      const shapeBytes = new Uint8Array(alphaShape.data.buffer);
      const out = await this.renderer!.render(
        shapeBytes,
        new Uint8Array(colorShape.data.buffer),
        new Uint8Array(bg.data.buffer),
        size,
        u,
        item.shapeKey,
      );
      if (sceneOutput) {
        // The shader already included both the receiver and item opacity.
        ctx.putImageData(new ImageData(out, size, size), 0, 0);
        return;
      }
      layerCanvas = imageToCanvas(new ImageData(out, size, size));
    } else if (ap.monoFamily) {
      // Flat artwork (or unavailable GPU) still retains its authored fill and
      // alpha, using the same color transform as a glass coating.
      const colorShape = layer.fill.kind === "none" && layer.imageName
        ? shapeData
        : fillShape(shapeData, layer.fill, RENDITIONS[doc.previewRendition].dark);
      layerCanvas = imageToCanvas(transformShape(transformAppearance(colorShape, artworkColorMatrix(doc)), group, layer, size));
    } else {
      // non-glass: tint by fill colour
      const colorShape = layer.fill.kind === "none" && layer.imageName
        ? shapeData
        : fillShape(shapeData, layer.fill, RENDITIONS[doc.previewRendition].dark);
      layerCanvas = imageToCanvas(transformShape(colorShape, group, layer, size));
    }
    ctx.save();
    ctx.globalAlpha = renderGlass ? 1 : layer.opacity;
    ctx.globalCompositeOperation = blendOp(layer.blendMode);
    ctx.drawImage(layerCanvas, 0, 0);
    ctx.restore();
  }

  private async drawCombined(
    ctx: CanvasRenderingContext2D,
    doc: IconDocument,
    item: CombinedDrawItem,
    size: number,
    materialAlphaMask = false,
    sceneCtx = ctx,
    sceneOutput = false,
    materialGroupBlend = false,
  ) {
    const bg = sceneCtx.getImageData(0, 0, size, size);
    const u = buildUniforms(size, doc, item.group, item.layer, null, true, item.bounds);
    if (materialAlphaMask) u[44] = 1;
    if (sceneOutput) u[45] = 1;
    if (materialGroupBlend) u[COATING_BLEND_SLOT] = materialBlendCode(item.group.blendMode);
    const out = await this.renderer!.render(
      new Uint8Array(item.shape.data.buffer),
      new Uint8Array(item.color.data.buffer),
      new Uint8Array(bg.data.buffer),
      size,
      u,
      item.shapeKey,
    );
    if (sceneOutput) {
      ctx.putImageData(new ImageData(out, size, size), 0, 0);
      return;
    }
    const layerCanvas = imageToCanvas(new ImageData(out, size, size));
    ctx.save();
    ctx.drawImage(layerCanvas, 0, 0);
    ctx.restore();
  }
}

// ---- helpers ----
function rasterizeChiclet(doc: IconDocument, iconSize: number) {
  const pad = Math.max(4, Math.round(iconSize * 0.05));
  const size = iconSize + 2 * pad;
  const p = PLATFORMS[doc.previewPlatform];
  const canvas = tmpCanvas(size), ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  if (p.circle) {
    ctx.beginPath(); ctx.arc(size / 2, size / 2, iconSize / 2, 0, Math.PI * 2); ctx.fill();
  } else {
    squircle(ctx, pad, pad, iconSize, iconSize, iconSize * p.cornerRadiusPct); ctx.fill();
  }
  return { pad, size, shape: ctx.getImageData(0, 0, size, size) };
}

/** Interpolate the whole group in premultiplied space, including transparent exports. */
function mixScenes(base: ImageData, scene: ImageData, opacity: number): ImageData {
  const dst = base.data, src = scene.data;
  for (let i = 0; i < dst.length; i += 4) {
    const a0 = dst[i + 3] / 255, a1 = src[i + 3] / 255;
    const alpha = a0 * (1 - opacity) + a1 * opacity;
    for (let c = 0; c < 3; c++) {
      dst[i + c] = alpha > 0
        ? (dst[i + c] * a0 * (1 - opacity) + src[i + c] * a1 * opacity) / alpha
        : 0;
    }
    dst[i + 3] = alpha * 255;
  }
  return base;
}

function imageToCanvas(data: ImageData): HTMLCanvasElement {
  const c = tmpCanvas(data.width);
  c.getContext("2d")!.putImageData(data, 0, 0);
  return c;
}

function transformShape(data: ImageData, group: Group, layer: Layer, size: number): ImageData {
  if (group.scale === 1 && layer.scale === 1 && group.position.x === 0 && group.position.y === 0 && layer.position.x === 0 && layer.position.y === 0) return data;
  const canvas = tmpCanvas(size);
  const ctx = canvas.getContext("2d")!;
  applyLayerTransform(ctx, group, layer, size);
  ctx.drawImage(imageToCanvas(data), 0, 0);
  return ctx.getImageData(0, 0, size, size);
}

function normalizePngShapeCoverage(source: ImageData): ImageData {
  const { width, height } = source;
  const out = new ImageData(width, height);
  const src = source.data;
  const dst = out.data;
  const alphaAt = (x: number, y: number) => src[(y * width + x) * 4 + 3];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const alpha = src[i + 3];
      if (alpha <= 1) continue;

      let localMax = alpha;
      let touchesEmpty = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (ox === 0 && oy === 0) continue;
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            touchesEmpty = true;
            continue;
          }
          const neighborAlpha = alphaAt(nx, ny);
          localMax = Math.max(localMax, neighborAlpha);
          if (neighborAlpha <= 1) touchesEmpty = true;
        }
      }

      // Interior opacity belongs to the PNG material, not to shape coverage.
      // At the support edge, divide by the local interior opacity to retain AA.
      const coverage = touchesEmpty ? Math.min(1, alpha / Math.max(localMax, 1)) : 1;
      dst[i] = 255;
      dst[i + 1] = 255;
      dst[i + 2] = 255;
      dst[i + 3] = Math.round(coverage * 255);
    }
  }
  return out;
}

function applyLayerTransform(ctx: CanvasRenderingContext2D, group: Group, layer: Layer, size: number) {
  const k = size / 1024;
  const cx = size / 2, cy = size / 2;
  ctx.translate(group.position.x * k, group.position.y * k);
  ctx.translate(cx, cy);
  ctx.scale(group.scale, group.scale);
  ctx.translate(-cx, -cy);
  ctx.translate(layer.position.x * k, layer.position.y * k);
  ctx.translate(cx, cy);
  ctx.scale(layer.scale, layer.scale);
  ctx.translate(-cx, -cy);
}

function glassUsesColorTexture(layer: Layer): boolean {
  return layer.imageName != null || layer.fill.kind !== "none";
}

function glassColorShape(shape: ImageData, layer: Layer, dark: boolean): ImageData {
  if (layer.imageName && layer.fill.kind === "none") return shape;
  return fillShape(shape, layer.fill, dark);
}

/** Layer opacity weights artwork; geometric coverage is applied separately. */
function artworkOpacity(artwork: ImageData, opacity: number): ImageData {
  const amount = Math.min(1, Math.max(0, opacity));
  if (amount === 1) return artwork;
  const out = new ImageData(new Uint8ClampedArray(artwork.data), artwork.width, artwork.height);
  for (let i = 3; i < out.data.length; i += 4) out.data[i] *= amount;
  return out;
}

/**
 * Uniforms for the chiclet glass BODY: refract the (backdrop) bg with NO colour body (glassCol
 * opacity 0) and NO glyph specular (the container has a separate highlight pass), appearance code 0.
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
    0, 1, 0, 1,                                // bounds: top, bottom, left, right
    0, 0, 0, 0,
    1, 1, 1, 0,
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 0,
    0, 0, 0, 0, // materialExtra: no glyph inset or coating blend on the container body
  ]);
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
  let minX = data.width;
  let maxX = -1;
  let minY = data.height;
  let maxY = -1;
  const d = data.data;
  for (let y = 0; y < data.height; y++) {
    const row = y * data.width * 4;
    for (let x = 0; x < data.width; x++) {
      if (d[row + x * 4 + 3] <= 2) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxY < minY) return { top: 0, bottom: 1, left: 0, right: 1 };
  return {
    top: minY / data.height,
    bottom: (maxY + 1) / data.height,
    left: minX / data.width,
    right: (maxX + 1) / data.width,
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
