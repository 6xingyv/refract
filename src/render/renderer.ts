// The glass pass graph - browser GPU port of WgpuRenderEngine.renderOnGpu.
// alphaShape -> JFA -> SDF (+ smoothed SDF normals) -> distance_gradient ; background blur ; shadow ; glass/color/highlight ; composite.
import type { BindKind, Format, RenderBackend, RenderEncoder, RenderPipeline, Tex } from "./backend";
import { Gpu } from "./gpu";
import { WebGlGpu } from "./webgl";
import { patch } from "./uniforms";

import common from "./shaders/common.wgsl.inc?raw";
import jfaSeed from "./shaders/jfa_seed.wgsl?raw";
import jfaFlood from "./shaders/jfa_flood.wgsl?raw";
import sdfResolve from "./shaders/sdf_resolve.wgsl?raw";
import sdfBlur from "./shaders/sdf_blur.wgsl?raw";
import distanceGradient from "./shaders/distance_gradient.wgsl?raw";
import blur from "./shaders/blur.wgsl?raw";
import shadowSource from "./shaders/shadow_source.wgsl?raw";
import shadowBlur from "./shaders/shadow_blur.wgsl?raw";
import shadow from "./shaders/shadow.wgsl?raw";
import glassBackground from "./shaders/glass_background.wgsl?raw";
import colorLayer from "./shaders/color_layer.wgsl?raw";
import glassHighlight from "./shaders/glass_highlight.wgsl?raw";
import composite from "./shaders/composite.wgsl?raw";

const SRC: Record<string, string> = {
  jfa_seed: jfaSeed, jfa_flood: jfaFlood, sdf_resolve: sdfResolve, sdf_blur: sdfBlur,
  distance_gradient: distanceGradient, blur, shadow_source: shadowSource, shadow_blur: shadowBlur, shadow,
  glass_background: glassBackground, color_layer: colorLayer, glass_highlight: glassHighlight, composite,
};

const F16: Format = "rgba16float";
const F8: Format = "rgba8unorm";
const SHAPE_CACHE_LIMIT = 48;

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
    while (this.shapeCache.size > SHAPE_CACHE_LIMIT) {
      const first = this.shapeCache.keys().next().value;
      if (!first) return;
      const r = this.shapeCache.get(first);
      if (r) this.destroyShapeResources(r);
      this.shapeCache.delete(first);
    }
  }

  private trimShadowCache() {
    while (this.shadowCache.size > SHAPE_CACHE_LIMIT) {
      const first = this.shadowCache.keys().next().value;
      if (!first) return;
      const r = this.shadowCache.get(first);
      if (r) this.destroyShadowResources(r);
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
    ].join(":");
  }

  private buildShapeResources(shape: Uint8Array<ArrayBuffer>, size: number, u: Float32Array<ArrayBuffer>, key: string | null, enc: RenderEncoder): ShapeResources {
    const g = this.gpu, n = size, samp = g.sampler();
    const persistent = key != null;
    const uni = (step = 0, bx = 0, by = 0) => g.uniform(patch(u, step, bx, by));

    const shapeTex = g.texture(n, n, F8, false, persistent);
    g.upload(shapeTex, shape, n, n);

    let seedSrc = g.texture(n, n, F16, true, persistent);
    let seedDst = g.texture(n, n, F16, true, persistent);
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

    const sdfTex = g.texture(n, n, F16, true, persistent);
    g.pass(this.pl("sdf_resolve", F16, ["U", "T", "T"]), sdfTex, uni(), [seedSrc, shapeTex], undefined, enc);

    const sdfH = g.texture(n, n, F16, true);
    g.pass(this.pl("sdf_blur", F16, ["U", "T", "S"]), sdfH, uni(0, 1, 0), [sdfTex], samp, enc);
    const sdfS = g.texture(n, n, F16, true);
    g.pass(this.pl("sdf_blur", F16, ["U", "T", "S"]), sdfS, uni(0, 0, 1), [sdfH], samp, enc);

    const dgTex = g.texture(n, n, F16, true, persistent);
    g.pass(this.pl("distance_gradient", F16, ["U", "T", "T", "S"]), dgTex, uni(), [sdfTex, sdfS], samp, enc);

    return { key, shapeTex, seedTex: seedSrc, sdfTex, dgTex, owned: [shapeTex, seedSrc, seedDst, sdfTex, dgTex] };
  }

  prepareShape(shape: Uint8Array<ArrayBuffer>, size: number, u: Float32Array<ArrayBuffer>, shapeKey: string) {
    this.prepareShapes([{ shape, size, uniforms: u, shapeKey }]);
  }

  prepareShapes(items: ShapePrepare[]) {
    const enc = this.gpu.commandEncoder();
    let submitted = false;
    try {
      for (const item of items) {
        if (this.touchShapeResources(item.shapeKey)) continue;
        const resources = this.buildShapeResources(item.shape, item.size, item.uniforms, item.shapeKey, enc);
        this.shapeCache.set(item.shapeKey, resources);
        submitted = true;
      }
      if (submitted) {
        this.gpu.submit(enc);
        this.trimShapeCache();
      }
    } finally {
      this.gpu.frameDone();
    }
  }

  private shapeResources(shape: Uint8Array<ArrayBuffer>, size: number, u: Float32Array<ArrayBuffer>, enc: RenderEncoder, shapeKey?: string): ShapeResources {
    if (shapeKey) {
      const cached = this.touchShapeResources(shapeKey);
      if (cached) return cached;
      const resources = this.buildShapeResources(shape, size, u, shapeKey, enc);
      this.shapeCache.set(shapeKey, resources);
      this.trimShapeCache();
      return resources;
    }
    return this.buildShapeResources(shape, size, u, null, enc);
  }

  private shadowResources(shapeRes: ShapeResources, colorTex: Tex, size: number, u: Float32Array<ArrayBuffer>, enc: RenderEncoder, shapeKey?: string): Tex {
    const key = this.shadowKey(shapeKey, u);
    const cached = key ? this.touchShadowResources(key) : null;
    if (cached) return cached.shadowTex;

    const g = this.gpu, n = size, samp = g.sampler();
    const uni = (step = 0, bx = 0, by = 0) => g.uniform(patch(u, step, bx, by));
    const { shapeTex, seedTex, sdfTex } = shapeRes;
    const persistent = key != null;

    const shadowSrcTex = g.texture(n, n, F16, true);
    g.pass(this.pl("shadow_source", F16, ["U", "T", "T", "T", "T"]), shadowSrcTex, uni(), [seedTex, shapeTex, sdfTex, colorTex], undefined, enc);
    const shH = g.texture(n, n, F16, true);
    g.pass(this.pl("shadow_blur", F16, ["U", "T", "S"]), shH, uni(0, 1, 0), [shadowSrcTex], samp, enc);
    const shV = g.texture(n, n, F16, true);
    g.pass(this.pl("shadow_blur", F16, ["U", "T", "S"]), shV, uni(0, 0, 1), [shH], samp, enc);
    const shadowTex = g.texture(n, n, F16, true, persistent);
    g.pass(this.pl("shadow", F16, ["U", "T", "S"]), shadowTex, uni(), [shV], samp, enc);

    if (key) {
      this.shadowCache.set(key, { key, shadowTex });
      this.trimShadowCache();
    }
    return shadowTex;
  }

  /** Render one glass layer/group. alphaShape/color/bg are RGBA8 (length size*size*4). Returns RGBA8 result. */
  async render(alphaShape: Uint8Array<ArrayBuffer>, colorData: Uint8Array<ArrayBuffer>, bg: Uint8Array<ArrayBuffer>, size: number, u: Float32Array<ArrayBuffer>, shapeKey?: string): Promise<Uint8ClampedArray<ArrayBuffer>> {
    const g = this.gpu, n = size, samp = g.sampler();
    const uni = (step = 0, bx = 0, by = 0) => g.uniform(patch(u, step, bx, by));
    const enc = g.commandEncoder();
    try {
      const shapeRes = this.shapeResources(alphaShape, n, u, enc, shapeKey);
      const { shapeTex, dgTex } = shapeRes;
      const colorTex = g.texture(n, n, F8, false); g.upload(colorTex, colorData, n, n);
      const bgTex = g.texture(n, n, F8, false); g.upload(bgTex, bg, n, n);

      // frosted background blur (no-op when blurRadius<=0)
      const bgH = g.texture(n, n, F8, true);
      g.pass(this.pl("blur", F8, ["U", "T", "S"]), bgH, uni(0, 1, 0), [bgTex], samp, enc);
      const bgBlur = g.texture(n, n, F8, true);
      g.pass(this.pl("blur", F8, ["U", "T", "S"]), bgBlur, uni(0, 0, 1), [bgH], samp, enc);

      const shadowTex = this.shadowResources(shapeRes, colorTex, n, u, enc, shapeKey);

      const glass = g.texture(n, n, F16, true);
      g.pass(this.pl("glass_background", F16, ["U", "T", "T", "S"]), glass, uni(), [dgTex, bgBlur], samp, enc);
      const colorLayerTex = g.texture(n, n, F16, true);
      g.pass(this.pl("color_layer", F16, ["U", "T", "T", "S"]), colorLayerTex, uni(), [dgTex, colorTex], samp, enc);
      const highlight = g.texture(n, n, F16, true);
      g.pass(this.pl("glass_highlight", F16, ["U", "T", "S"]), highlight, uni(), [dgTex], samp, enc);

      const out = g.texture(n, n, F8, true);
      g.pass(this.pl("composite", F8, ["U", "T", "T", "T", "T", "S"]), out, uni(), [shadowTex, glass, colorLayerTex, highlight], samp, enc);

      return await g.readback(out, n, n, enc);
    } finally {
      g.frameDone();
    }
  }
}
