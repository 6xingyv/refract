// glow - gaussian halo OUTSIDE the shape, using the outside-distance (.g of sdfTex).
@group(0) @binding(1) var sdfTex : texture_2d<f32>;
@group(0) @binding(2) var samp   : sampler;

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
    let s  = textureSample(sdfTex, samp, in.uv);
    let od = s.g;                          // outside distance 0..1
    let g  = exp(-pow(od / max(glowRadius(), 1e-3), 2.0) * 4.0) * glowOn();
    let outside = 1.0 - s.a;               // only outside the shape
    return vec4<f32>(P.glassCol.rgb, g * outside);
}
