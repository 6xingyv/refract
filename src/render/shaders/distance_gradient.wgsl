// iOS 26.4 uses four central-difference samples, one pixel apart. Our field
// reads split positive/negative distances in R/G and outputs signed distance in
// R, inward normals in GB and coverage in A. Apple encodes distance and normals.
@group(0) @binding(1) var sdfTex : texture_2d<f32>;
@group(0) @binding(2) var normalSdfTex : texture_2d<f32>;
@group(0) @binding(3) var samp : sampler;

fn signedDistance(uv: vec2<f32>) -> f32 {
    let field = textureSample(normalSdfTex, samp, uv);
    return field.r - field.g;
}

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
    let t = texel();
    let raw = textureSample(sdfTex, samp, in.uv);
    let g = vec2<f32>(
        signedDistance(in.uv + vec2<f32>(t.x, 0.0)) - signedDistance(in.uv - vec2<f32>(t.x, 0.0)),
        signedDistance(in.uv + vec2<f32>(0.0, t.y)) - signedDistance(in.uv - vec2<f32>(0.0, t.y)),
    );
    // Our quantized JFA field needs conditioning before Apple's central
    // differences. At medial axes, do not amplify a near-zero gradient into
    // opposite unit normals on adjacent pixels. A true SDF has gradient 1.
    let expectedGradient = 2.0 / max(sdfRange(), 1.0);
    let n = g / max(length(g), expectedGradient);
    // Retain negative distance at AA texels outside the 50% contour. Clamping
    // it to zero makes fwidth see a plateau and misplaces the highlight edge.
    return vec4<f32>(raw.r - raw.g, n.x, n.y, raw.a);
}
