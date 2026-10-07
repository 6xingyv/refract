// Blur the actual source color/opacity. Nearest JFA seeds may be outside
// artwork and have zero alpha; using their color creates black seams/halos.
@group(0) @binding(1) var shapeTex : texture_2d<f32>;
@group(0) @binding(2) var colorTex : texture_2d<f32>;

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
    let ip = vec2<i32>(floor(in.pos.xy));
    let cov = textureLoad(shapeTex, ip, 0).a;
    let src = textureLoad(colorTex, ip, 0);
    let alpha = mix(cov, src.a, assetColorOn());
    let sourceRgb = mix(P.glassCol.rgb, src.rgb / max(src.a, 1e-6), assetColorOn());
    let rgb = mix(P.shadowCol.rgb, appearanceRgb(sourceRgb), layerColorShadowOn());
    return vec4<f32>(rgb * alpha, alpha);
}
