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

    // displacement: strongest near the edge (small h), zero deep inside
    let t    = clamp(h / max(height(), 1e-3), 0.0, 1.0);
    let disp = (1.0 - smoothstep(0.0, 1.0, t)) * refractScale();
    let refr = in.uv - disp * normal * texel();

    // Apple applies an affine RGB matrix before the surface mask. The renderer
    // supplies the container's matrix here, or identity for an already-colored
    // scene sampled by an upper layer. It differs from the artwork's matrix. We use
    // straight alpha between material passes and apply geometry in composite.
    // Filtering/blur of the background is premultiplied.
    let bg = textureSample(bgTex, samp, refr);
    let rgb = appearanceRgb(bg.rgb / max(bg.a, 1e-6));
    let alpha = select(bg.a, bg.a * materialMask(in.uv, dg.r), exportAlphaMode() > 0.5);
    // This is local material opacity. Shape coverage is applied once in
    // composite after the color coating has been blended over the glass.
    return vec4<f32>(rgb, alpha * glassOn());
}
