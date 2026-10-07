// JFA contour seeds reconstructed from geometric coverage, not integer support
// boundaries. This is our SDF adapter, not a recovered Apple SDF generator.
@group(0) @binding(1) var shapeTex : texture_2d<f32>;

fn coverageAt(p: vec2<i32>) -> f32 {
    let dim = vec2<i32>(resolution());
    if (any(p < vec2<i32>(0)) || any(p >= dim)) { return 0.0; }
    return textureLoad(shapeTex, p, 0).a;
}

// Invert the area of a unit square cut by a locally straight edge. The edge
// distance follows Gustavson's EDTAA3 coverage model (see THIRD_PARTY_NOTICES).
// `normal` points towards increasing coverage; positive distance is outside.
fn coverageEdgeDistance(alpha: f32, normal: vec2<f32>) -> f32 {
    let axis = abs(normal);
    let major = max(axis.x, axis.y);
    let minor = min(axis.x, axis.y);
    if (minor < 1e-6) { return 0.5 - alpha; }
    let cornerArea = 0.5 * minor / major;
    let extent = 0.5 * (major + minor);
    let twiceAreaScale = 2.0 * major * minor;
    if (alpha < cornerArea) {
        return extent - sqrt(twiceAreaScale * alpha);
    }
    if (alpha > 1.0 - cornerArea) {
        return sqrt(twiceAreaScale * (1.0 - alpha)) - extent;
    }
    return (0.5 - alpha) * major;
}

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
    let ip = vec2<i32>(floor(in.pos.xy));
    let c = coverageAt(ip);
    let left = coverageAt(ip + vec2<i32>(-1, 0));
    let right = coverageAt(ip + vec2<i32>(1, 0));
    let top = coverageAt(ip + vec2<i32>(0, -1));
    let bottom = coverageAt(ip + vec2<i32>(0, 1));
    let partial = c > 0.0 && c < 1.0;
    // Full/empty texels adjacent to an AA texel must not seed a second,
    // displaced contour. Binary masks still need a half-pixel boundary.
    let low = min(min(left, right), min(top, bottom));
    let high = max(max(left, right), max(top, bottom));
    let hardEdge = (c == 1.0 && low == 0.0) || (c == 0.0 && high == 1.0);
    if (!partial && !hardEdge) { return vec4<f32>(-1.0, -1.0, 0.0, 0.0); }

    let tl = coverageAt(ip + vec2<i32>(-1, -1));
    let tr = coverageAt(ip + vec2<i32>(1, -1));
    let bl = coverageAt(ip + vec2<i32>(-1, 1));
    let br = coverageAt(ip + vec2<i32>(1, 1));
    let gradient = vec2<f32>(
        tr + br - tl - bl + 1.41421356237 * (right - left),
        bl + br - tl - tr + 1.41421356237 * (bottom - top),
    );
    var offset = vec2<f32>(0.0);
    if (dot(gradient, gradient) > 1e-12) {
        let normal = normalize(gradient);
        offset = normal * coverageEdgeDistance(c, normal);
    }
    // A symmetric subpixel feature has no reliable local normal. Keeping its
    // centre as a seed preserves coverage instead of deleting the feature.
    let tile = floor(vec2<f32>(ip) / CONTOUR_SEED_BLOCK);
    let withinTile = vec2<f32>(ip) - tile * CONTOUR_SEED_BLOCK + offset;
    return vec4<f32>(tile, withinTile);
}
