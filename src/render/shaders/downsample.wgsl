// Reduce by about 2x. Linear filtering at the reduced pixel centre averages
// the source 2x2 footprint; all inputs/outputs are premultiplied RGBA.
@group(0) @binding(1) var srcTex : texture_2d<f32>;
@group(0) @binding(2) var samp : sampler;

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
    return textureSample(srcTex, samp, in.uv);
}
