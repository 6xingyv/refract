// shadow - resolve: take the separably-blurred premultiplied shadow source,
// shift it by the shadow offset, and return straight-alpha colour.
@group(0) @binding(1) var covTex : texture_2d<f32>;
@group(0) @binding(2) var samp   : sampler;

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
    let off = shadowOffset() * texel();
    let sh  = textureSample(covTex, samp, in.uv - off);
    let rgb = sh.rgb / max(sh.a, 1e-5);
    return vec4<f32>(rgb, sh.a * shadowOpacity());
}
