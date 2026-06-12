// The preview "canvas" backdrop. Shared by the UI (full-window CSS background) and the
// compositor (painted into the render so the glass refracts it). Six built-in presets + a
// solid colour mode.

export type BgKind = "color" | "image";
export interface BgPreset { stops: { at: number; color: string }[]; radial?: boolean }

export const BG_PRESETS: BgPreset[] = [
  { stops: [{ at: 0, color: "#ff5e62" }, { at: 1, color: "#ff9966" }] },
  { stops: [{ at: 0, color: "#36d1dc" }, { at: 1, color: "#5b86e5" }] },
  { stops: [{ at: 0, color: "#a18cd1" }, { at: 1, color: "#fbc2eb" }] },
  { stops: [{ at: 0, color: "#11998e" }, { at: 1, color: "#38ef7d" }] },
  { stops: [{ at: 0, color: "#fc5c7d" }, { at: 1, color: "#6a82fb" }] },
  { stops: [{ at: 0, color: "#ffd86f" }, { at: 1, color: "#fc6262" }], radial: true },
];

export interface BackdropSpec { kind: BgKind; color: string; image: number }

/** CSS background value for the UI (full-window backdrop / swatches). */
export function presetCss(p: BgPreset): string {
  const stops = p.stops.map((s) => `${s.color} ${Math.round(s.at * 100)}%`).join(",");
  return p.radial ? `radial-gradient(circle at 30% 20%,${stops})` : `linear-gradient(135deg,${stops})`;
}
export function backdropCss(b: BackdropSpec): string {
  return b.kind === "image" ? presetCss(BG_PRESETS[b.image] ?? BG_PRESETS[0]) : b.color;
}

/** Whether the backdrop is dark enough that panels should switch to light ink. */
export function isDarkBackdrop(b: BackdropSpec): boolean {
  if (b.kind === "image") return true; // the gradient presets read as mid/dark behind UI
  const m = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(b.color.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum < 0.5;
}

/** Paint the same backdrop onto a Canvas2D context (for the glass refraction source). */
export function paintBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number, b: BackdropSpec) {
  if (b.kind === "image") {
    const p = BG_PRESETS[b.image] ?? BG_PRESETS[0];
    const g = p.radial
      ? ctx.createRadialGradient(w * 0.3, h * 0.2, 0, w * 0.3, h * 0.2, Math.hypot(w, h))
      : ctx.createLinearGradient(0, 0, w, h);
    for (const s of p.stops) g.addColorStop(s.at, s.color);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = b.color;
  }
  ctx.fillRect(0, 0, w, h);
}
