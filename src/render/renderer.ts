// The glass pass graph - browser GPU port of WgpuRenderEngine.renderOnGpu.
// alphaShape -> JFA -> SDF -> conditioned central-difference normals; background blur;
// shadow; glass/color/highlight; composite. SDF generation is our implementation.
import type { BindKind, Format, RenderBackend, RenderEncoder, Tex } from "./backend";
import { Gpu } from "./gpu";
import { WebGlGpu } from "./webgl";
import { patch } from "./uniforms";
import { IDENTITY_RGB } from "./appearance";
import { textureBytes } from "./texturePool";
import { NARROW_BLUR_SIGMA, pairedGaussianKernel } from "./blurKernel";

import common from "./shaders/common.wgsl.inc?raw";
import jfaSeed from "./shaders/jfa_seed.wgsl?raw";
import jfaFlood from "./shaders/jfa_flood.wgsl?raw";
import sdfResolve from "./shaders/sdf_resolve.wgsl?raw";
import sdfBlur from "./shaders/sdf_blur.wgsl?raw";
import downsample from "./shaders/downsample.wgsl?raw";
import distanceGradient from "./shaders/distance_gradient.wgsl?raw";
import blur from "./shaders/blur.wgsl?raw";
import shadowSource from "./shaders/shadow_source.wgsl?raw";
import shadowBlur from "./shaders/shadow_blur.wgsl?raw";
import shadow from "./shaders/shadow.wgsl?raw";
import glassBackground from "./shaders/glass_background.wgsl?raw";
import colorLayer from "./shaders/color_layer.wgsl?raw";
import glassHighlight from "./shaders/glass_highlight.wgsl?raw";
import chicletHighlight from "./shaders/chiclet_highlight.wgsl?raw";
import composite from "./shaders/composite.wgsl?raw";

const SRC: Record<string, string> = {
  jfa_seed: jfaSeed, jfa_flood: jfaFlood, sdf_resolve: sdfResolve, sdf_blur: sdfBlur, downsample,
  distance_gradient: distanceGradient, blur, shadow_source: shadowSource, shadow_blur: shadowBlur, shadow,
  glass_background: glassBackground, color_layer: colorLayer, glass_highlight: glassHighlight,
  chiclet_highlight: chicletHighlight, composite,
};

const F16: Format = "rgba16float";
const F8: Format = "rgba8unorm";
const SHAPE_CACHE_LIMIT = 48;
const SHAPE_CACHE_BYTES = 128 * 1024 * 1024;
const SHADOW_CACHE_BYTES = 32 * 1024 * 1024;

interface ShapeResources {
  key: string | null;
  shapeTex: Tex;
  seedTex: Tex;
  sdfTex: Tex;
  dgTex: Tex;
  owned: Tex[];
}

interface ShadowResources {
  key: string;
  shadowTex: Tex;
}

interface ShapePrepare {
  shape: Uint8Array<ArrayBuffer>;
  size: number;
  uniforms: Float32Array<ArrayBuffer>;
  shapeKey: string;
}

export class Renderer {
  private shapeCache = new Map<string, ShapeResources>();
  private shadowCache = new Map<string, ShadowResources>();
  private transparentTexture?: Tex;

  constructor(private gpu: RenderBackend) {}

  static async create(): Promise<Renderer> {
    const errors: string[] = [];
    try {
      return new Renderer(await Gpu.create());
    } catch (e: any) {
      errors.push(`WebGPU: ${e?.message ?? e}`);
    }
    try {
      return new Renderer(await WebGlGpu.create());
    } catch (e: any) {
      errors.push(`WebGL2: ${e?.message ?? e}`);
    }
    throw new Error(errors.join("; "));
  }

  get backendKind() {
    return this.gpu.kind;
  }

  private pl(name: string, target: Format, bindings: BindKind[]) {
    return this.gpu.pipeline(name, common + "\n" + SRC[name], target, bindings);
  }

  private destroyShapeResources(r: ShapeResources) {
    for (const t of r.owned) this.gpu.destroyTexture(t);
  }

  private destroyShadowResources(r: ShadowResources) {
    this.gpu.destroyTexture(r.shadowTex);
  }

  clearShapeCache() {
    for (const r of this.shapeCache.values()) this.destroyShapeResources(r);
    for (const r of this.shadowCache.values()) this.destroyShadowResources(r);
    this.shapeCache.clear();
    this.shadowCache.clear();
  }

  private trimShapeCache() {
    let bytes = [...this.shapeCache.values()].reduce((sum, r) => sum + r.owned.reduce((n, t) => n + textureBytes(t), 0), 0);
    while (this.shapeCache.size > SHAPE_CACHE_LIMIT || bytes > SHAPE_CACHE_BYTES) {
      const first = this.shapeCache.keys().next().value;
      if (!first) return;
      const r = this.shapeCache.get(first);
      if (r) {
        bytes -= r.owned.reduce((n, t) => n + textureBytes(t), 0);
        this.destroyShapeResources(r);
      }
      this.shapeCache.delete(first);
    }
  }

  private trimShadowCache() {
    let bytes = [...this.shadowCache.values()].reduce((sum, r) => sum + textureBytes(r.shadowTex), 0);
    while (this.shadowCache.size > SHAPE_CACHE_LIMIT || bytes > SHADOW_CACHE_BYTES) {
      const first = this.shadowCache.keys().next().value;
      if (!first) return;
      const r = this.shadowCache.get(first);
      if (r) {
        bytes -= textureBytes(r.shadowTex);
        this.destroyShadowResources(r);
      }
      this.shadowCache.delete(first);
    }
  }

  private touchShapeResources(shapeKey: string) {
    const cached = this.shapeCache.get(shapeKey);
    if (!cached) return null;
    this.shapeCache.delete(shapeKey);
    this.shapeCache.set(shapeKey, cached);
    return cached;
  }

  private touchShadowResources(key: string) {
    const cached = this.shadowCache.get(key);
    if (!cached) return null;
    this.shadowCache.delete(key);
    this.shadowCache.set(key, cached);
    return cached;
  }

  private shadowKey(shapeKey: string | undefined, u: Float32Array<ArrayBuffer>) {
    if (!shapeKey) return null;
    return [
      shapeKey,
      u[14], u[15],
      u[20], u[21], u[22], u[23],
      u[28], u[29], u[30],
      u[32], u[33],
      u[38], u[39],
      ...u.slice(52, 68),
    ].join(":");
  }

  private buildShapeResources(shape: Uint8Array<ArrayBuffer>, size: number, u: Float32Array<ArrayBuffer>, key: string | null, enc: RenderEncoder): ShapeResources {
    const g = this.gpu, n = size, samp = g.sampler();
    const persistent = key != null;
    const uni = (step = 0, bx = 0, by = 0) => g.uniform(patch(u, step, bx, by));

    const owned: Tex[] = [];
    const allocate = (format: Format, render: boolean) => {
      const texture = g.texture(n, n, format, render, persistent);
      owned.push(texture);
      return texture;
    };
    try {
      const shapeTex = allocate(F8, false);
      g.upload(shapeTex, shape, n, n);

      let seedSrc = allocate(F16, true);
      let seedDst = allocate(F16, true);
      g.pass(this.pl("jfa_seed", F16, ["U", "T"]), seedSrc, uni(), [shapeTex], undefined, enc);
      const steps = Math.ceil(Math.log2(n));
      let step = 1 << (steps - 1);
      for (let i = 0; i < steps; i++) {
        g.pass(this.pl("jfa_flood", F16, ["U", "T"]), seedDst, uni(step), [seedSrc], undefined, enc);
        [seedSrc, seedDst] = [seedDst, seedSrc];
        step = Math.max(1, step >> 1);
      }
      for (let i = 0; i < 2; i++) {
        g.pass(this.pl("jfa_flood", F16, ["U", "T"]), seedDst, uni(1), [seedSrc], undefined, enc);
        [seedSrc, seedDst] = [seedDst, seedSrc];
      }

      const sdfTex = allocate(F16, true);
      g.pass(this.pl("sdf_resolve", F16, ["U", "T", "T"]), sdfTex, uni(), [seedSrc, shapeTex], undefined, enc);

      // Contour seeds retain AA subpixel positions. Only normals use the
      // conditioned field; highlight distance and geometric coverage stay raw.
      // Glyphs and the padded container use this same preparation path.
      const sdfH = g.texture(n, n, F16, true);
      const sdfV = g.texture(n, n, F16, true);
      g.pass(this.pl("sdf_blur", F16, ["U", "T", "S"]), sdfH, uni(0, 1, 0), [sdfTex], samp, enc);
      g.pass(this.pl("sdf_blur", F16, ["U", "T", "S"]), sdfV, uni(0, 0, 1), [sdfH], samp, enc);
      const dgTex = allocate(F16, true);
      g.pass(this.pl("distance_gradient", F16, ["U", "T", "T", "S"]), dgTex, uni(), [sdfTex, sdfV], samp, enc);

      return { key, shapeTex, seedTex: seedSrc, sdfTex, dgTex, owned };
    } catch (error) {
      // Transient textures are released by frameDone; persistent allocations
      // never published into the cache need explicit cleanup on a failed pass.
      if (persistent) for (const texture of owned) g.destroyTexture(texture);
      throw error;
    }
  }

  prepareShape(shape: Uint8Array<ArrayBuffer>, size: number, u: Float32Array<ArrayBuffer>, shapeKey: string) {
    this.prepareShapes([{ shape, size, uniforms: u, shapeKey }]);
  }

  prepareShapes(items: ShapePrepare[]) {
    const enc = this.gpu.commandEncoder();
    const prepared = new Map<string, ShapeResources>();
    try {
      for (const item of items) {
        if (this.touchShapeResources(item.shapeKey) || prepared.has(item.shapeKey)) continue;
        const bytes = item.size * item.size * 36;
        const retainedBytes = [...this.shapeCache.values(), ...prepared.values()].reduce((sum, r) => sum + r.owned.reduce((n, t) => n + textureBytes(t), 0), 0);
        // Do not warm an entire large composition only to evict it before the
        // draw loop. Overflow shapes are prepared on demand during their draw.
        if (retainedBytes + bytes > SHAPE_CACHE_BYTES || this.shapeCache.size + prepared.size >= SHAPE_CACHE_LIMIT) continue;
        const resources = this.buildShapeResources(item.shape, item.size, item.uniforms, item.shapeKey, enc);
        prepared.set(item.shapeKey, resources);
      }
      if (prepared.size) {
        this.gpu.submit(enc);
        for (const [key, resources] of prepared) this.shapeCache.set(key, resources);
        this.trimShapeCache();
      }
    } catch (error) {
      for (const resources of prepared.values()) this.destroyShapeResources(resources);
      throw error;
    } finally {
      this.gpu.frameDone();
    }
  }

  private shapeResources(shape: Uint8Array<ArrayBuffer>, size: number, u: Float32Array<ArrayBuffer>, enc: RenderEncoder, shapeKey?: string): ShapeResources {
    if (shapeKey) {
      const cached = this.touchShapeResources(shapeKey);
      if (cached) return cached;
      return this.buildShapeResources(shape, size, u, shapeKey, enc);
    }
    return this.buildShapeResources(shape, size, u, null, enc);
  }

  /** Bound the Gaussian footprint before filtering, so wide blurs never skip
   * over thin features between taps. Filtering stays in premultiplied F16. */
  private gaussianBlur(source: Tex, sigma: number, pass: "blur" | "shadow_blur", u: Float32Array<ArrayBuffer>, enc: RenderEncoder): Tex {
    if (!(sigma > 0)) return source;
    const g = this.gpu, samp = g.sampler();
    let reduced = source;
    while (sigma * reduced.w / source.w > NARROW_BLUR_SIGMA && reduced.w > 1) {
      const next = g.texture(Math.ceil(reduced.w / 2), Math.ceil(reduced.h / 2), F16, true);
      g.pass(this.pl("downsample", F16, ["U", "T", "S"]), next, g.uniform(u), [reduced], samp, enc);
      reduced = next;
    }
    const scaled = u.slice();
    scaled[0] = reduced.w; scaled[1] = reduced.h;
    scaled[2] = 1 / reduced.w; scaled[3] = 1 / reduced.h;
    scaled[pass === "blur" ? 13 : 14] = sigma * reduced.w / source.w;
    // Only blur passes reuse these material slots: weights at 20..27 and
    // bilinear offsets at 28..35. Keep the original material uniforms intact.
    scaled.set(pairedGaussianKernel(sigma * reduced.w / source.w), 20);
    const horizontal = g.texture(reduced.w, reduced.h, F16, true);
    const vertical = g.texture(reduced.w, reduced.h, F16, true);
    const pipeline = this.pl(pass, F16, ["U", "T", "S"]);
    g.pass(pipeline, horizontal, g.uniform(patch(scaled, 0, 1, 0)), [reduced], samp, enc);
    g.pass(pipeline, vertical, g.uniform(patch(scaled, 0, 0, 1)), [horizontal], samp, enc);
    return vertical;
  }

  private shadowResources(shapeRes: ShapeResources, colorTex: Tex, size: number, u: Float32Array<ArrayBuffer>, enc: RenderEncoder, shapeKey?: string, onPrepared?: (r: ShadowResources) => void): Tex {
    if (u[15] <= 0) {
      if (!this.transparentTexture) {
        this.transparentTexture = this.gpu.texture(1, 1, F8, false, true);
        this.gpu.upload(this.transparentTexture, new Uint8Array(4), 1, 1);
      }
      return this.transparentTexture;
    }
    const key = this.shadowKey(shapeKey, u);
    const cached = key ? this.touchShadowResources(key) : null;
    if (cached) return cached.shadowTex;

    const g = this.gpu, n = size, samp = g.sampler();
    const uni = (step = 0, bx = 0, by = 0) => g.uniform(patch(u, step, bx, by));
    const { shapeTex } = shapeRes;
    const persistent = key != null;

    const shadowSrcTex = g.texture(n, n, F16, true);
    g.pass(this.pl("shadow_source", F16, ["U", "T", "T"]), shadowSrcTex, uni(), [shapeTex, colorTex], undefined, enc);
    const shV = this.gaussianBlur(shadowSrcTex, u[14], "shadow_blur", u, enc);
    const shadowTex = g.texture(n, n, F16, true, persistent);
    try {
      g.pass(this.pl("shadow", F16, ["U", "T", "S"]), shadowTex, uni(), [shV], samp, enc);
    } catch (error) {
      if (persistent) g.destroyTexture(shadowTex);
      throw error;
    }

    if (key) {
      onPrepared?.({ key, shadowTex });
    }
    return shadowTex;
  }

  /** Shade the container over a complete receiver scene. Inputs/output are
   * straight RGBA8; shape resources are shared with the padded glass body. */
  async renderChicletHighlight(shape: Uint8Array<ArrayBuffer>, receiver: Uint8Array<ArrayBuffer>,
    size: number, u: Float32Array<ArrayBuffer>, shapeKey: string): Promise<Uint8ClampedArray<ArrayBuffer>> {
    const g = this.gpu, enc = g.commandEncoder();
    const wasCached = this.shapeCache.has(shapeKey);
    let shapeRes: ShapeResources | undefined;
    let completed = false;
    try {
      shapeRes = this.shapeResources(shape, size, u, enc, shapeKey);
      const bg = g.texture(size, size, F8, false);
      g.upload(bg, premultiplyRgba(receiver), size, size);
      const out = g.texture(size, size, F8, true);
      g.pass(this.pl("chiclet_highlight", F8, ["U", "T", "T", "S"]), out,
        g.uniform(u), [shapeRes.dgTex, bg], g.sampler(), enc);
      const pixels = await g.readback(out, size, size, enc);
      if (!wasCached) this.shapeCache.set(shapeKey, shapeRes);
      completed = true;
      return pixels;
    } finally {
      if (!completed && !wasCached && shapeRes) this.destroyShapeResources(shapeRes);
      g.frameDone();
      this.trimShapeCache();
    }
  }

  /** Render one glass item. Inputs are straight RGBA8. u[45] selects an isolated
   * overlay or a complete receiver scene; outputs are always straight RGBA8. */
  async render(alphaShape: Uint8Array<ArrayBuffer>, colorData: Uint8Array<ArrayBuffer>, bg: Uint8Array<ArrayBuffer>, size: number, u: Float32Array<ArrayBuffer>, shapeKey?: string, backgroundMatrix: readonly number[] = IDENTITY_RGB): Promise<Uint8ClampedArray<ArrayBuffer>> {
    const g = this.gpu, n = size, samp = g.sampler();
    const uni = (step = 0, bx = 0, by = 0) => g.uniform(patch(u, step, bx, by));
    const enc = g.commandEncoder();
    const shapeWasCached = shapeKey !== undefined && this.shapeCache.has(shapeKey);
    let shapeRes: ShapeResources | undefined;
    let preparedShadow: ShadowResources | undefined;
    let completed = false;
    try {
      shapeRes = this.shapeResources(alphaShape, n, u, enc, shapeKey);
      const { shapeTex, dgTex } = shapeRes;
      const colorTex = g.texture(n, n, F8, false);
      // Linear filtering must happen in premultiplied-alpha space. Otherwise
      // RGB from fully transparent PNG texels bleeds into antialiased edges.
      g.upload(colorTex, premultiplyRgba(colorData), n, n);
      const bgTex = g.texture(n, n, F8, false); g.upload(bgTex, premultiplyRgba(bg), n, n);

      const bgBlur = this.gaussianBlur(bgTex, u[13], "blur", u, enc);

      const shadowTex = this.shadowResources(shapeRes, colorTex, n, u, enc, shapeKey, (r) => { preparedShadow = r; });

      const glass = g.texture(n, n, F16, true);
      // The scene already contains material colors from lower layers. Only the
      // container supplies a background matrix; artwork/shadows use u's matrix.
      const backgroundUniforms = u.slice();
      backgroundUniforms.set(backgroundMatrix, 52);
      g.pass(this.pl("glass_background", F16, ["U", "T", "T", "S"]), glass, g.uniform(backgroundUniforms), [dgTex, bgBlur], samp, enc);
      const colorLayerTex = g.texture(n, n, F16, true);
      g.pass(this.pl("color_layer", F16, ["U", "T", "T", "S"]), colorLayerTex, uni(), [dgTex, colorTex], samp, enc);
      const highlight = g.texture(n, n, F16, true);
      g.pass(this.pl("glass_highlight", F16, ["U", "T", "S"]), highlight, uni(), [dgTex], samp, enc);

      const out = g.texture(n, n, F8, true);
      g.pass(
        this.pl("composite", F8, ["U", "T", "T", "T", "T", "T", "T", "S"]),
        out,
        uni(),
        [shadowTex, glass, colorLayerTex, highlight, dgTex, bgTex],
        samp,
        enc,
      );

      const pixels = await g.readback(out, n, n, enc);
      if (shapeKey && !shapeWasCached) this.shapeCache.set(shapeKey, shapeRes);
      if (preparedShadow) this.shadowCache.set(preparedShadow.key, preparedShadow);
      completed = true;
      return pixels;
    } finally {
      if (!completed) {
        if (shapeKey && !shapeWasCached && shapeRes) this.destroyShapeResources(shapeRes);
        if (preparedShadow) this.destroyShadowResources(preparedShadow);
      }
      g.frameDone();
      // Evict only after the command buffer has been submitted/read back.
      // The current render can still reference any newly cached texture.
      this.trimShapeCache();
      this.trimShadowCache();
    }
  }
}

function premultiplyRgba(data: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(data.length) as Uint8Array<ArrayBuffer>;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    out[i] = Math.round(data[i] * a);
    out[i + 1] = Math.round(data[i + 1] * a);
    out[i + 2] = Math.round(data[i + 2] * a);
    out[i + 3] = data[i + 3];
  }
  return out;
}
