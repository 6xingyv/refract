// SimulatedGlass::distance_gradient - raw inside SDF + smoothed gradient (surface normal).
// JFA produces a quantized nearest-seed field; smooth before the Sobel gradient so
// curved SVG/PNG edges do not turn into stepped specular bands.
// Keep out.r raw so straight corners and sharp tips do not get rounded by the normal smoothing.
//   out.r = raw inside sdf,  out.gb = smoothed normal,  out.a = coverage
@group(0) @binding(1) var rawSdfTex    : texture_2d<f32>;
@group(0) @binding(2) var smoothSdfTex : texture_2d<f32>;
@group(0) @binding(3) var samp         : sampler;

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
    let t  = texel() * 1.5;   // wider step -> smoother normals (ignore JFA high-freq noise)
    let raw = textureSample(rawSdfTex, samp, in.uv);
    let tl = textureSample(smoothSdfTex, samp, in.uv + vec2<f32>(-t.x, -t.y)).r;
    let tc = textureSample(smoothSdfTex, samp, in.uv + vec2<f32>( 0.0, -t.y)).r;
    let tr = textureSample(smoothSdfTex, samp, in.uv + vec2<f32>( t.x, -t.y)).r;
    let ml = textureSample(smoothSdfTex, samp, in.uv + vec2<f32>(-t.x,  0.0)).r;
    let mr = textureSample(smoothSdfTex, samp, in.uv + vec2<f32>( t.x,  0.0)).r;
    let bl = textureSample(smoothSdfTex, samp, in.uv + vec2<f32>(-t.x,  t.y)).r;
    let bc = textureSample(smoothSdfTex, samp, in.uv + vec2<f32>( 0.0,  t.y)).r;
    let br = textureSample(smoothSdfTex, samp, in.uv + vec2<f32>( t.x,  t.y)).r;

    var g = vec2<f32>(
        (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl),
        (bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr),
    );
    var n = vec2<f32>(0.0, 0.0);
    if (any(g != vec2<f32>(0.0, 0.0))) { n = normalize(g); }
    return vec4<f32>(raw.r, n.x, n.y, raw.a);
}
