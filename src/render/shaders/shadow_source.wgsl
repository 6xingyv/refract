// shadow_source - coverage plus shadow colour. For layer-color shadows, each
// covered texel uses the nearest boundary pixel colour before the blur pass.
@group(0) @binding(1) var seedTex  : texture_2d<f32>;
@group(0) @binding(2) var shapeTex : texture_2d<f32>;
@group(0) @binding(3) var sdfTex   : texture_2d<f32>;

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
    let ip = vec2<i32>(floor(in.pos.xy));
    let dim = vec2<i32>(resolution());
    let cov = textureLoad(sdfTex, ip, 0).a;
    let seed = textureLoad(seedTex, ip, 0);

    var edgeRgb = P.shadowCol.rgb;
    if (seed.w > 0.5) {
        let seedIp = clamp(vec2<i32>(round(seed.xy)), vec2<i32>(0, 0), dim - vec2<i32>(1, 1));
        let edge = textureLoad(shapeTex, seedIp, 0);
        edgeRgb = mix(P.glassCol.rgb, edge.rgb, assetColorOn());
    }

    let rgb = mix(P.shadowCol.rgb, edgeRgb, layerColorShadowOn());
    return vec4<f32>(rgb * cov, cov);
}
