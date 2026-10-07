import type { IconDocument } from "../model/types";
import { RENDITIONS } from "../model/types";
import { UNIFORM_FLOAT_COUNT } from "./uniformLayout";

// iOS 26.4 ICRRenderingParameters.standardHighlights, initializer 0x1b308f4a8.
// SizeBasedValue storage order: display, large, medium, small. Thresholds at
// 0x1b30dc9e0/0x1b308fb84 are 25, 60, 128. Using render pixels to select a size
// class is our preview adapter; native device/display-scale routing is pending.
type SizeValues = readonly [number, number, number, number];
function sizeValue(values: SizeValues, size: number): number {
  return values[size < 25 ? 3 : size < 60 ? 2 : size < 128 ? 1 : 0];
}

export function glyphHighlightParameters(size: number, width: number | null) {
  return {
    width: width ?? sizeValue([12, 12, 10, 10], size),
    inset: sizeValue([6, 0, 2, 3], size),
    minInsetPixels: sizeValue([1, 0, 0, 0], size),
    staticOpacity: sizeValue([0.08, 0.05, 0.05, 0.03], size),
    dynamicOpacity: sizeValue([0.3, 0.18, 0.2, 0.2], size),
    curvature: sizeValue([0.8, 0, 0, 0], size),
  };
}

/** Pass-specific packing for chiclet_highlight; never used as material uniforms. */
export function chicletHighlightUniforms(renderSize: number, iconSize: number, doc: IconDocument): Float32Array<ArrayBuffer> {
  const u = new Float32Array(UNIFORM_FLOAT_COUNT);
  u.set([renderSize, renderSize, 1 / renderSize, 1 / renderSize]);
  u[4] = 0.18 * renderSize;
  const scale = iconSize / 1024;
  const angle = doc.lightAngleDeg * Math.PI / 180;
  const dark = RENDITIONS[doc.previewRendition].dark;
  const width = sizeValue([22, 22, 30, 39], iconSize) * scale;
  // Each lobe: width in render pixels, angular threshold, inset, opacity.
  // Native angular spreads are 78/65/180 degrees. Cosine is the preview's
  // angle-to-dot adapter; the native CPU conversion has not been reconstructed.
  u.set([width, Math.cos(78 * Math.PI / 180), 0,
    sizeValue(dark ? [0.4, 0.4, 0.3, 0.2] : [0.6, 0.6, 0.5, 0.4], iconSize)], 20);
  u.set([width, Math.cos(65 * Math.PI / 180), 0,
    sizeValue(dark ? [0.25, 0.25, 0.2, 0.15] : [0.4, 0.4, 0.3, 0.25], iconSize)], 24);
  u.set([width, -1, 0,
    sizeValue(dark ? [0.05, 0.05, 0.04, 0.03] : [0.08, 0.08, 0.06, 0.04], iconSize)], 28);
  // Static and dynamic: incoming direction XY, bias, intensity.
  u.set([1, 0, 1, 1], 32);
  u.set([Math.cos(angle), Math.sin(angle), 0.5, 1], 36);
  u.set([1.1, 1.1, 1, 0], 40); // key, fill, rim brightness
  u[44] = sizeValue([0.8, 0, 0, 0], iconSize);
  return u;
}
