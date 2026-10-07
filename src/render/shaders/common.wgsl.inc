// ============================================================================
//  common.wgsl.inc  - shared prelude prepended to every pass.
//  Uniform = FloatArray(72) = 18 vec4 slots (built by uniforms.ts).
//  DG convention: NORMALISED signed distance, positive inside, negative outside.
//  The intermediate SDF splits positive/negative distance into R/G. Material
//  depths clamp their own inside distance; highlighters retain both signs.
//  highlight passes decode distance and widths to render pixels.
// ============================================================================

struct Params {
    res_texel : vec4<f32>,   // res.x, res.y, texel.x, texel.y
    sdf       : vec4<f32>,   // sdfRangePx, heightNorm, refractScalePx, curvature
    light     : vec4<f32>,   // lightDir.x, lightDir.y, spread, biasAmount
    effect    : vec4<f32>,   // glowRadiusNorm, blurSigmaPx, shadowSigmaPx, shadowOpacity
    passInfo  : vec4<f32>,   // jfaStep, blurDir.x, blurDir.y, appearanceCode   (patched per pass)
    glassCol  : vec4<f32>,   // color layer rgb, a = color layer opacity
    tint      : vec4<f32>,   // glyph static/dynamic width px, curvature, spread
    shadowCol : vec4<f32>,   // shadow RGB, static glyph highlight opacity
    shadowGeo : vec4<f32>,   // shadowOffset.x, shadowOffset.y, specularOn, dynamic glyph opacity
    flags     : vec4<f32>,   // glassOn, translucency, assetColorOn, layerColorShadowOn
    shapeBounds : vec4<f32>, // top, bottom, left, right
    _r11      : vec4<f32>, // export alpha, scene output, item opacity, coating border
    specColor : vec4<f32>,
    tintRow0 : vec4<f32>, // per-pass RGB matrix: artwork or container backdrop
    tintRow1 : vec4<f32>,
    tintRow2 : vec4<f32>,
    tintRow3 : vec4<f32>,
    materialExtra : vec4<f32>, // glyph inset px, coating blend code, reserved, reserved
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
fn blurSigma()    -> f32 { return P.effect.y; }
fn shadowSigma()  -> f32 { return P.effect.z; }
fn shadowOpacity()-> f32 { return P.effect.w; }
fn jfaStep()      -> f32 { return P.passInfo.x; }
fn blurDir()      -> vec2<f32> { return P.passInfo.yz; }
fn appearance()   -> f32 { return P.passInfo.w; }
fn shadowOffset() -> vec2<f32> { return P.shadowGeo.xy; }
fn specularOn()   -> f32 { return P.shadowGeo.z; }
// Compatibility for the unregistered legacy glow pass. Active material passes
// use this slot for dynamic highlight opacity.
fn glowOn()       -> f32 { return P.shadowGeo.w; }
fn glassOn()      -> f32 { return P.flags.x; }
fn translucency() -> f32 { return P.flags.y; }
fn assetColorOn() -> f32 { return P.flags.z; }
fn layerColorShadowOn() -> f32 { return P.flags.w; }
fn shapeTop()     -> f32 { return P.shapeBounds.x; }
fn shapeBottom()  -> f32 { return P.shapeBounds.y; }
fn exportAlphaMode() -> f32 { return P._r11.x; }
fn sceneOutput() -> f32 { return P._r11.y; }
fn itemOpacity() -> f32 { return P._r11.z; }
fn translucentBorder() -> f32 { return P._r11.w; }

// Two half-float pairs preserve fractional contour positions at large sizes.
// XY stores integer 16-pixel tiles; ZW stores the contour position within a tile.
// A negative tile X marks an absent seed. Do not filter these packed values.
const CONTOUR_SEED_BLOCK: f32 = 16.0;
fn contourSeedPosition(seed: vec4<f32>) -> vec2<f32> {
    return seed.xy * CONTOUR_SEED_BLOCK + seed.zw;
}

fn appearanceRgb(rgb: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(dot(rgb, P.tintRow0.xyz), dot(rgb, P.tintRow1.xyz), dot(rgb, P.tintRow2.xyz)) + P.tintRow3.xyz;
}

// iOS 26.4 simplifiedShapeAwareGradientMask_v1: a vertical, shape-relative
// coating gradient with separate interior and contour opacity endpoints.
// Unlike the older shapeAwareGradientMask, this path has no light direction.
// Our SDF is decoded to inside-distance. Authored-strength interpolation and
// mapping transformed geometry to the shader bounds remain preview policy.
fn materialMask(uv: vec2<f32>, distance: f32) -> f32 {
    let gradient = clamp((uv.y - shapeTop()) / max(shapeBottom() - shapeTop(), texel().y), 0.0, 1.0);
    let interior = clamp(distance / max(translucentBorder(), 1e-6), 0.0, 1.0);
    // ICRRenderingParameters: upper/lower interior = 1/0; contour = 0.2/0.61.
    let innerOpacity = mix(1.0, 0.0, gradient);
    let contourOpacity = mix(0.2, 0.61, gradient);
    let opacity = clamp(mix(1.0, mix(contourOpacity, innerOpacity, interior), translucency()), 0.0, 1.0);
    let smoothed = opacity * opacity * (3.0 - 2.0 * opacity);
    let aa = clamp(fwidth(interior), 0.0009765625, 2.0) * 0.8330078125;
    return mix(1.0, smoothed, clamp(interior / aa + 0.5, 0.0, 1.0));
}

// Recovered glassHighlight arithmetic. Distance, inset and width must use the
// same physical units: applying AIR's fwidth clamps to our normalized SDF made
// the AA band depend on texture resolution. Refraction has a separate bevel.
fn glassHighlightStrength(distancePx: f32, normal: vec2<f32>, widthPx: f32,
                          insetPx: f32, angularSpread: f32, direction: vec2<f32>,
                          bias: f32, curveAmount: f32) -> f32 {
    let d = distancePx - insetPx;
    let aa = clamp(fwidth(d), 0.0009765625, 2.0) * 0.8330078125;
    let coverage = clamp((widthPx - d) / aa + 0.5, 0.0, 1.0)
        * clamp(d / aa + 0.5, 0.0, 1.0);
    let up = clamp(d / max(widthPx, 1e-6), 0.0, 1.0);
    let curve = mix(1.0, 1.0 - up, curveAmount);
    let light = clamp((dot(normal, direction) - angularSpread) / max(1.0 - angularSpread, 0.0009765625), 0.0, 1.0);
    let divisor = max(1.0 + (1.0 - light) * bias, 0.0009765625);
    return select(0.0, curve * coverage * light / divisor, widthPx > 0.0);
}

// Blur passes alone repurpose material slots as eight CPU-built sample pairs.
// Each bilinear sample merges two adjacent Gaussian taps (RenderBox kernel).
fn pairedGaussianBlur(source: texture_2d<f32>, linearSampler: sampler, uv: vec2<f32>) -> vec4<f32> {
    var weights = array<f32, 8>(P.glassCol.x, P.glassCol.y, P.glassCol.z, P.glassCol.w,
                               P.tint.x, P.tint.y, P.tint.z, P.tint.w);
    var offsets = array<f32, 8>(P.shadowCol.x, P.shadowCol.y, P.shadowCol.z, P.shadowCol.w,
                               P.shadowGeo.x, P.shadowGeo.y, P.shadowGeo.z, P.shadowGeo.w);
    let stepUv = blurDir() * texel();
    var sum = vec4<f32>(0.0);
    for (var i = 0u; i < 8u; i = i + 1u) {
        if (weights[i] > 0.0) {
            let offset = stepUv * offsets[i];
            sum = sum + weights[i] * (textureSampleLevel(source, linearSampler, uv - offset, 0.0)
                                    + textureSampleLevel(source, linearSampler, uv + offset, 0.0));
        }
    }
    return sum;
}

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
