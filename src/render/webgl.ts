import type { BindKind, Format, RenderBackend, RenderEncoder, RenderPipeline, RenderSampler, RenderUniform, Tex } from "./backend";
import { GLSL_FRAGMENT, GLSL_VERTEX } from "./glsl";

interface GlTex extends Tex {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer | null;
  deleted: boolean;
}

interface GlPipeline extends RenderPipeline {
  program: WebGLProgram;
  uniformLoc: WebGLUniformLocation | null;
  texLocs: Map<number, WebGLUniformLocation | null>;
  bindings: BindKind[];
}

export class WebGlGpu implements RenderBackend {
  readonly kind = "webgl2" as const;
  private pipelines = new Map<string, GlPipeline>();
  private transient: GlTex[] = [];
  private vao: WebGLVertexArrayObject;

  private constructor(private canvas: HTMLCanvasElement, private gl: WebGL2RenderingContext) {
    const vao = gl.createVertexArray();
    if (!vao) throw new Error("WebGL2 could not create a vertex array.");
    this.vao = vao;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
  }

  static async create(): Promise<WebGlGpu> {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error("WebGL2 not available.");
    if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("WebGL2 floating-point render targets are unavailable.");
    return new WebGlGpu(canvas, gl);
  }

  sampler(): RenderSampler {
    return null;
  }

  texture(w: number, h: number, format: Format, render: boolean, persistent = false): Tex {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error("WebGL2 could not create a texture.");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const spec = textureSpec(gl, format);
    gl.texImage2D(gl.TEXTURE_2D, 0, spec.internalFormat, w, h, 0, gl.RGBA, spec.type, null);

    let framebuffer: WebGLFramebuffer | null = null;
    if (render) {
      framebuffer = gl.createFramebuffer();
      if (!framebuffer) throw new Error("WebGL2 could not create a framebuffer.");
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        gl.deleteFramebuffer(framebuffer);
        gl.deleteTexture(texture);
        throw new Error(`WebGL2 framebuffer incomplete: 0x${status.toString(16)}.`);
      }
    }

    const t: GlTex = { texture, framebuffer, w, h, format, deleted: false };
    if (!persistent) this.transient.push(t);
    return t;
  }

  destroyTexture(t: Tex): void {
    const gt = t as GlTex;
    if (gt.deleted) return;
    if (gt.framebuffer) this.gl.deleteFramebuffer(gt.framebuffer);
    this.gl.deleteTexture(gt.texture);
    gt.deleted = true;
  }

  upload(t: Tex, rgba: Uint8Array<ArrayBuffer>, w: number, h: number): void {
    const gt = t as GlTex;
    if (gt.w !== w || gt.h !== h) throw new Error(`WebGL2 upload size mismatch: ${w}x${h} into ${gt.w}x${gt.h}.`);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, gt.texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, flipRgbaRows(rgba, w, h));
  }

  uniform(floats: Float32Array<ArrayBuffer>): RenderUniform {
    return floats;
  }

  pipeline(name: string, _shaderSource: string, target: Format, bindings: BindKind[]): RenderPipeline {
    const key = `${name}:${target}:${bindings.join("")}`;
    const cached = this.pipelines.get(key);
    if (cached) return cached;
    const fs = GLSL_FRAGMENT[name];
    if (!fs) throw new Error(`Missing WebGL2 shader: ${name}.`);
    const gl = this.gl;
    const program = linkProgram(gl, GLSL_VERTEX, fs, name);
    const texLocs = new Map<number, WebGLUniformLocation | null>();
    bindings.forEach((b, i) => {
      if (b === "T") texLocs.set(i, gl.getUniformLocation(program, `uTex${i}`));
    });
    const pipeline = { program, uniformLoc: gl.getUniformLocation(program, "P"), texLocs, bindings };
    this.pipelines.set(key, pipeline);
    return pipeline;
  }

  commandEncoder(): RenderEncoder {
    return null;
  }

  submit(_enc: RenderEncoder): void {
    this.gl.flush();
  }

  pass(p: RenderPipeline, target: Tex, uniform: RenderUniform, textures: Tex[], _sampler?: RenderSampler, _enc?: RenderEncoder): void {
    const gl = this.gl;
    const gp = p as GlPipeline;
    const gt = target as GlTex;
    if (!gt.framebuffer) throw new Error("WebGL2 render pass target is not renderable.");

    if (this.canvas.width !== gt.w) this.canvas.width = gt.w;
    if (this.canvas.height !== gt.h) this.canvas.height = gt.h;
    gl.bindFramebuffer(gl.FRAMEBUFFER, gt.framebuffer);
    gl.viewport(0, 0, gt.w, gt.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(gp.program);
    gl.bindVertexArray(this.vao);
    if (gp.uniformLoc) gl.uniform4fv(gp.uniformLoc, uniform as Float32Array);

    let textureUnit = 0;
    gp.bindings.forEach((b, i) => {
      if (b !== "T") return;
      const tex = textures[textureUnit] as GlTex;
      gl.activeTexture(gl.TEXTURE0 + textureUnit);
      gl.bindTexture(gl.TEXTURE_2D, tex.texture);
      const loc = gp.texLocs.get(i);
      if (loc) gl.uniform1i(loc, textureUnit);
      textureUnit += 1;
    });

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  async readback(t: Tex, w: number, h: number, _enc?: RenderEncoder): Promise<Uint8ClampedArray<ArrayBuffer>> {
    const gl = this.gl;
    const gt = t as GlTex;
    if (!gt.framebuffer) throw new Error("WebGL2 readback target is not renderable.");
    gl.bindFramebuffer(gl.FRAMEBUFFER, gt.framebuffer);
    const raw = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    return unflipRgbaRows(raw, w, h);
  }

  frameDone(): void {
    for (const t of this.transient) this.destroyTexture(t);
    this.transient = [];
  }
}

function textureSpec(gl: WebGL2RenderingContext, format: Format) {
  if (format === "rgba16float") return { internalFormat: gl.RGBA16F, type: gl.HALF_FLOAT };
  return { internalFormat: gl.RGBA8, type: gl.UNSIGNED_BYTE };
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string, label: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error(`WebGL2 could not create ${label} shader.`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || "unknown error";
    gl.deleteShader(shader);
    throw new Error(`WebGL2 shader compile failed (${label}): ${log}`);
  }
  return shader;
}

function linkProgram(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string, label: string): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource, `${label}:vertex`);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource, `${label}:fragment`);
  const program = gl.createProgram();
  if (!program) throw new Error(`WebGL2 could not create program ${label}.`);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) || "unknown error";
    gl.deleteProgram(program);
    throw new Error(`WebGL2 program link failed (${label}): ${log}`);
  }
  return program;
}

function flipRgbaRows(src: Uint8Array<ArrayBuffer>, w: number, h: number): Uint8Array<ArrayBuffer> {
  const row = w * 4;
  const out = new Uint8Array(row * h);
  for (let y = 0; y < h; y++) {
    out.set(src.subarray((h - 1 - y) * row, (h - y) * row), y * row);
  }
  return out;
}

function unflipRgbaRows(src: Uint8Array, w: number, h: number): Uint8ClampedArray<ArrayBuffer> {
  const row = w * 4;
  const out = new Uint8ClampedArray(row * h);
  for (let y = 0; y < h; y++) {
    out.set(src.subarray((h - 1 - y) * row, (h - y) * row), y * row);
  }
  return out;
}
