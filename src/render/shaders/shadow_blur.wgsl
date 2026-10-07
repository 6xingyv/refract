// CPU-built RenderBox sample pairs; input/output are premultiplied RGBA.
@group(0) @binding(1) var srcTex : texture_2d<f32>;
@group(0) @binding(2) var samp : sampler;

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
    if (shadowSigma() <= 0.0) { return textureSample(srcTex, samp, in.uv); }
    return pairedGaussianBlur(srcTex, samp, in.uv);
}
