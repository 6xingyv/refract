// Shared WGSL/GLSL layout. Append material fields after the artwork matrix;
// shadowCol.xyz is reserved for shadow RGB in every material pass.
export const UNIFORM_VEC4_COUNT = 18;
export const UNIFORM_FLOAT_COUNT = UNIFORM_VEC4_COUNT * 4;
export const GLYPH_INSET_SLOT = 68;
export const COATING_BLEND_SLOT = 69;
