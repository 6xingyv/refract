// The container uses its own key/fill/rim profiles, not glyph widths and not
// a screen-position gradient. Pass-specific packing is in highlightParameters.
// Light routing/receiver composition is a preview adapter; AIR supplies the
// lobe arithmetic and ICRRenderingParameters supplies the profile defaults.
@group(0) @binding(1) var dgTex : texture_2d<f32>;
@group(0) @binding(2) var receiverTex : texture_2d<f32>;
@group(0) @binding(3) var samp : sampler;

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    let dg = textureSample(dgTex, samp, in.uv);
    let bg = textureSample(receiverTex, samp, in.uv);
    let distancePx = dg.r * sdfRange();
    var lobes = array<vec4<f32>, 3>(P.glassCol, P.tint, P.shadowCol);
    var lights = array<vec4<f32>, 2>(P.shadowGeo, P.flags);
    var brightness = array<f32, 3>(P.shapeBounds.x, P.shapeBounds.y, P.shapeBounds.z);
    var rgb = bg.rgb;
    for (var l = 0u; l < 2u; l = l + 1u) {
        for (var k = 0u; k < 3u; k = k + 1u) {
            let p = lobes[k];
            let light = lights[l];
            let direction = select(light.xy, -light.xy, k == 1u);
            let strength = glassHighlightStrength(distancePx, dg.gb, p.x, p.z,
                p.y, direction, light.z, P._r11.x);
            let amount = clamp(strength * p.w * light.w * dg.a, 0.0, 1.0);
            // Source-atop keeps the receiver's existing antialiased coverage.
            rgb = mix(rgb, vec3<f32>(brightness[k] * bg.a), amount);
        }
    }
    return vec4<f32>(rgb / max(bg.a, 1e-6), bg.a);
}
