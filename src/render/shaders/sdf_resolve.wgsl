// JFA resolve -> NORMALISED distance field.
//   .r = inside distance  (0 at edge -> ~1 over sdfRange px inward)
//   .g = outside distance (0 at edge -> ~1 over sdfRange px outward, for glow)
//   .a = coverage (1 inside, 0 outside)
@group(0) @binding(1) var seedTex  : texture_2d<f32>;
@group(0) @binding(2) var shapeTex : texture_2d<f32>;

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
    let ip  = vec2<i32>(floor(in.pos.xy));
    let cov = textureLoad(shapeTex, ip, 0).a;   // anti-aliased coverage
    let inside = cov > 0.0;
    let s = textureLoad(seedTex, ip, 0);
    var dist = 0.0;
    if (s.w > 0.5) { dist = distance(vec2<f32>(ip), s.xy); }

    let n = clamp(dist / max(sdfRange(), 1.0), 0.0, 1.0);
    if (inside) { return vec4<f32>(n, 0.0, 0.0, cov); }
    return vec4<f32>(0.0, n, 0.0, cov);
}
