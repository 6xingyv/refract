import { RENDITIONS, type IconDocument, type Rendition } from "../model/types";

export interface MaterialAppearance {
  material: "color" | "clear" | "tinted";
  dark: boolean;
}

/** Artwork specialization is resolved separately with specSlot(). */
export function materialAppearance(rendition: Rendition): MaterialAppearance {
  const { appearanceCode, dark } = RENDITIONS[rendition];
  return {
    material: appearanceCode === 4 ? "tinted" : appearanceCode >= 3 ? "clear" : "color",
    dark,
  };
}

export const IDENTITY_RGB = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0] as const;
const LUMA = [0.2126, 0.7152, 0.0722];

/** Explicit Tinted display uses the selected color even with the legacy toggle off. */
function tintAmount(doc: IconDocument): number {
  return Math.min(1, Math.max(0, doc.tintStrength || 1));
}

/**
 * Apple describes dark tint as foreground color, and light tint as color infused
 * into glass (WWDC25/220). These coefficients are preview policy, not recovered
 * system constants. Artwork is converted once; sampled scene pixels are not.
 */
export function artworkColorMatrix(doc: IconDocument): readonly number[] {
  const ap = materialAppearance(doc.previewRendition);
  if (ap.material === "color") return IDENTITY_RGB;
  const amount = ap.material === "tinted" && ap.dark ? tintAmount(doc) : 0;
  const tint = [doc.tintColor.r, doc.tintColor.g, doc.tintColor.b];
  return tint.flatMap((channel) => [
    ...LUMA.map((weight) => weight * (1 - amount + channel * amount)), 0,
  ]).concat([0, 0, 0, 0]);
}

/** Apply material color to the wallpaper once, at the icon's glass container. */
export function backdropColorMatrix(doc: IconDocument): readonly number[] {
  const ap = materialAppearance(doc.previewRendition);
  if (ap.material === "color") return IDENTITY_RGB;
  // A light/dark neutral veil retains wallpaper chroma and gradients. The
  // previous per-layer grayscale transform erased both chroma and tint contrast.
  const veil = ap.dark ? 0.24 : 0.16;
  const amount = ap.material === "tinted" && !ap.dark ? tintAmount(doc) : 0;
  const tint = [doc.tintColor.r, doc.tintColor.g, doc.tintColor.b];
  return tint.flatMap((channel, row) => [
    ...tint.map((_, column) => row === column ? (1 - veil) * (1 - amount + channel * amount) : 0), 0,
  ]).concat([ap.dark ? 0 : veil, ap.dark ? 0 : veil, ap.dark ? 0 : veil, 0]);
}

/** Canvas fallback shares the GPU's affine transform, including its offset. */
export function transformAppearance(source: ImageData, matrix: readonly number[]): ImageData {
  const out = new ImageData(source.width, source.height);
  for (let i = 0; i < source.data.length; i += 4) {
    for (let row = 0; row < 3; row++) {
      const base = row * 4;
      out.data[i + row] = Math.round(
        source.data[i] * matrix[base] + source.data[i + 1] * matrix[base + 1]
        + source.data[i + 2] * matrix[base + 2] + 255 * matrix[12 + row],
      );
    }
    out.data[i + 3] = source.data[i + 3];
  }
  return out;
}
