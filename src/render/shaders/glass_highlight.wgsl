// glassHighlight - beveled specular rim. Output is an additive white highlight
// (rgb=a=intensity). Uses fwidth() for the AA edge. dgTex = distance_gradient.
@group(0) @binding(1) var dgTex : texture_2d<f32>;
@group(0) @binding(2) var samp  : sampler;

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
let dg     = textureSample(dgTex, samp, in.uv);
   let sdf    = dg.r;
   let normal = dg.gb;

   let edgeInset = height() * 0.6;
   let band      = edgeInset + height();
   let aaWidth   = clamp(fwidth(sdf), 0.0005, 2.0) * 0.83301;
   let insetCov  = smoothstep(edgeInset - aaWidth, edgeInset + aaWidth, sdf);
   let bandCov   = 1.0 - smoothstep(band - aaWidth, band + aaWidth, sdf);
   let coverage  = insetCov * bandCov * dg.a;

   let up        = clamp((sdf - edgeInset) / max(band - edgeInset, 1e-3), 0.0, 1.0);
   let curveTerm = mix(1.0, (1.0 - up) * (1.0 - up), curvature());

   // ===== 双光源系统 =====
   let lightDirMain  = lightDir();           // 主光方向
   let lightDirFill  = -lightDirMain;        // 补光方向（反向）
   
   // 主光强度（正向）
   let ndotlMain = dot(normal, lightDirMain);
   let lightMain = clamp((ndotlMain - spread()) / max(1.0 - spread(), 0.001), 0.0, 0.6);
   
   // 补光强度（反向）—— 照亮背光面
   let ndotlFill = dot(normal, lightDirFill);
   let lightFill = clamp((ndotlFill - spread()) / max(1.0 - spread(), 0.001), 0.0, 0.3) *  0.4;
   
   // 合并光源（添加式混合）
   let lightTotal = lightMain + lightFill;
   
   let biasDen = max(1.0 + (1.0 - lightTotal) * biasAmount(), 0.001);
   
   // 保持原有柔和度，但用总光照计算
   let v = 0.7 * curveTerm * coverage * lightTotal / biasDen * specularOn();
   return vec4<f32>(v, v, v, v);
}
