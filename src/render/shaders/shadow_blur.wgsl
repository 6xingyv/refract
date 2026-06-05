// shadow_blur - one axis of a separable Gaussian over premultiplied shadow RGBA.
// Run twice (blurDir = (1,0) then (0,1)) to get a smooth 2D blur with no banding.
// 33 taps span the full shadow radius (step = r/16), so even large radii stay
// continuous instead of breaking into concentric rings.
@group(0) @binding(1) var srcTex : texture_2d<f32>;
@group(0) @binding(2) var samp   : sampler;

const TAPS : i32 = 16;

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
    let r = shadowRadius();
    if (r <= 0.001) { return textureSample(srcTex, samp, in.uv); }

    // sample step in UV; full kernel covers +/- r pixels around the centre.
    let stepUv = blurDir() * texel() * (r / f32(TAPS));
    let sigma  = f32(TAPS) / 2.5;          // gaussian falloff in tap-index space
    var sum  = vec4<f32>(0.0);
    var wsum = 0.0;
    for (var i = -TAPS; i <= TAPS; i = i + 1) {
        let w = exp(-0.5 * f32(i) * f32(i) / (sigma * sigma));
        sum  = sum  + w * textureSample(srcTex, samp, in.uv + stepUv * f32(i));
        wsum = wsum + w;
    }
    return sum / wsum;
}
