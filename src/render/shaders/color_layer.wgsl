// Color layer above glass refraction. The outer edge keeps the source colour;
// translucency linearly controls the bottom alpha while leaving the top alpha intact.
@group(0) @binding(1) var dgTex    : texture_2d<f32>;
@group(0) @binding(2) var colorTex : texture_2d<f32>;
@group(0) @binding(3) var samp     : sampler;

fn boostSaturation(rgb : vec3<f32>, amount : f32) -> vec3<f32> {
    let luma = dot(rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
    return clamp(mix(vec3<f32>(luma), rgb, amount), vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
    let dg = textureSample(dgTex, samp, in.uv);
    let src = textureSample(colorTex, samp, in.uv);
    let cov = src.a;
    var rgb = boostSaturation(mix(P.glassCol.rgb, src.rgb, assetColorOn()), 1.14);
    let layerAlpha = mix(P.glassCol.a, 1.0, assetColorOn());

    let sdf = dg.r;
    let aaWidth = clamp(fwidth(sdf), 0.0005, 2.0);
    let edgeInset = height() * 0.14;
    let lightEnd = height() * 0.46;
    let denseStart = height() * 0.42;
    let denseEnd = height() * 1.10;

    let insetGate = smoothstep(edgeInset - aaWidth, edgeInset + aaWidth, sdf);
    let lightBand = insetGate * (1.0 - smoothstep(lightEnd - aaWidth, lightEnd + aaWidth, sdf));
    let denseBand = smoothstep(denseStart - aaWidth, denseEnd + aaWidth, sdf);

    let ndotl = dot(lightDir(), dg.gb);
    let light = clamp((ndotl - spread()) / max(1.0 - spread(), 0.001), 0.0, 1.0) * specularOn();
    rgb = boostSaturation(rgb, 1.0 + denseBand * 0.10);

    let translucentPct = clamp(translucency(), 0.0, 1.0);
    let bottomAlpha = 1.0 - translucentPct;
    let shapeHeight = max(shapeBottom() - shapeTop(), texel().y);
    let shapeY = clamp((in.uv.y - shapeTop()) / shapeHeight, 0.0, 1.0);
    let trans = mix(1.0, bottomAlpha, shapeY);
    let lightAlpha = 1.0 - lightBand * light * 0.22;
    let denseAlpha = 1.0 + denseBand * 0.20;
    return vec4<f32>(rgb, clamp(cov * layerAlpha * trans * lightAlpha * denseAlpha, 0.0, 1.0));
}
