// Conditioning for our quantized JFA normals, not an Apple material blur.
// A fixed one-pixel binomial kernel filters signed distance. Raw SDF and
// coverage remain separate, preserving thin geometry and bevel placement.
@group(0) @binding(1) var srcTex : texture_2d<f32>;
@group(0) @binding(2) var samp : sampler;

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
    let stepUv = blurDir() * texel();
    let c = textureSample(srcTex, samp, in.uv);
    let a = textureSample(srcTex, samp, in.uv - stepUv * 2.0);
    let b = textureSample(srcTex, samp, in.uv - stepUv);
    let d = textureSample(srcTex, samp, in.uv + stepUv);
    let e = textureSample(srcTex, samp, in.uv + stepUv * 2.0);
    let distanceValue = ((a.r - a.g) + 4.0 * (b.r - b.g) + 6.0 * (c.r - c.g)
        + 4.0 * (d.r - d.g) + (e.r - e.g)) / 16.0;
    return vec4<f32>(max(distanceValue, 0.0), max(-distanceValue, 0.0), 0.0, c.a);
}
