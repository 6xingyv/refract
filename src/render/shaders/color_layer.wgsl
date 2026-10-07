// Source coating with the shape-aware material mask. Geometry coverage is
// divided out here and applied once in composite. Texture filtering is premul.
@group(0) @binding(1) var dgTex : texture_2d<f32>;
@group(0) @binding(2) var colorTex : texture_2d<f32>;
@group(0) @binding(3) var samp : sampler;

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
    let dg = textureSample(dgTex, samp, in.uv);
    let src = textureSample(colorTex, samp, in.uv);
    let rgb = appearanceRgb(mix(P.glassCol.rgb, src.rgb / max(src.a, 1e-6), assetColorOn()));
    let sourceOpacity = mix(1.0, clamp(src.a / max(dg.a, 1e-6), 0.0, 1.0), assetColorOn());
    let layerOpacity = mix(P.glassCol.a, 1.0, assetColorOn());
    return vec4<f32>(rgb, sourceOpacity * layerOpacity * materialMask(in.uv, dg.r));
}
