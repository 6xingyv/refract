/** Default RenderBox narrow-pass sigma limit (iOS 26.4 GaussianBlur.render). */
export const NARROW_BLUR_SIGMA = 5.25;

/**
 * RenderBox NarrowBlurKernel::construct, 0x1969a4708 in iOS 26.4 (23E246).
 * Eight pairs pack weights followed by bilinear offsets. The center tap is
 * split between the two directions, so 2 * sum(weights) = 1. The native CPU
 * computes Gaussian terms in double precision and stores pairs as floats.
 */
export function pairedGaussianKernel(sigma: number): Float32Array<ArrayBuffer> {
  if (!Number.isFinite(sigma) || sigma <= 0) {
    throw new RangeError("Gaussian sigma must be finite and positive");
  }
  const variance = Math.fround(Math.fround(sigma) ** 2);
  const inverseDenominator = 1 / Math.fround(2 * variance);
  const gaussian = new Float64Array(16);
  gaussian[0] = 1;
  let tail = 0;
  // Match native summation from the outermost tap toward the center.
  for (let i = 15; i > 0; i--) {
    gaussian[i] = Math.exp(-i * i * inverseDenominator);
    tail += gaussian[i];
  }
  const normalization = 1 / (1 + 2 * tail);
  const pairs = new Float32Array(16);
  let weightSum = 0;
  for (let pair = 0; pair < 8; pair++) {
    const even = 2 * pair;
    const evenWeight = gaussian[even] * normalization * (pair === 0 ? 0.5 : 1);
    const oddWeight = gaussian[even + 1] * normalization;
    const weight = Math.fround(evenWeight + oddWeight);
    if (weight < 0.002 || (pair > 3 && variance <= 12.25) || (pair > 5 && variance <= 27.5625)) continue;
    pairs[pair] = weight;
    pairs[8 + pair] = even + oddWeight / weight;
    weightSum += weight;
  }
  // Assign the discarded tail/float-rounding residual to the first pair.
  pairs[0] += 0.5 - weightSum;
  return pairs;
}
