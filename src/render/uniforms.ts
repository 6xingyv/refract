// 18 vec4 slots shared by the WGSL and GLSL material passes.
import { IconDocument, Group, Layer, IcColor, RENDITIONS } from "../model/types";
import { artworkColorMatrix } from "./appearance";
import { shadowParameters } from "./shadowParameters";
import { glyphHighlightParameters } from "./highlightParameters";
import { materialBlurSigma } from "./blurParameters";

export interface ShapeBounds {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export function buildUniforms(
  size: number, doc: IconDocument, group: Group, layer: Layer,
  sampledColor: IcColor | null, usesAssetColor: boolean,
  shapeBounds: ShapeBounds = { top: 0, bottom: 1, left: 0, right: 1 },
): Float32Array<ArrayBuffer> {
  const res = size, texel = 1 / size;
  const ap = RENDITIONS[doc.previewRendition].appearanceCode;
  const sp = group.specular;

  const sdfRangePx = 0.18 * res;
  // Refraction's local geometry bevel is independent of highlight width.
  const heightNorm = Math.max(0.5, 3 * res / 1024) / sdfRangePx;
  const highlight = glyphHighlightParameters(res, sp.height);
  const highlightWidthPx = Math.max(0, highlight.width) * res / 1024;
  const highlightInsetPx = Math.max(highlight.minInsetPixels, highlight.inset * res / 1024);
  const highlightCurvature = sp.curvature ?? highlight.curvature;
  // ICRRenderingParameters.glyphTranslucentBorderWidth = 25.8 design points.
  // The coating's contour transition is independent of the specular bevel.
  const translucentBorderNorm = Math.max(0.5, 25.8 * res / 1024) / sdfRangePx;
  const refractScalePx = 0.045 * res;
  const lr = (doc.lightAngleDeg * Math.PI) / 180;
  const ldx = Math.cos(lr), ldy = Math.sin(lr);

  const glassOn = group.glassEnabled && layer.isGlass ? 1 : 0;
  const specOn = glassOn > 0 && group.specular.enabled && sp.enabled ? 1 : 0;
  const glowRadiusNorm = 0.5;

  const blurSigmaPx = group.glassEnabled ? materialBlurSigma(group.blurMaterial, res) : 0;

  const shadow = shadowParameters(group.shadow, res);

  const translucency = group.glassEnabled && group.translucency.enabled
    ? Math.min(1, Math.max(0, group.translucency.value > 1 ? group.translucency.value / 100 : group.translucency.value))
    : 0;

  const gc = sampledColor ?? (layer.fill.kind !== "none" ? layer.fill.primaryColor : sp.color);
  const gcAmount = usesAssetColor ? 1 : layer.fill.kind !== "none" ? gc.a : 0;

  const shapeTop = Math.max(0, Math.min(1 - texel, shapeBounds.top));
  const shapeBottom = Math.max(shapeTop + texel, Math.min(1, shapeBounds.bottom));

  return new Float32Array([
    res, res, texel, texel,
    sdfRangePx, heightNorm, refractScalePx, highlightCurvature,
    ldx, ldy, sp.spread, sp.biasAmount,
    glowRadiusNorm, blurSigmaPx, shadow.sigma, shadow.opacity,
    0, 0, 0, ap,
    gc.r, gc.g, gc.b, gcAmount,
    highlightWidthPx, highlightWidthPx, highlightCurvature, sp.spread,
    0, 0, 0, highlight.staticOpacity, // Neutral shadow RGB, static highlight opacity in W
    shadow.offsetX, shadow.offsetY, specOn, highlight.dynamicOpacity,
    glassOn, translucency, usesAssetColor ? 1 : 0, shadow.vibrant ? 1 : 0,
    shapeTop, shapeBottom, shapeBounds.left, shapeBounds.right,
    0, 0, 1, translucentBorderNorm, // export alpha, scene output, item opacity, coating border
    sp.color.r, sp.color.g, sp.color.b, sp.color.a,
    ...artworkColorMatrix(doc),
    highlightInsetPx, 0, 0, 0, // materialExtra: glyph inset, coating blend, reserved
  ]);
}

/** Patch the per-pass slots: jfaStep (16), blurDir (17,18). */
export function patch(u: Float32Array, step = 0, bx = 0, by = 0): Float32Array<ArrayBuffer> {
  const c = u.slice();
  c[16] = step; c[17] = bx; c[18] = by;
  return c;
}
