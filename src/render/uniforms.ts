// Builds the Float32Array(48) = 12 vec4 that maps 1:1 to common.wgsl.inc (port of Uniforms.kt).
import { IconDocument, Group, Layer, IcColor, RENDITIONS } from "../model/types";

export function buildUniforms(
  size: number, doc: IconDocument, group: Group, layer: Layer,
  sampledColor: IcColor | null, usesAssetColor: boolean,
): Float32Array<ArrayBuffer> {
  const res = size, texel = 1 / size;
  const ap = RENDITIONS[doc.previewRendition].appearanceCode;
  const sp = layer.specular.enabled ? layer.specular : group.specular;

  const sdfRangePx = 0.18 * res;
  const heightNorm = Math.min(0.9, Math.max(0.02, sp.height / 60));
  const refractScalePx = 0.045 * res;
  const lr = (doc.lightAngleDeg * Math.PI) / 180;
  const ldx = Math.cos(lr), ldy = Math.sin(lr);

  const glassOn = group.glassEnabled && layer.isGlass ? 1 : 0;
  const specOn = glassOn > 0 && group.specular.enabled && sp.enabled ? 1 : 0;
  const glowOn = 0, glowRadiusNorm = 0.5;

  const blurOn = group.glassEnabled && group.blurMaterial.enabled;
  const blurPx = blurOn ? group.blurMaterial.strength * 0.1 * res : 0;

  const shadowOn = group.shadow.enabled;
  const layerColorShadowOn = shadowOn && group.shadow.kind === "layerColor";
  // Apple shadows are present but restrained; document opacity scaled down for preview/export.
  const shadowPx = shadowOn ? group.shadow.radius * 1.1 * (res / 512) : 0;
  const shadowOpacity = shadowOn ? group.shadow.opacity * 0.65 : 0;
  const shadowOffY = shadowOn ? group.shadow.radius * 0.24 * (res / 512) : 0;
  const sc = group.shadow.color;

  const translucency = group.glassEnabled && group.translucency.enabled
    ? Math.min(1, Math.max(0, group.translucency.value > 1 ? group.translucency.value / 100 : group.translucency.value))
    : 0;

  const gc = sampledColor ?? (layer.fill.kind !== "none" ? layer.fill.primaryColor : sp.color);
  const gcAmount = usesAssetColor ? 1 : layer.fill.kind !== "none" ? 0.65 * gc.a : 0;

  const tintC = doc.tintColor;
  const tintStrength = ap === 4 ? doc.tintStrength : 0;

  return new Float32Array([
    res, res, texel, texel,
    sdfRangePx, heightNorm, refractScalePx, sp.curvature,
    ldx, ldy, sp.spread, sp.biasAmount,
    glowRadiusNorm, blurPx, shadowPx, shadowOpacity,
    0, 0, 0, ap,
    gc.r, gc.g, gc.b, gcAmount,
    tintC.r, tintC.g, tintC.b, tintStrength,
    sc.r, sc.g, sc.b, 0,
    0, shadowOffY, specOn, glowOn,
    glassOn, translucency, usesAssetColor ? 1 : 0, layerColorShadowOn ? 1 : 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ]);
}

/** Patch the per-pass slots: jfaStep (16), blurDir (17,18). */
export function patch(u: Float32Array, step = 0, bx = 0, by = 0): Float32Array<ArrayBuffer> {
  const c = u.slice();
  c[16] = step; c[17] = bx; c[18] = by;
  return c;
}
