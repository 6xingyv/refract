import type { Format, Tex } from "./backend";

export const textureBytes = (t: Tex) => t.w * t.h * (t.format === "rgba16float" ? 8 : 4);

/** Idle textures only. In-flight resources are returned after their frame completes. */
export class TexturePool<T extends Tex> {
  private idle = new Map<T, string>();
  private bytes = 0;

  constructor(private capacityBytes: number, private destroy: (texture: T) => void) {}

  take(w: number, h: number, format: Format, render: boolean): T | undefined {
    const key = this.key(w, h, format, render);
    for (const [texture, storedKey] of this.idle) {
      if (storedKey !== key) continue;
      this.idle.delete(texture);
      this.bytes -= textureBytes(texture);
      return texture;
    }
  }

  release(texture: T, render: boolean) {
    if (this.idle.has(texture)) return;
    const bytes = textureBytes(texture);
    if (bytes > this.capacityBytes) {
      this.destroy(texture);
      return;
    }
    this.idle.set(texture, this.key(texture.w, texture.h, texture.format, render));
    this.bytes += bytes;
    this.trim();
  }

  setCapacityBytes(bytes: number) {
    this.capacityBytes = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
    this.trim();
  }

  clear() {
    for (const texture of this.idle.keys()) this.destroy(texture);
    this.idle.clear();
    this.bytes = 0;
  }

  private key(w: number, h: number, format: Format, render: boolean) {
    return `${w}:${h}:${format}:${render}`;
  }

  private trim() {
    for (const texture of this.idle.keys()) {
      if (this.bytes <= this.capacityBytes) break;
      this.idle.delete(texture);
      this.bytes -= textureBytes(texture);
      this.destroy(texture);
    }
  }
}
