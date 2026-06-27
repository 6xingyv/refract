// Minimal WebGPU helper - the browser equivalent of Gpu.kt. Each method maps to one WebGPU op.
// The pass graph in renderer.ts stays backend-agnostic; the WGSL shaders are reused verbatim.

import type { BindKind, Format, RenderBackend, RenderEncoder, RenderPipeline, RenderSampler, RenderUniform, Tex } from "./backend";

interface GpuTex extends Tex { tex: GPUTexture; view: GPUTextureView }
interface GpuPipeline extends RenderPipeline { pipeline: GPURenderPipeline; layout: GPUBindGroupLayout; bindings: BindKind[] }

export class Gpu implements RenderBackend {
  readonly kind = "webgpu" as const;
  device!: GPUDevice;
  private pipelines = new Map<string, GpuPipeline>();
  private _sampler?: GPUSampler;
  private transient: GPUTexture[] = [];
  private buffers: GPUBuffer[] = [];

  static async create(): Promise<Gpu> {
    if (!navigator.gpu) throw new Error("WebGPU not available (needs a Chromium-based webview / WebGPU enabled).");
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("No WebGPU adapter.");
    const device = await adapter.requestDevice();
    const g = new Gpu();
    g.device = device;
    return g;
  }

  sampler(): GPUSampler {
    if (!this._sampler)
      this._sampler = this.device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
    return this._sampler;
  }

  texture(w: number, h: number, format: Format, render: boolean, persistent = false): GpuTex {
    let usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC;
    if (render) usage |= GPUTextureUsage.RENDER_ATTACHMENT;
    const tex = this.device.createTexture({ size: { width: w, height: h }, format, usage });
    if (!persistent) this.transient.push(tex);
    return { tex, view: tex.createView(), w, h, format };
  }

  /** Upload RGBA8 bytes (Uint8Array, length w*h*4). */
  destroyTexture(t: Tex) {
    (t as GpuTex).tex.destroy();
  }

  upload(t: Tex, rgba: Uint8Array<ArrayBuffer>, w: number, h: number) {
    this.device.queue.writeTexture({ texture: (t as GpuTex).tex }, rgba, { bytesPerRow: w * 4, rowsPerImage: h }, { width: w, height: h });
  }

  uniform(floats: Float32Array<ArrayBuffer>): GPUBuffer {
    const buf = this.device.createBuffer({ size: floats.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(buf, 0, floats);
    this.buffers.push(buf);
    return buf;
  }

  pipeline(name: string, wgsl: string, target: Format, bindings: BindKind[]): GpuPipeline {
    const cached = this.pipelines.get(name);
    if (cached) return cached;
    const module = this.device.createShaderModule({ code: wgsl, label: name });
    const entries: GPUBindGroupLayoutEntry[] = bindings.map((b, i) => {
      if (b === "U") return { binding: i, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } };
      if (b === "T") return { binding: i, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float", viewDimension: "2d" } };
      return { binding: i, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } };
    });
    const layout = this.device.createBindGroupLayout({ entries });
    const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const pipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: { module, entryPoint: "vs_main" },
      fragment: { module, entryPoint: "fs_main", targets: [{ format: target }] },
      primitive: { topology: "triangle-list" },
    });
    const p = { pipeline, layout, bindings };
    this.pipelines.set(name, p);
    return p;
  }

  commandEncoder(): GPUCommandEncoder {
    return this.device.createCommandEncoder();
  }

  submit(enc: RenderEncoder) {
    this.device.queue.submit([(enc as GPUCommandEncoder).finish()]);
  }

  /** Run one fullscreen pass into `target`. resources are uniform + textures (+ optional sampler), in declaration order. */
  pass(p: RenderPipeline, target: Tex, uniform: RenderUniform, textures: Tex[], sampler?: RenderSampler, enc?: RenderEncoder) {
    const gp = p as GpuPipeline;
    const gt = target as GpuTex;
    const entries: GPUBindGroupEntry[] = [];
    let ti = 0;
    gp.bindings.forEach((b, i) => {
      if (b === "U") entries.push({ binding: i, resource: { buffer: uniform as GPUBuffer } });
      else if (b === "T") entries.push({ binding: i, resource: (textures[ti++] as GpuTex).view });
      else entries.push({ binding: i, resource: (sampler as GPUSampler | undefined) ?? this.sampler() });
    });
    const bindGroup = this.device.createBindGroup({ layout: gp.layout, entries });
    const ownEncoder = (enc as GPUCommandEncoder | undefined) ?? this.commandEncoder();
    const rp = ownEncoder.beginRenderPass({ colorAttachments: [{ view: gt.view, loadOp: "clear", clearValue: { r: 0, g: 0, b: 0, a: 0 }, storeOp: "store" }] });
    rp.setPipeline(gp.pipeline);
    rp.setBindGroup(0, bindGroup);
    rp.draw(3);
    rp.end();
    if (!enc) this.submit(ownEncoder);
  }

  /** copyTextureToBuffer (rgba8) + map -> RGBA Uint8ClampedArray (length w*h*4). */
  async readback(t: Tex, w: number, h: number, enc?: RenderEncoder): Promise<Uint8ClampedArray<ArrayBuffer>> {
    const bytesPerRow = Math.ceil((w * 4) / 256) * 256;
    const buf = this.device.createBuffer({ size: bytesPerRow * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const ownEncoder = (enc as GPUCommandEncoder | undefined) ?? this.commandEncoder();
    ownEncoder.copyTextureToBuffer({ texture: (t as GpuTex).tex }, { buffer: buf, bytesPerRow, rowsPerImage: h }, { width: w, height: h });
    this.submit(ownEncoder);
    await buf.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buf.getMappedRange());
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) out.set(src.subarray(y * bytesPerRow, y * bytesPerRow + w * 4), y * w * 4);
    buf.unmap();
    buf.destroy();
    return out;
  }

  /** Recycle per-frame textures + uniform buffers (pipelines + sampler survive). */
  frameDone() {
    for (const t of this.transient) t.destroy();
    for (const b of this.buffers) b.destroy();
    this.transient = [];
    this.buffers = [];
  }
}
