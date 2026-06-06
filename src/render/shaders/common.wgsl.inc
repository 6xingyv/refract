// ============================================================================
//  common.wgsl.inc  - shared prelude prepended to every pass.
//  Uniform = FloatArray(48) = 12 vec4 slots (built by Uniforms.kt).
//  SDF convention: NORMALISED inside-distance. 0 = outside/edge, ramping to ~1
//  deep inside (over sdfRange pixels). All "depth" params are in this 0..1 space.
// ============================================================================

struct Params {
    res_texel : vec4<f32>,   // res.x, res.y, texel.x, texel.y
    sdf       : vec4<f32>,   // sdfRangePx, heightNorm, refractScalePx, curvature
    light     : vec4<f32>,   // lightDir.x, lightDir.y, spread, biasAmount
    effect    : vec4<f32>,   // glowRadiusNorm, blurRadiusPx, shadowRadiusPx, shadowOpacity
    passInfo  : vec4<f32>,   // jfaStep, blurDir.x, blurDir.y, appearanceCode   (patched per pass)
    glassCol  : vec4<f32>,   // color layer rgb, a = color layer opacity
    tint      : vec4<f32>,   // appearance tint rgb, a = tint strength
    shadowCol : vec4<f32>,   // shadow rgb, a unused
    shadowGeo : vec4<f32>,   // shadowOffset.x, shadowOffset.y, specularOn, glowOn
    flags     : vec4<f32>,   // glassOn, translucency, assetColorOn, layerColorShadowOn
    shapeBounds : vec4<f32>, // shapeTop, shapeBottom, unused, unused
    _r11      : vec4<f32>,
};

@group(0) @binding(0) var<uniform> P : Params;

fn resolution()   -> vec2<f32> { return P.res_texel.xy; }
fn texel()        -> vec2<f32> { return P.res_texel.zw; }
fn sdfRange()     -> f32 { return P.sdf.x; }
fn height()       -> f32 { return P.sdf.y; }
fn refractScale() -> f32 { return P.sdf.z; }
fn curvature()    -> f32 { return P.sdf.w; }
fn lightDir()     -> vec2<f32> { return P.light.xy; }
fn spread()       -> f32 { return P.light.z; }
fn biasAmount()   -> f32 { return P.light.w; }
fn glowRadius()   -> f32 { return P.effect.x; }
fn blurRadius()   -> f32 { return P.effect.y; }
fn shadowRadius() -> f32 { return P.effect.z; }
fn shadowOpacity()-> f32 { return P.effect.w; }
fn jfaStep()      -> f32 { return P.passInfo.x; }
fn blurDir()      -> vec2<f32> { return P.passInfo.yz; }
fn appearance()   -> f32 { return P.passInfo.w; }
fn shadowOffset() -> vec2<f32> { return P.shadowGeo.xy; }
fn specularOn()   -> f32 { return P.shadowGeo.z; }
fn glowOn()       -> f32 { return P.shadowGeo.w; }
fn glassOn()      -> f32 { return P.flags.x; }
fn translucency() -> f32 { return P.flags.y; }
fn assetColorOn() -> f32 { return P.flags.z; }
fn layerColorShadowOn() -> f32 { return P.flags.w; }
fn shapeTop()     -> f32 { return P.shapeBounds.x; }
fn shapeBottom()  -> f32 { return P.shapeBounds.y; }

struct VsOut {
    @builtin(position) pos : vec4<f32>,
    @location(0)       uv  : vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid : u32) -> VsOut {
    var out : VsOut;
    let x = f32((vid << 1u) & 2u);
    let y = f32(vid & 2u);
    out.pos = vec4<f32>(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
    out.uv  = vec2<f32>(x, 1.0 - y);
    return out;
}
