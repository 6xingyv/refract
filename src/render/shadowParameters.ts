import type { Shadow } from "../model/types";

// iOS 26.4 (23E246), IconRendering ICRRenderingParameters.standardShadow.
// Defaults at 0x1b308fea0; selection/opacity multiplication at 0x1b308b1d0.
// These are renderer multipliers, not the authored .icon shadow opacity.
const NATIVE_SHADOW = { neutralOpacity: 0.1, vibrantOpacity: 0.5, offsetX: 16, offsetY: 16 };

export function shadowParameters(shadow: Shadow, size: number) {
  // Automatic's material-dependent selection remains unresolved. Keep its
  // existing Neutral fallback explicit rather than treating it as vibrant.
  const vibrant = shadow.kind === "layerColor";
  const enabled = shadow.enabled && shadow.kind !== "none";
  const opacity = enabled
    ? Math.min(1, Math.max(0, shadow.opacity)) * (vibrant ? NATIVE_SHADOW.vibrantOpacity : NATIVE_SHADOW.neutralOpacity)
    : 0;
  const scale = size / 1024;
  return {
    vibrant,
    opacity,
    offsetX: enabled ? NATIVE_SHADOW.offsetX * scale : 0,
    offsetY: enabled ? NATIVE_SHADOW.offsetY * scale : 0,
    // Native blur receives sigma = 0.35 * 64 * design-space scale. RenderBox's
    // GaussianBlur.render squares that radius into the kernel's variance.
    sigma: enabled ? Math.max(0, shadow.radius) * scale : 0,
  };
}
