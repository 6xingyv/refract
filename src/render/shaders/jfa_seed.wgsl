// JFA pass 1 - seed boundary texels with their own pixel coordinate.
@group(0) @binding(1) var shapeTex : texture_2d<f32>;

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
    let ip  = vec2<i32>(floor(in.pos.xy));
    let dim = vec2<i32>(resolution());
    let lo = vec2<i32>(0, 0);
    let hi = dim - vec2<i32>(1, 1);

    let c = textureLoad(shapeTex, ip, 0).a;
    let a0 = textureLoad(shapeTex, clamp(ip + vec2<i32>(-1, 0), lo, hi), 0).a;
    let a1 = textureLoad(shapeTex, clamp(ip + vec2<i32>(1, 0), lo, hi), 0).a;
    let a2 = textureLoad(shapeTex, clamp(ip + vec2<i32>(0, -1), lo, hi), 0).a;
    let a3 = textureLoad(shapeTex, clamp(ip + vec2<i32>(0, 1), lo, hi), 0).a;

    let partialCoverage = step(0.001, c) * step(c, 0.999);
    let neighborDelta = max(max(abs(a0 - c), abs(a1 - c)), max(abs(a2 - c), abs(a3 - c)));
    let boundary = max(partialCoverage, step(0.001, neighborDelta));
    let empty = 1.0 - boundary;
    return vec4<f32>(f32(ip.x) * boundary - empty, f32(ip.y) * boundary - empty, 0.0, boundary);
}
