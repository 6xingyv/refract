import { UNIFORM_VEC4_COUNT, GLYPH_INSET_SLOT, COATING_BLEND_SLOT } from "./uniformLayout";

export const GLSL_VERTEX = `#version 300 es
precision highp float;
precision highp int;

out vec2 vUv;

void main() {
  int vid = gl_VertexID;
  float x = float((vid << 1) & 2);
  float y = float(vid & 2);
  gl_Position = vec4(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
  vUv = vec2(x, 1.0 - y);
}
`;

const PRELUDE = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

in vec2 vUv;
out vec4 outColor;

uniform vec4 P[${UNIFORM_VEC4_COUNT}];

vec2 resolution() { return P[0].xy; }
vec2 texel() { return P[0].zw; }
float sdfRange() { return P[1].x; }
float height() { return P[1].y; }
float refractScale() { return P[1].z; }
float curvature() { return P[1].w; }
vec2 lightDir() { return P[2].xy; }
float spread() { return P[2].z; }
float biasAmount() { return P[2].w; }
float glowRadius() { return P[3].x; }
float blurSigma() { return P[3].y; }
float shadowSigma() { return P[3].z; }
float shadowOpacity() { return P[3].w; }
float jfaStep() { return P[4].x; }
vec2 blurDir() { return P[4].yz; }
float appearance() { return P[4].w; }
vec4 glassCol() { return P[5]; }
vec4 tint() { return P[6]; }
vec4 shadowCol() { return P[7]; }
vec2 shadowOffset() { return P[8].xy; }
float specularOn() { return P[8].z; }
// Unregistered legacy glow pass alias; active passes use dynamic highlight opacity.
float glowOn() { return P[8].w; }
float glassOn() { return P[9].x; }
float translucency() { return P[9].y; }
float assetColorOn() { return P[9].z; }
float layerColorShadowOn() { return P[9].w; }
float shapeTop() { return P[10].x; }
float shapeBottom() { return P[10].y; }
float exportAlphaMode() { return P[11].x; }
float sceneOutput() { return P[11].y; }
float itemOpacity() { return P[11].z; }
float translucentBorder() { return P[11].w; }
float glyphInset() { return P[${Math.floor(GLYPH_INSET_SLOT / 4)}].x; }
float coatingBlend() { return P[${Math.floor(COATING_BLEND_SLOT / 4)}].y; }

// Keep the packed half-float contour representation identical to WGSL.
const float CONTOUR_SEED_BLOCK = 16.0;
vec2 contourSeedPosition(vec4 seed) { return seed.xy * CONTOUR_SEED_BLOCK + seed.zw; }

// Keep arithmetic and the 18-vec4 ABI in sync with common.wgsl.inc.
vec3 appearanceRgb(vec3 rgb) {
  return vec3(dot(rgb, P[13].xyz), dot(rgb, P[14].xyz), dot(rgb, P[15].xyz)) + P[16].xyz;
}

float materialMask(vec2 uv, float distance) {
  float gradient = clamp((uv.y - shapeTop()) / max(shapeBottom() - shapeTop(), texel().y), 0.0, 1.0);
  float interior = clamp(distance / max(translucentBorder(), 1e-6), 0.0, 1.0);
  float innerOpacity = mix(1.0, 0.0, gradient);
  float contourOpacity = mix(0.2, 0.61, gradient);
  float opacity = clamp(mix(1.0, mix(contourOpacity, innerOpacity, interior), translucency()), 0.0, 1.0);
  float smoothed = opacity * opacity * (3.0 - 2.0 * opacity);
  float aa = clamp(fwidth(interior), 0.0009765625, 2.0) * 0.8330078125;
  return mix(1.0, smoothed, clamp(interior / aa + 0.5, 0.0, 1.0));
}

float glassHighlightStrength(float distancePx, vec2 normal, float widthPx,
                             float insetPx, float angularSpread, vec2 direction,
                             float bias, float curveAmount) {
  float d = distancePx - insetPx;
  float aa = clamp(fwidth(d), 0.0009765625, 2.0) * 0.8330078125;
  float coverage = clamp((widthPx - d) / aa + 0.5, 0.0, 1.0)
    * clamp(d / aa + 0.5, 0.0, 1.0);
  float up = clamp(d / max(widthPx, 1e-6), 0.0, 1.0);
  float curve = mix(1.0, 1.0 - up, curveAmount);
  float light = clamp((dot(normal, direction) - angularSpread) / max(1.0 - angularSpread, 0.0009765625), 0.0, 1.0);
  float divisor = max(1.0 + (1.0 - light) * bias, 0.0009765625);
  return widthPx > 0.0 ? curve * coverage * light / divisor : 0.0;
}

ivec2 fragCoordTopLeft() {
  ivec2 p = ivec2(floor(gl_FragCoord.xy));
  int h = int(resolution().y);
  return ivec2(p.x, h - 1 - p.y);
}

vec4 loadTop(sampler2D tex, ivec2 p) {
  ivec2 dim = ivec2(resolution());
  ivec2 clamped = clamp(p, ivec2(0, 0), dim - ivec2(1, 1));
  ivec2 glp = ivec2(clamped.x, dim.y - 1 - clamped.y);
  return texelFetch(tex, glp, 0);
}

vec4 sampleTop(sampler2D tex, vec2 uv) {
  return texture(tex, vec2(uv.x, 1.0 - uv.y));
}

// Blur passes alone pack weights in P[5..6] and offsets in P[7..8].
vec4 pairedGaussianBlur(sampler2D source, vec2 uv) {
  float weights[8] = float[8](P[5].x, P[5].y, P[5].z, P[5].w, P[6].x, P[6].y, P[6].z, P[6].w);
  float offsets[8] = float[8](P[7].x, P[7].y, P[7].z, P[7].w, P[8].x, P[8].y, P[8].z, P[8].w);
  vec2 stepUv = blurDir() * texel();
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 8; i++) {
    if (weights[i] > 0.0) {
      vec2 offset = stepUv * offsets[i];
      sum += weights[i] * (sampleTop(source, uv - offset) + sampleTop(source, uv + offset));
    }
  }
  return sum;
}
`;

export const GLSL_FRAGMENT: Record<string, string> = {
  downsample: PRELUDE + `
uniform sampler2D uTex1;
void main() { outColor = sampleTop(uTex1, vUv); }
`,
  jfa_seed: PRELUDE + `
uniform sampler2D uTex1;

// EDTAA3 edge coverage model; see THIRD_PARTY_NOTICES.
float coverageAt(ivec2 p) {
  ivec2 dim = ivec2(resolution());
  if (any(lessThan(p, ivec2(0))) || any(greaterThanEqual(p, dim))) return 0.0;
  return loadTop(uTex1, p).a;
}

float coverageEdgeDistance(float alpha, vec2 normal) {
  vec2 axis = abs(normal);
  float major = max(axis.x, axis.y);
  float minor = min(axis.x, axis.y);
  if (minor < 1e-6) return 0.5 - alpha;
  float cornerArea = 0.5 * minor / major;
  float extent = 0.5 * (major + minor);
  float twiceAreaScale = 2.0 * major * minor;
  if (alpha < cornerArea) return extent - sqrt(twiceAreaScale * alpha);
  if (alpha > 1.0 - cornerArea) return sqrt(twiceAreaScale * (1.0 - alpha)) - extent;
  return (0.5 - alpha) * major;
}

void main() {
  ivec2 ip = fragCoordTopLeft();
  float c = coverageAt(ip);
  float left = coverageAt(ip + ivec2(-1, 0));
  float right = coverageAt(ip + ivec2(1, 0));
  float top = coverageAt(ip + ivec2(0, -1));
  float bottom = coverageAt(ip + ivec2(0, 1));
  bool partial = c > 0.0 && c < 1.0;
  float low = min(min(left, right), min(top, bottom));
  float high = max(max(left, right), max(top, bottom));
  bool hardEdge = (c == 1.0 && low == 0.0) || (c == 0.0 && high == 1.0);
  if (!partial && !hardEdge) { outColor = vec4(-1.0, -1.0, 0.0, 0.0); return; }

  float tl = coverageAt(ip + ivec2(-1, -1));
  float tr = coverageAt(ip + ivec2(1, -1));
  float bl = coverageAt(ip + ivec2(-1, 1));
  float br = coverageAt(ip + ivec2(1, 1));
  vec2 gradient = vec2(tr + br - tl - bl + 1.41421356237 * (right - left),
                       bl + br - tl - tr + 1.41421356237 * (bottom - top));
  vec2 offset = vec2(0.0);
  if (dot(gradient, gradient) > 1e-12) {
    vec2 normal = normalize(gradient);
    offset = normal * coverageEdgeDistance(c, normal);
  }
  vec2 tile = floor(vec2(ip) / CONTOUR_SEED_BLOCK);
  vec2 withinTile = vec2(ip) - tile * CONTOUR_SEED_BLOCK + offset;
  outColor = vec4(tile, withinTile);
}
`,

  jfa_flood: PRELUDE + `
uniform sampler2D uTex1;

void main() {
  ivec2 ip = fragCoordTopLeft();
  ivec2 dim = ivec2(resolution());
  int stepPx = int(jfaStep());
  vec2 p = vec2(ip);

  vec4 best = loadTop(uTex1, ip);
  float bestD = 1e20;
  if (best.x >= 0.0) {
    vec2 delta = p - contourSeedPosition(best);
    bestD = dot(delta, delta);
  }

  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      ivec2 np = clamp(ip + ivec2(dx, dy) * stepPx, ivec2(0, 0), dim - ivec2(1, 1));
      vec4 s = loadTop(uTex1, np);
      if (s.x >= 0.0) {
        vec2 delta = p - contourSeedPosition(s);
        float d = dot(delta, delta);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
    }
  }
  outColor = best;
}
`,

  sdf_resolve: PRELUDE + `
uniform sampler2D uTex1;
uniform sampler2D uTex2;

void main() {
  ivec2 ip = fragCoordTopLeft();
  float cov = loadTop(uTex2, ip).a;
  bool inside = cov >= 0.5;
  vec4 s = loadTop(uTex1, ip);
  float distPx = sdfRange();
  if (s.x >= 0.0) {
    distPx = distance(vec2(ip), contourSeedPosition(s));
  }

  float n = clamp(distPx / max(sdfRange(), 1.0), 0.0, 1.0);
  if (inside) {
    outColor = vec4(n, 0.0, 0.0, cov);
  } else {
    outColor = vec4(0.0, n, 0.0, cov);
  }
}
`,

  sdf_blur: PRELUDE + `
uniform sampler2D uTex1;

void main() {
  vec2 stepUv = blurDir() * texel();
  vec4 c = sampleTop(uTex1, vUv);
  vec4 a = sampleTop(uTex1, vUv - stepUv * 2.0);
  vec4 b = sampleTop(uTex1, vUv - stepUv);
  vec4 d = sampleTop(uTex1, vUv + stepUv);
  vec4 e = sampleTop(uTex1, vUv + stepUv * 2.0);
  float signedValue = ((a.r-a.g) + 4.0*(b.r-b.g) + 6.0*(c.r-c.g) + 4.0*(d.r-d.g) + (e.r-e.g)) / 16.0;
  outColor = vec4(max(signedValue, 0.0), max(-signedValue, 0.0), 0.0, c.a);
}
`,

  distance_gradient: PRELUDE + `
uniform sampler2D uTex1;
uniform sampler2D uTex2;

float signedDistance(vec2 uv) {
  vec4 field = sampleTop(uTex2, uv);
  return field.r - field.g;
}

void main() {
  vec2 t = texel();
  vec4 raw = sampleTop(uTex1, vUv);
  vec2 g = vec2(
    signedDistance(vUv + vec2(t.x, 0.0)) - signedDistance(vUv - vec2(t.x, 0.0)),
    signedDistance(vUv + vec2(0.0, t.y)) - signedDistance(vUv - vec2(0.0, t.y))
  );
  float expectedGradient = 2.0 / max(sdfRange(), 1.0);
  vec2 n = g / max(length(g), expectedGradient);
  outColor = vec4(raw.r - raw.g, n.x, n.y, raw.a);
}
`,

  blur: PRELUDE + `
uniform sampler2D uTex1;

void main() {
  float sigma = blurSigma();
  if (sigma <= 0.0) { outColor = sampleTop(uTex1, vUv); return; }
  outColor = pairedGaussianBlur(uTex1, vUv);
}
`,

  shadow_source: PRELUDE + `
uniform sampler2D uTex1;
uniform sampler2D uTex2;

void main() {
  ivec2 ip = fragCoordTopLeft();
  float cov = loadTop(uTex1, ip).a;
  vec4 src = loadTop(uTex2, ip);
  float alpha = mix(cov, src.a, assetColorOn());
  vec3 sourceRgb = mix(glassCol().rgb, src.rgb / max(src.a, 1e-6), assetColorOn());
  vec3 rgb = mix(shadowCol().rgb, appearanceRgb(sourceRgb), layerColorShadowOn());
  outColor = vec4(rgb * alpha, alpha);
}
`,

  shadow_blur: PRELUDE + `
uniform sampler2D uTex1;

void main() {
  float sigma = shadowSigma();
  if (sigma <= 0.0) { outColor = sampleTop(uTex1, vUv); return; }
  outColor = pairedGaussianBlur(uTex1, vUv);
}
`,

  shadow: PRELUDE + `
uniform sampler2D uTex1;

void main() {
  vec2 off = shadowOffset() * texel();
  vec2 uv = vUv - off;
  float inside = all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0))) ? 1.0 : 0.0;
  vec4 sh = sampleTop(uTex1, uv) * inside;
  vec3 rgb = sh.rgb / max(sh.a, 1e-5);
  outColor = vec4(rgb, sh.a);
}
`,

  glass_background: PRELUDE + `
uniform sampler2D uTex1;
uniform sampler2D uTex2;

void main() {
  vec4 dg = sampleTop(uTex1, vUv);
  float t = clamp(dg.r / max(height(), 1e-3), 0.0, 1.0);
  float disp = (1.0 - smoothstep(0.0, 1.0, t)) * refractScale();
  vec2 refr = vUv - disp * dg.gb * texel();
  vec4 bg = sampleTop(uTex2, refr);
  vec3 rgb = appearanceRgb(bg.rgb / max(bg.a, 1e-6));
  float alpha = exportAlphaMode() > 0.5 ? bg.a * materialMask(vUv, dg.r) : bg.a;
  outColor = vec4(rgb, alpha * glassOn());
}
`,

  color_layer: PRELUDE + `
uniform sampler2D uTex1;
uniform sampler2D uTex2;

void main() {
  vec4 dg = sampleTop(uTex1, vUv);
  vec4 src = sampleTop(uTex2, vUv);
  vec3 rgb = appearanceRgb(mix(glassCol().rgb, src.rgb / max(src.a, 1e-6), assetColorOn()));
  float sourceOpacity = mix(1.0, clamp(src.a / max(dg.a, 1e-6), 0.0, 1.0), assetColorOn());
  float layerOpacity = mix(glassCol().a, 1.0, assetColorOn());
  outColor = vec4(rgb, sourceOpacity * layerOpacity * materialMask(vUv, dg.r));
}
`,

  glass_highlight: PRELUDE + `
uniform sampler2D uTex1;

// iOS 26.4 glassHighlight kernel; see WGSL for coordinate/encoding adapters.
void main() {
  vec4 dg = sampleTop(uTex1, vUv);
  float d = dg.r * sdfRange();
  float coverage = specularOn() * dg.a * P[12].a;
  float staticLight = glassHighlightStrength(d, dg.gb, P[6].x, glyphInset(), P[6].w,
    vec2(1.0, 0.0), 1.0, P[6].z) * P[7].w * coverage;
  float dynamicLight = glassHighlightStrength(d, dg.gb, P[6].y, glyphInset(), P[6].w,
    lightDir(), biasAmount(), P[6].z) * P[8].w * coverage;
  outColor = vec4(P[12].rgb * (staticLight + dynamicLight),
    staticLight + dynamicLight * (1.0 - staticLight));
}
`,

  chiclet_highlight: PRELUDE + `
uniform sampler2D uTex1;
uniform sampler2D uTex2;

void main() {
  vec4 dg = sampleTop(uTex1, vUv);
  vec4 bg = sampleTop(uTex2, vUv);
  float distancePx = dg.r * sdfRange();
  vec4 lobes[3] = vec4[3](P[5], P[6], P[7]);
  vec4 lights[2] = vec4[2](P[8], P[9]);
  float brightness[3] = float[3](P[10].x, P[10].y, P[10].z);
  vec3 rgb = bg.rgb;
  for (int l = 0; l < 2; l++) {
    for (int k = 0; k < 3; k++) {
      vec4 p = lobes[k];
      vec4 light = lights[l];
      vec2 direction = k == 1 ? -light.xy : light.xy;
      float strength = glassHighlightStrength(distancePx, dg.gb, p.x, p.z,
        p.y, direction, light.z, P[11].x);
      float amount = clamp(strength * p.w * light.w * dg.a, 0.0, 1.0);
      rgb = mix(rgb, vec3(brightness[k] * bg.a), amount);
    }
  }
  outColor = vec4(rgb / max(bg.a, 1e-6), bg.a);
}
`,

  composite: PRELUDE + `
uniform sampler2D uTex1;
uniform sampler2D uTex2;
uniform sampler2D uTex3;
uniform sampler2D uTex4;
uniform sampler2D uTex5;
uniform sampler2D uTex6;

vec4 over(vec4 a, vec4 b) {
  float o = a.a + b.a * (1.0 - a.a);
  vec3 rgb = (a.rgb * a.a + b.rgb * b.a * (1.0 - a.a)) / max(o, 1e-6);
  return vec4(rgb, o);
}

// Keep coating blends identical to composite.wgsl.
float blendChannel(float back, float source, int mode) {
  if (mode == 3) return back * source;
  if (mode == 4) return back + source - back * source;
  if (mode == 5) return back <= 0.5 ? 2.0 * back * source : 1.0 - 2.0 * (1.0 - back) * (1.0 - source);
  if (mode == 6) {
    float curve = back <= 0.25 ? ((16.0 * back - 12.0) * back + 4.0) * back : sqrt(max(back, 0.0));
    return source <= 0.5 ? back - (1.0 - 2.0 * source) * back * (1.0 - back) : back + (2.0 * source - 1.0) * (curve - back);
  }
  if (mode == 7) return source <= 0.5 ? 2.0 * back * source : 1.0 - 2.0 * (1.0 - back) * (1.0 - source);
  if (mode == 8) return min(back, source);
  if (mode == 9) return max(back, source);
  return source;
}
vec4 coatingOver(vec4 source, vec4 back) {
  int mode = int(coatingBlend());
  if (mode == 1 || mode == 2) {
    float alpha = min(1.0, source.a + back.a);
    vec3 sum = source.rgb * source.a + back.rgb * back.a;
    vec3 rgb = mode == 2 ? max(vec3(0.0), sum + vec3(alpha - source.a - back.a)) : min(sum, vec3(alpha));
    return vec4(rgb / max(alpha, 1e-6), alpha);
  }
  vec3 blended = vec3(blendChannel(back.r, source.r, mode), blendChannel(back.g, source.g, mode), blendChannel(back.b, source.b, mode));
  return over(vec4(mix(source.rgb, blended, back.a), source.a), back);
}

void main() {
  vec4 sh = sampleTop(uTex1, vUv);
  vec4 glass = sampleTop(uTex2, vUv);
  vec4 fill = sampleTop(uTex3, vUv);
  vec4 hl = sampleTop(uTex4, vUv);
  float cov = sampleTop(uTex5, vUv).a;
  vec4 material = coatingOver(fill, glass);
  material.a *= cov;
  vec4 under = sh;
  if (sceneOutput() > 0.5) {
    vec4 bg = sampleTop(uTex6, vUv);
    float alpha = min(1.0, bg.a + sh.a);
    vec4 darkened = vec4(bg.rgb + sh.rgb * sh.a + vec3(alpha - bg.a - sh.a), alpha);
    vec4 shaded = mix(bg, darkened, shadowOpacity() * itemOpacity());
    under = vec4(shaded.rgb / max(shaded.a, 1e-6), shaded.a);
    material.a *= itemOpacity();
    hl *= itemOpacity();
  } else {
    under.a *= shadowOpacity();
  }
  vec4 col = over(material, under);
  float alpha = col.a + hl.a * (1.0 - col.a);
  outColor = vec4((col.rgb * col.a + hl.rgb) / max(alpha, 1e-6), alpha);
}
`,
};
