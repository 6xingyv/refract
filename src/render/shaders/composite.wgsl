// Final composite: shadow (under) -> glass refraction -> color -> additive highlight,
// then the appearance transform. Output is straight-alpha, transparent outside;
// the Compositor stacks it over the icon background.
@group(0) @binding(1) var shadowTex    : texture_2d<f32>;
@group(0) @binding(2) var glassTex     : texture_2d<f32>;
@group(0) @binding(3) var fillTex      : texture_2d<f32>;
@group(0) @binding(4) var highlightTex : texture_2d<f32>;
@group(0) @binding(5) var samp         : sampler;

fn over(a : vec4<f32>, b : vec4<f32>) -> vec4<f32> {
    let o = a.a + b.a * (1.0 - a.a);
    let rgb = (a.rgb * a.a + b.rgb * b.a * (1.0 - a.a)) / max(o, 1e-6);
    return vec4<f32>(rgb, o);
}

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
    let sh    = textureSample(shadowTex, samp, in.uv);
    let glass = textureSample(glassTex, samp, in.uv);
    let fill  = textureSample(fillTex, samp, in.uv);
    let hl    = textureSample(highlightTex, samp, in.uv);

    var col = sh;
    col = over(glass, col);
    col = over(fill, col);
    // additive specular highlight
    col = vec4<f32>(col.rgb + hl.rgb, col.a);

    if (exportAlphaMode() > 0.5 && glassOn() > 0.5) {
        // For layered PNG export the refracted background is represented by
        // the separate background image. Keep only the glass material density
        // here instead of treating sampled background pixels as opaque.
        col.a = max(sh.a, glass.a);
    }

    let ap = appearance();
    let luma = dot(col.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
    if (ap >= 4.5) {
        // Clear
        col = vec4<f32>(col.rgb, col.a * 0.6);
    } else if (ap >= 3.5) {
        // Tinted
        col = vec4<f32>(mix(col.rgb, vec3<f32>(luma) * P.tint.rgb * 2.0, P.tint.a), col.a);
    } else if (ap >= 2.5) {
        // Mono
        col = vec4<f32>(vec3<f32>(luma), col.a);
    }
    return col;
}
