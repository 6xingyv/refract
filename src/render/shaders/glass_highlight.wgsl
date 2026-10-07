// iOS 26.4 glassHighlight kernel, using independent static/dynamic glyph lobes.
// Inward normal + incoming light equals outward normal + direction to source.
// Glyph inset is independent of width; container highlights use their own zero inset.
@group(0) @binding(1) var dgTex : texture_2d<f32>;
@group(0) @binding(2) var samp : sampler;

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
    let dg = textureSample(dgTex, samp, in.uv);
    let d = dg.r * sdfRange();
    let coverage = specularOn() * dg.a * P.specColor.a;
    let staticLight = glassHighlightStrength(d, dg.gb, P.tint.x, P.materialExtra.x, P.tint.w,
        vec2<f32>(1.0, 0.0), 1.0, P.tint.z) * P.shadowCol.w * coverage;
    let dynamicLight = glassHighlightStrength(d, dg.gb, P.tint.y, P.materialExtra.x, P.tint.w,
        lightDir(), biasAmount(), P.tint.z) * P.shadowGeo.w * coverage;
    // Additive, premultiplied RGB; composite converts back to straight alpha.
    return vec4<f32>(P.specColor.rgb * (staticLight + dynamicLight),
        staticLight + dynamicLight * (1.0 - staticLight));
}
