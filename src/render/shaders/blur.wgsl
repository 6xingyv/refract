// Separable gaussian blur of the background (BlurMaterial / frosted glass).
// Driver runs it twice: blurDir=(1,0) then (0,1). blurRadius in px.
// 33 taps (step = r/16) so even a large frosted radius stays smooth instead of banding.
@group(0) @binding(1) var srcTex : texture_2d<f32>;
@group(0) @binding(2) var samp   : sampler;

const TAPS : i32 = 16;

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
    let r = blurRadius();
    if (r <= 0.0) { return textureSample(srcTex, samp, in.uv); }
    let step  = blurDir() * texel() * (r / f32(TAPS));
    let sigma = f32(TAPS) / 2.5;
    var sum  = vec4<f32>(0.0);
    var wsum = 0.0;
    for (var i = -TAPS; i <= TAPS; i = i + 1) {
        let w = exp(-0.5 * f32(i) * f32(i) / (sigma * sigma));
        sum  = sum  + w * textureSample(srcTex, samp, in.uv + step * f32(i));
        wsum = wsum + w;
    }
    return sum / wsum;
}
