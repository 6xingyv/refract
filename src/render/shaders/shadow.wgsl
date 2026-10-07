// shadow - resolve: take the separably-blurred premultiplied shadow source,
// shift it by the shadow offset, and return straight-alpha colour.
@group(0) @binding(1) var covTex : texture_2d<f32>;
@group(0) @binding(2) var samp   : sampler;

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
    let off = shadowOffset() * texel();
    let uv = in.uv - off;
    // A shifted shadow has no source beyond the icon canvas. Clamp-to-edge
    // sampling alone would extend an opaque edge into a solid shadow stripe.
    let sh = textureSample(covTex, samp, uv) * select(0.0, 1.0, all(uv >= vec2<f32>(0.0)) && all(uv <= vec2<f32>(1.0)));
    let rgb = sh.rgb / max(sh.a, 1e-5);
    // Draw opacity is applied after the receiver-dependent blend. Folding it
    // into this alpha changes plusDarker on partially transparent receivers.
    return vec4<f32>(rgb, sh.a);
}
