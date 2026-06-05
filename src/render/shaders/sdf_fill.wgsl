// Port of sdfFill - anti-aliased SDF fill via smoothstep across the ~1px boundary.
@group(0) @binding(1) var sdfTex : texture_2d<f32>;
@group(0) @binding(2) var samp   : sampler;

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
    let sdf = textureSample(sdfTex, samp, in.uv).r;
    let v   = sdf * fillScale() + fillBias();

    let aa  = clamp(fwidth(v), 0.000977, 2.0);
    let tt  = clamp((v + aa * 0.41650) / (aa * 0.83301), 0.0, 1.0);
    let cov = tt * tt * (3.0 - 2.0 * tt);            // smoothstep

    return P.color * cov;
}
