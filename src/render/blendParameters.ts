import type { BlendMode } from "../model/types";

// Shader ABI for coating blends (materialExtra.y). These are Refract codes, not
// RenderBox/CG enum values. Keep composite WGSL and GLSL in sync.
const CODES: Record<BlendMode, number> = {
  normal: 0, "plus-lighter": 1, "plus-darker": 2, multiply: 3, screen: 4,
  overlay: 5, "soft-light": 6, "hard-light": 7, darken: 8, lighten: 9,
};
export function materialBlendCode(mode: BlendMode): number { return CODES[mode]; }
