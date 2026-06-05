// SimulatedGlass::distance_gradient - smoothed inside SDF + its gradient (surface normal).
// JFA produces a quantized nearest-seed field; smooth before the Sobel gradient so
// curved SVG/PNG edges do not turn into stepped specular bands.
//   out.r = inside sdf,  out.gb = normal,  out.a = coverage
@group(0) @binding(1) var sdfTex : texture_2d<f32>;
@group(0) @binding(2) var samp   : sampler;

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
    let t  = texel() * 1.5;   // wider step -> smoother normals (ignore JFA high-freq noise)
    let c  = textureSample(sdfTex, samp, in.uv);
    let tl = textureSample(sdfTex, samp, in.uv + vec2<f32>(-t.x, -t.y)).r;
    let tc = textureSample(sdfTex, samp, in.uv + vec2<f32>( 0.0, -t.y)).r;
    let tr = textureSample(sdfTex, samp, in.uv + vec2<f32>( t.x, -t.y)).r;
    let ml = textureSample(sdfTex, samp, in.uv + vec2<f32>(-t.x,  0.0)).r;
    let mr = textureSample(sdfTex, samp, in.uv + vec2<f32>( t.x,  0.0)).r;
    let bl = textureSample(sdfTex, samp, in.uv + vec2<f32>(-t.x,  t.y)).r;
    let bc = textureSample(sdfTex, samp, in.uv + vec2<f32>( 0.0,  t.y)).r;
    let br = textureSample(sdfTex, samp, in.uv + vec2<f32>( t.x,  t.y)).r;

    let smoothSdf = (tl + tr + bl + br + 2.0 * (tc + ml + mr + bc) + 4.0 * c.r) / 16.0;
    var g = vec2<f32>(
        (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl),
        (bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr),
    );
    var n = vec2<f32>(0.0, 0.0);
    if (any(g != vec2<f32>(0.0, 0.0))) { n = normalize(g); }
    return vec4<f32>(smoothSdf, n.x, n.y, c.a);
}
