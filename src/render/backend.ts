export type Format = "rgba8unorm" | "rgba16float";
export type BindKind = "U" | "T" | "S";
export type BackendKind = "webgpu" | "webgl2";

export interface Tex {
  w: number;
  h: number;
  format: Format;
}

export interface RenderPipeline {
  bindings: BindKind[];
}

export type RenderUniform = unknown;
export type RenderSampler = unknown;
export type RenderEncoder = unknown;

export interface RenderBackend {
  readonly kind: BackendKind;
  sampler(): RenderSampler;
  texture(w: number, h: number, format: Format, render: boolean, persistent?: boolean): Tex;
  destroyTexture(t: Tex): void;
  upload(t: Tex, rgba: Uint8Array<ArrayBuffer>, w: number, h: number): void;
  uniform(floats: Float32Array<ArrayBuffer>): RenderUniform;
  pipeline(name: string, shaderSource: string, target: Format, bindings: BindKind[]): RenderPipeline;
  commandEncoder(): RenderEncoder;
  submit(enc: RenderEncoder): void;
  pass(p: RenderPipeline, target: Tex, uniform: RenderUniform, textures: Tex[], sampler?: RenderSampler, enc?: RenderEncoder): void;
  readback(t: Tex, w: number, h: number, enc?: RenderEncoder): Promise<Uint8ClampedArray<ArrayBuffer>>;
  frameDone(): void;
}
