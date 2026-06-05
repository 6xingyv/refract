// The glass pass graph - browser WebGPU port of WgpuRenderEngine.renderOnGpu.
// JFA -> SDF -> sdf_blur -> distance_gradient ; background blur ; shadow ; glass/color/highlight ; composite.
import { Gpu, Format, BindKind } from "./gpu";
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

export class Renderer {
  constructor(private gpu: Gpu) {}

  static async create(): Promise<Renderer> {
    return new Renderer(await Gpu.create());
  }

  private pl(name: string, target: Format, bindings: BindKind[]) {
    return this.gpu.pipeline(name, common + "\n" + SRC[name], target, bindings);
  }

  /** Render one glass layer. shape/bg are RGBA8 (length size*size*4). Returns RGBA8 result. */
  async render(shape: Uint8Array<ArrayBuffer>, bg: Uint8Array<ArrayBuffer>, size: number, u: Float32Array<ArrayBuffer>): Promise<Uint8ClampedArray<ArrayBuffer>> {
    const g = this.gpu, n = size, samp = g.sampler();
    const uni = (step = 0, bx = 0, by = 0) => g.uniform(patch(u, step, bx, by));
    try {
      const shapeTex = g.texture(n, n, F8, false); g.upload(shapeTex, shape, n, n);
      const bgTex = g.texture(n, n, F8, false); g.upload(bgTex, bg, n, n);

      // JFA -> normalised SDF
      let seedSrc = g.texture(n, n, F16, true);
      let seedDst = g.texture(n, n, F16, true);
      g.pass(this.pl("jfa_seed", F16, ["U", "T"]), seedSrc, uni(), [shapeTex]);
      const steps = Math.ceil(Math.log2(n));
      let step = 1 << (steps - 1);
      for (let i = 0; i < steps; i++) {
        g.pass(this.pl("jfa_flood", F16, ["U", "T"]), seedDst, uni(step), [seedSrc]);
        [seedSrc, seedDst] = [seedDst, seedSrc];
        step = Math.max(1, step >> 1);
      }
      for (let i = 0; i < 2; i++) {
        g.pass(this.pl("jfa_flood", F16, ["U", "T"]), seedDst, uni(1), [seedSrc]);
        [seedSrc, seedDst] = [seedDst, seedSrc];
      }
      const sdf = g.texture(n, n, F16, true);
      g.pass(this.pl("sdf_resolve", F16, ["U", "T", "T"]), sdf, uni(), [seedSrc, shapeTex]);

      // smooth SDF (.r) for clean normals
      const sdfH = g.texture(n, n, F16, true);
      g.pass(this.pl("sdf_blur", F16, ["U", "T", "S"]), sdfH, uni(0, 1, 0), [sdf], samp);
      const sdfS = g.texture(n, n, F16, true);
      g.pass(this.pl("sdf_blur", F16, ["U", "T", "S"]), sdfS, uni(0, 0, 1), [sdfH], samp);

      const dg = g.texture(n, n, F16, true);
      g.pass(this.pl("distance_gradient", F16, ["U", "T", "S"]), dg, uni(), [sdfS], samp);

      // frosted background blur (no-op when blurRadius<=0)
      const bgH = g.texture(n, n, F8, true);
      g.pass(this.pl("blur", F8, ["U", "T", "S"]), bgH, uni(0, 1, 0), [bgTex], samp);
      const bgBlur = g.texture(n, n, F8, true);
      g.pass(this.pl("blur", F8, ["U", "T", "S"]), bgBlur, uni(0, 0, 1), [bgH], samp);

      // shadow = nearest-edge coloured coverage (layer-color), separable gaussian, then offset
      const shadowSrcTex = g.texture(n, n, F16, true);
      g.pass(this.pl("shadow_source", F16, ["U", "T", "T", "T"]), shadowSrcTex, uni(), [seedSrc, shapeTex, sdf]);
      const shH = g.texture(n, n, F16, true);
      g.pass(this.pl("shadow_blur", F16, ["U", "T", "S"]), shH, uni(0, 1, 0), [shadowSrcTex], samp);
      const shV = g.texture(n, n, F16, true);
      g.pass(this.pl("shadow_blur", F16, ["U", "T", "S"]), shV, uni(0, 0, 1), [shH], samp);
      const shadowTex = g.texture(n, n, F16, true);
      g.pass(this.pl("shadow", F16, ["U", "T", "S"]), shadowTex, uni(), [shV], samp);

      const glass = g.texture(n, n, F16, true);
      g.pass(this.pl("glass_background", F16, ["U", "T", "T", "S"]), glass, uni(), [dg, bgBlur], samp);
      const color = g.texture(n, n, F16, true);
      g.pass(this.pl("color_layer", F16, ["U", "T", "T", "S"]), color, uni(), [dg, shapeTex], samp);
      const highlight = g.texture(n, n, F16, true);
      g.pass(this.pl("glass_highlight", F16, ["U", "T", "S"]), highlight, uni(), [dg], samp);

      const out = g.texture(n, n, F8, true);
      g.pass(this.pl("composite", F8, ["U", "T", "T", "T", "T", "S"]), out, uni(), [shadowTex, glass, color, highlight], samp);

      return await g.readback(out, n, n);
    } finally {
      g.frameDone();
    }
  }
}
