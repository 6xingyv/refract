export interface LayeredExport {
  foreground: HTMLCanvasElement;
  background: HTMLCanvasElement;
}

/**
 * Build a straight-alpha foreground PNG over an unchanged background layer.
 *
 * Glass refraction is background-dependent, so its sampled RGB is baked into
 * the foreground while alpha comes from the material-alpha render. If that
 * RGB cannot fit the PNG gamut at the requested alpha, alpha is increased only
 * as much as mathematically required. This preserves glass translucency where
 * possible without corrupting the background layer.
 */
export function extractForegroundLayer(
  combined: HTMLCanvasElement,
  background: HTMLCanvasElement,
  alphaHint: HTMLCanvasElement,
): LayeredExport {
  const width = combined.width;
  const height = combined.height;
  const foreground = document.createElement("canvas");
  foreground.width = width;
  foreground.height = height;

  const combinedData = combined.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, width, height);
  const backgroundData = background.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, width, height);
  const hintData = alphaHint.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, width, height);
  const result = new ImageData(width, height);

  for (let i = 0; i < result.data.length; i += 4) {
    const ca = combinedData.data[i + 3] / 255;
    const ba = backgroundData.data[i + 3] / 255;
    let alpha = clamp01(hintData.data[i + 3] / 255);

    if (ba < 254 / 255) {
      // Both source canvases were clipped once by the chiclet mask. Stacking
      // two independently antialiased edges would double their coverage, so
      // assign that subpixel edge to the background layer.
      alpha = ba < 1 ? clamp01((ca - ba) / (1 - ba)) : 0;
      if (alpha < 1 / 255) continue;
    } else {
      // Straight-alpha PNG cannot store RGB outside 0...1. Refraction can move
      // a colour far from the local background, requiring a denser pixel.
      for (let channel = 0; channel < 3; channel++) {
        const c = combinedData.data[i + channel] / 255;
        const b = backgroundData.data[i + channel] / 255;
        if (c > b && b < 1) alpha = Math.max(alpha, (c - b) / (1 - b));
        else if (c < b && b > 0) alpha = Math.max(alpha, (b - c) / b);
      }
    }
    alpha = clamp01(alpha);
    if (alpha < 1 / 255) continue;

    for (let channel = 0; channel < 3; channel++) {
      const c = combinedData.data[i + channel] / 255;
      const b = backgroundData.data[i + channel] / 255;
      const value = (c * ca - b * ba * (1 - alpha)) / alpha;
      result.data[i + channel] = Math.round(clamp01(value) * 255);
    }
    result.data[i + 3] = Math.round(alpha * 255);
  }

  foreground.getContext("2d")!.putImageData(result, 0, 0);
  return { foreground, background };
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
