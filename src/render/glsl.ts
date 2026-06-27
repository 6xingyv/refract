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

uniform vec4 P[12];

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
float blurRadius() { return P[3].y; }
float shadowRadius() { return P[3].z; }
float shadowOpacity() { return P[3].w; }
float jfaStep() { return P[4].x; }
vec2 blurDir() { return P[4].yz; }
float appearance() { return P[4].w; }
vec4 glassCol() { return P[5]; }
vec4 tint() { return P[6]; }
vec4 shadowCol() { return P[7]; }
vec2 shadowOffset() { return P[8].xy; }
float specularOn() { return P[8].z; }
float glowOn() { return P[8].w; }
float glassOn() { return P[9].x; }
float translucency() { return P[9].y; }
float assetColorOn() { return P[9].z; }
float layerColorShadowOn() { return P[9].w; }
float shapeTop() { return P[10].x; }
float shapeBottom() { return P[10].y; }
float exportAlphaMode() { return P[11].x; }

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
`;

export const GLSL_FRAGMENT: Record<string, string> = {
  jfa_seed: PRELUDE + `
uniform sampler2D uTex1;

void main() {
  ivec2 ip = fragCoordTopLeft();
  ivec2 dim = ivec2(resolution());
  ivec2 lo = ivec2(0, 0);
  ivec2 hi = dim - ivec2(1, 1);

  float c = loadTop(uTex1, ip).a;
  float a0 = loadTop(uTex1, clamp(ip + ivec2(-1, 0), lo, hi)).a;
  float a1 = loadTop(uTex1, clamp(ip + ivec2(1, 0), lo, hi)).a;
  float a2 = loadTop(uTex1, clamp(ip + ivec2(0, -1), lo, hi)).a;
  float a3 = loadTop(uTex1, clamp(ip + ivec2(0, 1), lo, hi)).a;

  float partialCoverage = step(0.001, c) * step(c, 0.999);
  float neighborDelta = max(max(abs(a0 - c), abs(a1 - c)), max(abs(a2 - c), abs(a3 - c)));
  float boundary = max(partialCoverage, step(0.001, neighborDelta));
  float empty = 1.0 - boundary;
  outColor = vec4(float(ip.x) * boundary - empty, float(ip.y) * boundary - empty, 0.0, boundary);
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
  if (best.w > 0.5) {
    bestD = distance(p, best.xy);
  }

  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      ivec2 np = clamp(ip + ivec2(dx, dy) * stepPx, ivec2(0, 0), dim - ivec2(1, 1));
      vec4 s = loadTop(uTex1, np);
      if (s.w > 0.5) {
        float d = distance(p, s.xy);
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
  bool inside = cov > 0.0;
  vec4 s = loadTop(uTex1, ip);
  float distPx = 0.0;
  if (s.w > 0.5) {
    distPx = distance(vec2(ip), s.xy);
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
const int TAPS = 10;

void main() {
  float scalePx = max(resolution().x / 512.0, 1.0);
  vec2 dir = blurDir() * texel() * scalePx;
  float sigma = 3.5;
  float sumR = 0.0;
  float wsum = 0.0;
  for (int i = -TAPS; i <= TAPS; i++) {
    float fi = float(i);
    float w = exp(-0.5 * fi * fi / (sigma * sigma));
    sumR += w * sampleTop(uTex1, vUv + dir * fi).r;
    wsum += w;
  }
  vec4 c = sampleTop(uTex1, vUv);
  outColor = vec4(sumR / wsum, c.g, c.b, c.a);
}
`,

  distance_gradient: PRELUDE + `
uniform sampler2D uTex1;
uniform sampler2D uTex2;

void main() {
  vec2 t = texel() * 1.5;
  vec4 raw = sampleTop(uTex1, vUv);
  float tl = sampleTop(uTex2, vUv + vec2(-t.x, -t.y)).r;
  float tc = sampleTop(uTex2, vUv + vec2(0.0, -t.y)).r;
  float tr = sampleTop(uTex2, vUv + vec2(t.x, -t.y)).r;
  float ml = sampleTop(uTex2, vUv + vec2(-t.x, 0.0)).r;
  float mr = sampleTop(uTex2, vUv + vec2(t.x, 0.0)).r;
  float bl = sampleTop(uTex2, vUv + vec2(-t.x, t.y)).r;
  float bc = sampleTop(uTex2, vUv + vec2(0.0, t.y)).r;
  float br = sampleTop(uTex2, vUv + vec2(t.x, t.y)).r;

  vec2 g = vec2(
    (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl),
    (bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr)
  );
  vec2 n = vec2(0.0, 0.0);
  if (any(notEqual(g, vec2(0.0, 0.0)))) {
    n = normalize(g);
  }
  outColor = vec4(raw.r, n.x, n.y, raw.a);
}
`,

  blur: PRELUDE + `
uniform sampler2D uTex1;
const int TAPS = 16;

void main() {
  float r = blurRadius();
  if (r <= 0.0) {
    outColor = sampleTop(uTex1, vUv);
    return;
  }
  vec2 stepUv = blurDir() * texel() * (r / float(TAPS));
  float sigma = float(TAPS) / 2.5;
  vec4 sum = vec4(0.0);
  float wsum = 0.0;
  for (int i = -TAPS; i <= TAPS; i++) {
    float fi = float(i);
    float w = exp(-0.5 * fi * fi / (sigma * sigma));
    sum += w * sampleTop(uTex1, vUv + stepUv * fi);
    wsum += w;
  }
  outColor = sum / wsum;
}
`,

  shadow_source: PRELUDE + `
uniform sampler2D uTex1;
uniform sampler2D uTex2;
uniform sampler2D uTex3;
uniform sampler2D uTex4;

void main() {
  ivec2 ip = fragCoordTopLeft();
  ivec2 dim = ivec2(resolution());
  float cov = loadTop(uTex3, ip).a;
  vec4 seed = loadTop(uTex1, ip);

  vec3 edgeRgb = shadowCol().rgb;
  if (seed.w > 0.5) {
    ivec2 seedIp = clamp(ivec2(round(seed.xy)), ivec2(0, 0), dim - ivec2(1, 1));
    vec4 edge = loadTop(uTex4, seedIp);
    edgeRgb = mix(glassCol().rgb, edge.rgb, assetColorOn());
  }

  vec3 rgb = mix(shadowCol().rgb, edgeRgb, layerColorShadowOn());
  outColor = vec4(rgb * cov, cov);
}
`,

  shadow_blur: PRELUDE + `
uniform sampler2D uTex1;
const int TAPS = 16;

void main() {
  float r = shadowRadius();
  if (r <= 0.001) {
    outColor = sampleTop(uTex1, vUv);
    return;
  }

  vec2 stepUv = blurDir() * texel() * (r / float(TAPS));
  float sigma = float(TAPS) / 2.5;
  vec4 sum = vec4(0.0);
  float wsum = 0.0;
  for (int i = -TAPS; i <= TAPS; i++) {
    float fi = float(i);
    float w = exp(-0.5 * fi * fi / (sigma * sigma));
    sum += w * sampleTop(uTex1, vUv + stepUv * fi);
    wsum += w;
  }
  outColor = sum / wsum;
}
`,

  shadow: PRELUDE + `
uniform sampler2D uTex1;

void main() {
  vec2 off = shadowOffset() * texel();
  vec4 sh = sampleTop(uTex1, vUv - off);
  vec3 rgb = sh.rgb / max(sh.a, 1e-5);
  outColor = vec4(rgb, sh.a * shadowOpacity());
}
`,

  glass_background: PRELUDE + `
uniform sampler2D uTex1;
uniform sampler2D uTex2;

void main() {
  vec4 dg = sampleTop(uTex1, vUv);
  float h = dg.r;
  vec2 normal = dg.gb;
  float cov = dg.a;

  float t = clamp(h / max(height(), 1e-3), 0.0, 1.0);
  float disp = (1.0 - smoothstep(0.0, 1.0, t)) * refractScale();
  vec2 refr = vUv - disp * normal * texel();

  vec4 bg = sampleTop(uTex2, refr);
  if (exportAlphaMode() > 0.5 && glassOn() > 0.5) {
    float translucentPct = clamp(translucency(), 0.0, 1.0);
    float bottomAlpha = 1.0 - translucentPct;
    float shapeHeight = max(shapeBottom() - shapeTop(), texel().y);
    float shapeY = clamp((vUv.y - shapeTop()) / shapeHeight, 0.0, 1.0);
    float materialAlpha = mix(1.0, bottomAlpha, shapeY);
    outColor = vec4(bg.rgb, cov * materialAlpha);
    return;
  }
  outColor = vec4(bg.rgb, cov * glassOn());
}
`,

  color_layer: PRELUDE + `
uniform sampler2D uTex1;
uniform sampler2D uTex2;

vec3 boostSaturation(vec3 rgb, float amount) {
  float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  return clamp(mix(vec3(luma), rgb, amount), vec3(0.0), vec3(1.0));
}

void main() {
  vec4 dg = sampleTop(uTex1, vUv);
  vec4 src = sampleTop(uTex2, vUv);
  float cov = src.a;
  vec3 rgb = boostSaturation(mix(glassCol().rgb, src.rgb, assetColorOn()), 1.14);
  float layerAlpha = mix(glassCol().a, 1.0, assetColorOn());

  float sdf = dg.r;
  float aaWidth = clamp(fwidth(sdf), 0.0005, 2.0);
  float edgeInset = height() * 0.14;
  float lightEnd = height() * 0.46;
  float denseStart = height() * 0.42;
  float denseEnd = height() * 1.10;

  float insetGate = smoothstep(edgeInset - aaWidth, edgeInset + aaWidth, sdf);
  float lightBand = insetGate * (1.0 - smoothstep(lightEnd - aaWidth, lightEnd + aaWidth, sdf));
  float denseBand = smoothstep(denseStart - aaWidth, denseEnd + aaWidth, sdf);

  float ndotl = dot(lightDir(), dg.gb);
  float light = clamp((ndotl - spread()) / max(1.0 - spread(), 0.001), 0.0, 1.0) * specularOn();
  rgb = boostSaturation(rgb, 1.0 + denseBand * 0.10);

  float translucentPct = clamp(translucency(), 0.0, 1.0);
  float bottomAlpha = 1.0 - translucentPct;
  float shapeHeight = max(shapeBottom() - shapeTop(), texel().y);
  float shapeY = clamp((vUv.y - shapeTop()) / shapeHeight, 0.0, 1.0);
  float trans = mix(1.0, bottomAlpha, shapeY);
  float lightAlpha = 1.0 - lightBand * light * 0.22;
  float denseAlpha = 1.0 + denseBand * 0.20;
  outColor = vec4(rgb, clamp(cov * layerAlpha * trans * lightAlpha * denseAlpha, 0.0, 1.0));
}
`,

  glass_highlight: PRELUDE + `
uniform sampler2D uTex1;

void main() {
  vec4 dg = sampleTop(uTex1, vUv);
  float sdf = dg.r;
  vec2 normal = dg.gb;

  float edgeInset = height() * 0.6;
  float band = edgeInset + height();
  float aaWidth = clamp(fwidth(sdf), 0.0005, 2.0) * 0.83301;
  float insetCov = smoothstep(edgeInset - aaWidth, edgeInset + aaWidth, sdf);
  float bandCov = 1.0 - smoothstep(band - aaWidth, band + aaWidth, sdf);
  float coverage = insetCov * bandCov * dg.a;

  float up = clamp((sdf - edgeInset) / max(band - edgeInset, 1e-3), 0.0, 1.0);
  float curveTerm = mix(1.0, (1.0 - up) * (1.0 - up), curvature());

  vec2 lightDirMain = lightDir();
  vec2 lightDirFill = -lightDirMain;
  float ndotlMain = dot(normal, lightDirMain);
  float lightMain = clamp((ndotlMain - spread()) / max(1.0 - spread(), 0.001), 0.0, 0.6);
  float ndotlFill = dot(normal, lightDirFill);
  float lightFill = clamp((ndotlFill - spread()) / max(1.0 - spread(), 0.001), 0.0, 0.3) * 0.4;
  float lightTotal = lightMain + lightFill;
  float biasDen = max(1.0 + (1.0 - lightTotal) * biasAmount(), 0.001);

  float v = 0.7 * curveTerm * coverage * lightTotal / biasDen * specularOn();
  outColor = vec4(v, v, v, v);
}
`,

  composite: PRELUDE + `
uniform sampler2D uTex1;
uniform sampler2D uTex2;
uniform sampler2D uTex3;
uniform sampler2D uTex4;

vec4 over(vec4 a, vec4 b) {
  float o = a.a + b.a * (1.0 - a.a);
  vec3 rgb = (a.rgb * a.a + b.rgb * b.a * (1.0 - a.a)) / max(o, 1e-6);
  return vec4(rgb, o);
}

void main() {
  vec4 sh = sampleTop(uTex1, vUv);
  vec4 glass = sampleTop(uTex2, vUv);
  vec4 fill = sampleTop(uTex3, vUv);
  vec4 hl = sampleTop(uTex4, vUv);

  vec4 col = sh;
  col = over(glass, col);
  col = over(fill, col);
  col = vec4(col.rgb + hl.rgb, col.a);

  if (exportAlphaMode() > 0.5 && glassOn() > 0.5) {
    col.a = max(sh.a, glass.a);
  }

  float ap = appearance();
  float luma = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));
  if (ap >= 4.5) {
    col = vec4(col.rgb, col.a * 0.6);
  } else if (ap >= 3.5) {
    col = vec4(mix(col.rgb, vec3(luma) * tint().rgb * 2.0, tint().a), col.a);
  } else if (ap >= 2.5) {
    col = vec4(vec3(luma), col.a);
  }
  outColor = col;
}
`,
};
