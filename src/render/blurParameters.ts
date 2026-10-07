import type { BlurMaterial } from "../model/types";

// iOS 26.4 (23E246) ICRRenderingParameters: radius scale = 64 (field 0x138),
// maxBlurStrength = 2 (field 0x140), initialized at 0x1b308fb64..0x1b308fb74.
// The material draw at 0x1b308c6ec..0x1b308c708 multiplies the radius scale by
// min(authored strength, maxBlurStrength). RenderBox interprets radius as sigma.
export const MAX_MATERIAL_BLUR_STRENGTH = 2;
const MATERIAL_BLUR_RADIUS = 64;

/** Authored strength (1 = 100%) to Gaussian sigma in render pixels. */
export function materialBlurSigma(blur: BlurMaterial, size: number): number {
  if (!blur.enabled || !Number.isFinite(blur.strength)) return 0;
  const strength = Math.min(MAX_MATERIAL_BLUR_STRENGTH, Math.max(0, blur.strength));
  return strength * MATERIAL_BLUR_RADIUS * size / 1024;
}
