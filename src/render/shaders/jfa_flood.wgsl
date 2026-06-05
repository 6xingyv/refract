// JFA flood pass - propagate nearest boundary seed at the current step distance.
// Driver invokes this log2(maxDim) times, halving jfaStep each time, ping-ponging targets.
@group(0) @binding(1) var seedTex : texture_2d<f32>;

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
    let ip   = vec2<i32>(floor(in.pos.xy));
    let dim  = vec2<i32>(resolution());
    let step = i32(jfaStep());
    let p    = vec2<f32>(ip);

    var best  = textureLoad(seedTex, ip, 0);
    var bestD = 1e20;
    if (best.w > 0.5) { bestD = distance(p, best.xy); }

    for (var dy = -1; dy <= 1; dy = dy + 1) {
        for (var dx = -1; dx <= 1; dx = dx + 1) {
            let np = clamp(ip + vec2<i32>(dx, dy) * step, vec2<i32>(0,0), dim - vec2<i32>(1,1));
            let s  = textureLoad(seedTex, np, 0);
            if (s.w > 0.5) {
                let d = distance(p, s.xy);
                if (d < bestD) { bestD = d; best = s; }
            }
        }
    }
    return best;
}
