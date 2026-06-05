// Continuous-curvature (Apple "squircle") rounded-rectangle corners.
// Ported from Kyant0/Shapes (ContinuousCurvatureRoundedRectangleCornerBuilder.kt +
// RoundedRectangleOutline.kt) — produces smooth G2-continuous corners instead of the
// circular arcs of a plain rounded rect. Traced onto a Canvas2D path.

const SQRT_2 = 1.4142135623730951;
const FRAC_PI_4 = 0.7853981633974483;
const FRAC_1_SQRT_2 = 0.7071067811865476;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** One real root of a*x^3 + b*x^2 + c*x + d (Cardano; assumes a single real root). */
function solveCubicSingle(a: number, b: number, c: number, d: number): number {
  const f = ((3.0 * c) / a - (b * b) / (a * a)) / 3.0;
  const g = ((2.0 * b * b * b) / (a * a * a) - (9.0 * b * c) / (a * a) + (27.0 * d) / a) / 27.0;
  const h = (g * g) / 4.0 + (f * f * f) / 27.0;
  const sqrtH = Math.sqrt(h);
  return Math.cbrt(-g / 2.0 + sqrtH) + Math.cbrt(-g / 2.0 - sqrtH) - b / (3.0 * a);
}

/** One real root of the depressed quartic x^4 + p*x^2 + q*x + r (trigonometric resolvent). */
function solveDepressedQuarticSingle(p: number, q: number, r: number): number {
  const b = -p / 2.0;
  const c = -r;
  const d = (r * p) / 2.0 - (q * q) / 8.0;
  const f = (3.0 * c - b * b) / 3.0;
  const g = (2.0 * b * b * b - 9.0 * b * c + 27.0 * d) / 27.0;
  const rr = Math.sqrt((-f * f * f) / 27.0);
  const phi = Math.acos(-g / (2.0 * rr));
  const y = 2.0 * Math.sqrt(-f / 3.0) * Math.cos(phi / 3.0);
  const z = y - b / 3.0;
  const u = Math.sqrt(2.0 * z - p);
  return (u - Math.sqrt(u * u - 4.0 * (z + q / (2.0 * u)))) / 2.0;
}

class CornerBuilder {
  private cos: number; private sin: number; private cot: number;
  private cos2: number; private sin2: number; private cos3: number; private sin3: number;
  private k0: number; private k1: number; private k2: number; private k3: number;

  constructor(private extendedFraction = 2.0 / 3.0, arcFraction = 0.5) {
    const theta = (1.0 - arcFraction) * FRAC_PI_4;
    const cos = (this.cos = Math.cos(theta));
    const sin = (this.sin = Math.sin(theta));
    this.cot = 1.0 / Math.tan(theta);
    const cos2 = (this.cos2 = cos * cos);
    const sin2 = (this.sin2 = sin * sin);
    const cos3 = (this.cos3 = cos2 * cos);
    const sin3 = (this.sin3 = sin2 * sin);
    const cot = this.cot;
    this.k0 =
      27.0 * (SQRT_2 - 6.0 * cos + 6.0 * SQRT_2 * cos2 - 4.0 * cos3) * cot +
      2.0 * sin * (-9.0 + 2.0 * (SQRT_2 - 2.0 * sin) * sin3 + 2.0 * SQRT_2 * cos * (9.0 + sin2) - 2.0 * cos2 * (9.0 + 2.0 * sin2));
    this.k1 =
      -81.0 * (-2.0 + SQRT_2 + 4.0 * (-1.0 + SQRT_2) * cos + 2.0 * (-2.0 + SQRT_2) * cos2) * cot -
      4.0 * sin * (-9.0 + 9.0 * SQRT_2 + SQRT_2 * sin3 + (-2.0 + SQRT_2) * cos * (9.0 + sin2));
    this.k2 = 9.0 * (9.0 * (-4.0 + 3.0 * SQRT_2 + (-6.0 + 4.0 * SQRT_2) * cos) * cot + (-6.0 + 4.0 * SQRT_2) * sin);
    this.k3 = 27.0 * (10.0 - 7.0 * SQRT_2) * cot;
  }

  /** 10 control points (x,y interleaved, 20 numbers) for a unit corner with edge-extension tH/tV. */
  getCornerBezierPoints(tH = 1.0, tV = 1.0): number[] {
    return tH === tV ? this.even(tH) : this.uneven(tH, tV);
  }

  private even(t: number): number[] {
    const { sin, cos, cot, sin3, cos2, sin2 } = this;
    const k = this.extendedFraction * t;
    const kappa = solveCubicSingle(this.k3, this.k2, this.k1 + 8.0 * -k * sin3 * sin, this.k0);

    const x3 = FRAC_1_SQRT_2 + (-FRAC_1_SQRT_2 + sin) / kappa;
    const y3 = 1.0 - FRAC_1_SQRT_2 + (FRAC_1_SQRT_2 - cos) / kappa;
    const x2 = x3 - y3 * cot;
    const x1 = x2 - (1.5 * kappa * y3 * y3) / sin3;
    const x0 = -k;
    const x6 = 1.0 - y3, y6 = 1.0 - x3, y7 = 1.0 - x2, y8 = 1.0 - x1, y9 = 1.0 - x0;

    const a = 1.5 * kappa;
    const g = cos2 - sin2;
    const x36 = x6 - x3, y36 = y6 - y3;
    const c = -(cos * y36 - sin * x36);
    const lambda = (-g + Math.sqrt(g * g - 4.0 * a * c)) / (2.0 * a);
    const x4 = x3 + lambda * cos, y4 = y3 + lambda * sin;
    const x5 = x6 - lambda * sin, y5 = y6 - lambda * cos;
    return [x0, 0, x1, 0, x2, 0, x3, y3, x4, y4, x5, y5, x6, y6, 1, y7, 1, y8, 1, y9];
  }

  private uneven(tH: number, tV: number): number[] {
    const { sin, cos, cot, sin3, cos2, sin2 } = this;
    const kH = this.extendedFraction * tH, kV = this.extendedFraction * tV;
    const kappa3 = solveCubicSingle(this.k3, this.k2, this.k1 + 8.0 * -kH * sin3 * sin, this.k0);
    const kappa6 = solveCubicSingle(this.k3, this.k2, this.k1 + 8.0 * -kV * sin3 * sin, this.k0);

    const x3 = FRAC_1_SQRT_2 + (-FRAC_1_SQRT_2 + sin) / kappa3;
    const y3 = 1.0 - FRAC_1_SQRT_2 + (FRAC_1_SQRT_2 - cos) / kappa3;
    const x2 = x3 - y3 * cot;
    const x1 = x2 - (1.5 * kappa3 * y3 * y3) / sin3;
    const x0 = -kH;

    const x3p = FRAC_1_SQRT_2 + (-FRAC_1_SQRT_2 + sin) / kappa6;
    const y3p = 1.0 - FRAC_1_SQRT_2 + (FRAC_1_SQRT_2 - cos) / kappa6;
    const x2p = x3p - y3p * cot;
    const x1p = x2p - (1.5 * kappa6 * y3p * y3p) / sin3;
    const x0p = -kV;
    const x6 = 1.0 - y3p, y6 = 1.0 - x3p, y7 = 1.0 - x2p, y8 = 1.0 - x1p, y9 = 1.0 - x0p;

    const a = 1.5 * kappa3, b = 1.5 * kappa6;
    const g = cos2 - sin2;
    const x36 = x6 - x3, y36 = y6 - y3;
    const c = -(cos * y36 - sin * x36);
    const d = sin * y36 - cos * x36;
    const p = 2.0 * (d / b);
    const q = (g * g * g) / (a * b * b);
    const r = (a * d * d + c * g * g) / (a * b * b);
    const lambda6 = solveDepressedQuarticSingle(p, q, r);
    const lambda3 = (-d - b * lambda6 * lambda6) / g;
    const x4 = x3 + lambda3 * cos, y4 = y3 + lambda3 * sin;
    const x5 = x6 - lambda6 * sin, y5 = y6 - lambda6 * cos;
    return [x0, 0, x1, 0, x2, 0, x3, y3, x4, y4, x5, y5, x6, y6, 1, y7, 1, y8, 1, y9];
  }
}

const BUILDER = new CornerBuilder();

/**
 * Append a continuous-curvature ("squircle") rounded-rect subpath to `ctx`.
 * Drop-in replacement for a rounded-rect helper: begins a new path, traces, leaves it
 * ready to fill/clip. Falls back to a circle when square and the radius reaches the half-size.
 */
export function squircle(ctx: CanvasRenderingContext2D, left: number, top: number, w: number, h: number, radius: number) {
  ctx.beginPath();
  const maxR = Math.min(w, h) * 0.5;
  const r = Math.min(Math.max(radius, 0), maxR);
  if (r <= 0) { ctx.rect(left, top, w, h); return; }
  if (w === h && r >= maxR - 1e-6) { ctx.arc(left + w / 2, top + h / 2, maxR, 0, Math.PI * 2); return; }

  const tW = clamp((w * 0.5 - r) / r, 0, 1);
  const tH = clamp((h * 0.5 - r) / r, 0, 1);
  const p = BUILDER.getCornerBezierPoints(tW, tH);
  const C = (a: number, b: number, c: number, d: number, e: number, f: number) => ctx.bezierCurveTo(a, b, c, d, e, f);

  // top-right
  let x = left + w - r, y = top;
  ctx.moveTo(x + p[0] * r, y + p[1] * r);
  C(x + p[2] * r, y + p[3] * r, x + p[4] * r, y + p[5] * r, x + p[6] * r, y + p[7] * r);
  C(x + p[8] * r, y + p[9] * r, x + p[10] * r, y + p[11] * r, x + p[12] * r, y + p[13] * r);
  C(x + p[14] * r, y + p[15] * r, x + p[16] * r, y + p[17] * r, x + p[18] * r, y + p[19] * r);
  // bottom-right
  x = left + w - r; y = top + h;
  ctx.lineTo(x + p[18] * r, y - p[19] * r);
  C(x + p[16] * r, y - p[17] * r, x + p[14] * r, y - p[15] * r, x + p[12] * r, y - p[13] * r);
  C(x + p[10] * r, y - p[11] * r, x + p[8] * r, y - p[9] * r, x + p[6] * r, y - p[7] * r);
  C(x + p[4] * r, y - p[5] * r, x + p[2] * r, y - p[3] * r, x + p[0] * r, y - p[1] * r);
  // bottom-left
  x = left + r; y = top + h;
  ctx.lineTo(x - p[0] * r, y - p[1] * r);
  C(x - p[2] * r, y - p[3] * r, x - p[4] * r, y - p[5] * r, x - p[6] * r, y - p[7] * r);
  C(x - p[8] * r, y - p[9] * r, x - p[10] * r, y - p[11] * r, x - p[12] * r, y - p[13] * r);
  C(x - p[14] * r, y - p[15] * r, x - p[16] * r, y - p[17] * r, x - p[18] * r, y - p[19] * r);
  // top-left
  x = left + r; y = top;
  ctx.lineTo(x - p[18] * r, y + p[19] * r);
  C(x - p[16] * r, y + p[17] * r, x - p[14] * r, y + p[15] * r, x - p[12] * r, y + p[13] * r);
  C(x - p[10] * r, y + p[11] * r, x - p[8] * r, y + p[9] * r, x - p[6] * r, y + p[7] * r);
  C(x - p[4] * r, y + p[5] * r, x - p[2] * r, y + p[3] * r, x - p[0] * r, y + p[1] * r);
  ctx.closePath();
}

/** SVG path-data string for the same squircle (viewBox left/top/w/h), for CSS clip-path / <path>. */
export function squirclePathData(left: number, top: number, w: number, h: number, radius: number): string {
  const maxR = Math.min(w, h) * 0.5;
  const r = Math.min(Math.max(radius, 0), maxR);
  if (r <= 0) return `M${left} ${top}H${left + w}V${top + h}H${left}Z`;
  const tW = clamp((w * 0.5 - r) / r, 0, 1);
  const tH = clamp((h * 0.5 - r) / r, 0, 1);
  const p = BUILDER.getCornerBezierPoints(tW, tH);
  const n = (v: number) => Number(v.toFixed(3));
  const out: string[] = [];
  let x = left + w - r, y = top;
  out.push(`M${n(x + p[0] * r)} ${n(y + p[1] * r)}`);
  out.push(`C${n(x + p[2] * r)} ${n(y + p[3] * r)} ${n(x + p[4] * r)} ${n(y + p[5] * r)} ${n(x + p[6] * r)} ${n(y + p[7] * r)}`);
  out.push(`C${n(x + p[8] * r)} ${n(y + p[9] * r)} ${n(x + p[10] * r)} ${n(y + p[11] * r)} ${n(x + p[12] * r)} ${n(y + p[13] * r)}`);
  out.push(`C${n(x + p[14] * r)} ${n(y + p[15] * r)} ${n(x + p[16] * r)} ${n(y + p[17] * r)} ${n(x + p[18] * r)} ${n(y + p[19] * r)}`);
  x = left + w - r; y = top + h;
  out.push(`L${n(x + p[18] * r)} ${n(y - p[19] * r)}`);
  out.push(`C${n(x + p[16] * r)} ${n(y - p[17] * r)} ${n(x + p[14] * r)} ${n(y - p[15] * r)} ${n(x + p[12] * r)} ${n(y - p[13] * r)}`);
  out.push(`C${n(x + p[10] * r)} ${n(y - p[11] * r)} ${n(x + p[8] * r)} ${n(y - p[9] * r)} ${n(x + p[6] * r)} ${n(y - p[7] * r)}`);
  out.push(`C${n(x + p[4] * r)} ${n(y - p[5] * r)} ${n(x + p[2] * r)} ${n(y - p[3] * r)} ${n(x + p[0] * r)} ${n(y - p[1] * r)}`);
  x = left + r; y = top + h;
  out.push(`L${n(x - p[0] * r)} ${n(y - p[1] * r)}`);
  out.push(`C${n(x - p[2] * r)} ${n(y - p[3] * r)} ${n(x - p[4] * r)} ${n(y - p[5] * r)} ${n(x - p[6] * r)} ${n(y - p[7] * r)}`);
  out.push(`C${n(x - p[8] * r)} ${n(y - p[9] * r)} ${n(x - p[10] * r)} ${n(y - p[11] * r)} ${n(x - p[12] * r)} ${n(y - p[13] * r)}`);
  out.push(`C${n(x - p[14] * r)} ${n(y - p[15] * r)} ${n(x - p[16] * r)} ${n(y - p[17] * r)} ${n(x - p[18] * r)} ${n(y - p[19] * r)}`);
  x = left + r; y = top;
  out.push(`L${n(x - p[18] * r)} ${n(y + p[19] * r)}`);
  out.push(`C${n(x - p[16] * r)} ${n(y + p[17] * r)} ${n(x - p[14] * r)} ${n(y + p[15] * r)} ${n(x - p[12] * r)} ${n(y + p[13] * r)}`);
  out.push(`C${n(x - p[10] * r)} ${n(y + p[11] * r)} ${n(x - p[8] * r)} ${n(y + p[9] * r)} ${n(x - p[6] * r)} ${n(y + p[7] * r)}`);
  out.push(`C${n(x - p[4] * r)} ${n(y + p[5] * r)} ${n(x - p[2] * r)} ${n(y + p[3] * r)} ${n(x - p[0] * r)} ${n(y + p[1] * r)}`);
  out.push("Z");
  return out.join("");
}
