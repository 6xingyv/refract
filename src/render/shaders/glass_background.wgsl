// SimulatedGlass::glass_background - refract the background through the glass
// surface. dgTex = distance_gradient (.r=sdf, .gb=normal, .a=cov).
// bgTex = everything composited BELOW this layer (already blurred if BlurMaterial).
@group(0) @binding(1) var dgTex : texture_2d<f32>;
@group(0) @binding(2) var bgTex : texture_2d<f32>;
@group(0) @binding(3) var samp  : sampler;

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
    let dg     = textureSample(dgTex, samp, in.uv);
    let h      = dg.r;
    let normal = dg.gb;
    let cov    = dg.a;

    // displacement: strongest near the edge (small h), zero deep inside
    let t    = clamp(h / max(height(), 1e-3), 0.0, 1.0);
    let disp = (1.0 - smoothstep(0.0, 1.0, t)) * refractScale();
    let refr = in.uv - disp * normal * texel();

    let bg = textureSample(bgTex, samp, refr);
    if (exportAlphaMode() > 0.5 && glassOn() > 0.5) {
        let translucentPct = clamp(translucency(), 0.0, 1.0);
        let bottomAlpha = 1.0 - translucentPct;
        let shapeHeight = max(shapeBottom() - shapeTop(), texel().y);
        let shapeY = clamp((in.uv.y - shapeTop()) / shapeHeight, 0.0, 1.0);
        let materialAlpha = mix(1.0, bottomAlpha, shapeY);
        return vec4<f32>(bg.rgb, cov * materialAlpha);
    }
    return vec4<f32>(bg.rgb, cov * glassOn());
}
