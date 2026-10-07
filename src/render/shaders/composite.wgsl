// Final composite: shadow (under) -> glass refraction -> color -> additive highlight,
// Appearance RGB transforms happen in material passes. Scene output includes
// the receiver; isolated output retains the legacy shadow stacking fallback.
@group(0) @binding(1) var shadowTex    : texture_2d<f32>;
@group(0) @binding(2) var glassTex     : texture_2d<f32>;
@group(0) @binding(3) var fillTex      : texture_2d<f32>;
@group(0) @binding(4) var highlightTex : texture_2d<f32>;
@group(0) @binding(5) var dgTex        : texture_2d<f32>;
@group(0) @binding(6) var receiverTex  : texture_2d<f32>;
@group(0) @binding(7) var samp         : sampler;

fn over(a : vec4<f32>, b : vec4<f32>) -> vec4<f32> {
    let o = a.a + b.a * (1.0 - a.a);
    let rgb = (a.rgb * a.a + b.rgb * b.a * (1.0 - a.a)) / max(o, 1e-6);
    return vec4<f32>(rgb, o);
}

// Separable modes use W3C Compositing Level 1 straight-color arithmetic.
// plusDarker follows RenderBox's premultiplied alpha-excess subtraction.
fn blendChannel(back: f32, source: f32, mode: u32) -> f32 {
    switch mode {
        case 3u: { return back * source; }
        case 4u: { return back + source - back * source; }
        case 5u: { return select(2.0 * back * source, 1.0 - 2.0 * (1.0 - back) * (1.0 - source), back > 0.5); }
        case 6u: {
            let curve = select(((16.0 * back - 12.0) * back + 4.0) * back, sqrt(max(back, 0.0)), back > 0.25);
            return select(back - (1.0 - 2.0 * source) * back * (1.0 - back), back + (2.0 * source - 1.0) * (curve - back), source > 0.5);
        }
        case 7u: { return select(2.0 * back * source, 1.0 - 2.0 * (1.0 - back) * (1.0 - source), source > 0.5); }
        case 8u: { return min(back, source); }
        case 9u: { return max(back, source); }
        default: { return source; }
    }
}
fn coatingOver(source: vec4<f32>, back: vec4<f32>) -> vec4<f32> {
    let mode = u32(P.materialExtra.y);
    if (mode == 1u || mode == 2u) {
        let alpha = min(1.0, source.a + back.a);
        let sum = source.rgb * source.a + back.rgb * back.a;
        let rgb = select(min(sum, vec3<f32>(alpha)), max(vec3<f32>(0.0), sum + vec3<f32>(alpha - source.a - back.a)), mode == 2u);
        return vec4<f32>(rgb / max(alpha, 1e-6), alpha);
    }
    let blended = vec3<f32>(blendChannel(back.r, source.r, mode), blendChannel(back.g, source.g, mode), blendChannel(back.b, source.b, mode));
    return over(vec4<f32>(mix(source.rgb, blended, back.a), source.a), back);
}

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
    var sh    = textureSample(shadowTex, samp, in.uv);
    let glass = textureSample(glassTex, samp, in.uv);
    let fill  = textureSample(fillTex, samp, in.uv);
    var hl    = textureSample(highlightTex, samp, in.uv);
    let cov   = textureSample(dgTex, samp, in.uv).a;

    // Blend the coating with the blurred/refracted surface, then apply geometry
    // once. Blending a receiver-containing overlay with the sharp scene again
    // reintroduces unblurred detail (e.g. AppStore's hard-light glass groups).
    var material = coatingOver(fill, glass);
    material.a = material.a * cov;
    var under = sh;
    if (sceneOutput() > 0.5) {
        // RenderBox rb_blend_mode maps CG plusDarker (26) to shader mode 44.
        // composite_color adds premultiplied colors, caps the summed alpha,
        // and subtracts the alpha excess from RGB. Draw opacity then mixes
        // this result with the receiver (iOS 26.4 alpha_effect_fragment AIR).
        let bg = textureSample(receiverTex, samp, in.uv); // premultiplied
        let alpha = min(1.0, bg.a + sh.a);
        let darkened = vec4<f32>(bg.rgb + sh.rgb * sh.a + vec3<f32>(alpha - bg.a - sh.a), alpha);
        let shaded = mix(bg, darkened, shadowOpacity() * itemOpacity());
        under = vec4<f32>(shaded.rgb / max(shaded.a, 1e-6), shaded.a);
        material.a = material.a * itemOpacity();
        hl = hl * itemOpacity();
    } else {
        under.a = under.a * shadowOpacity();
    }
    var col = over(material, under);
    // Add in premultiplied space so partially transparent rims retain intensity.
    // The union of coverage also permits highlights over a transparent backdrop.
    let alpha = col.a + hl.a * (1.0 - col.a);
    col = vec4<f32>((col.rgb * col.a + hl.rgb) / max(alpha, 1e-6), alpha);
    return col;
}
