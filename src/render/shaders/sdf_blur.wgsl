// sdf_blur - separable Gaussian of the inside-SDF (.r only). The JFA nearest-seed field has
// Voronoi ribbing along curved/thin shapes; taking the gradient of it directly turns the specular
// rim into a dashed "caterpillar". Smoothing the SDF first gives a clean, continuous normal.
// Coverage (.a) and the other channels are passed through SHARP so the AA edge stays crisp.
// Run twice: blurDir (1,0) then (0,1). Radius scales with resolution so it stays shape-relative.
@group(0) @binding(1) var srcTex : texture_2d<f32>;
@group(0) @binding(2) var samp   : sampler;

const TAPS : i32 = 10;

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
    let scale = max(resolution().x / 512.0, 1.0);
    let dir   = blurDir() * texel() * scale;
    let sigma = 3.5;
    var sumR : f32 = 0.0;
    var wsum : f32 = 0.0;
    for (var i = -TAPS; i <= TAPS; i = i + 1) {
        let w = exp(-0.5 * f32(i) * f32(i) / (sigma * sigma));
        sumR = sumR + w * textureSample(srcTex, samp, in.uv + dir * f32(i)).r;
        wsum = wsum + w;
    }
    let c = textureSample(srcTex, samp, in.uv);
    return vec4<f32>(sumR / wsum, c.g, c.b, c.a);    // smoothed SDF, original coverage
}
