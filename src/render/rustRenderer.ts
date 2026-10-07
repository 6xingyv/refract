import { invoke } from "@tauri-apps/api/core";
import type { IconDocument, Layer } from "../model/types";
import type { AssetEntry } from "./compositor";
import type { BackdropSpec } from "./backdrop";

type RustRenderedPng = {
  data: string;
  width: number;
  height: number;
  renderer: "rust-cpu";
};

export type RustPreviewRequest = {
  doc: IconDocument;
  size: number;
  slot: string | null;
  backdrop?: BackdropSpec;
  options?: RustRenderOptions;
};

export type RustLayerThumbRequest = {
  layer: Layer;
  size: number;
  dark: boolean;
};

export type RustRenderOptions = {
  layer?: "combined" | "foreground" | "background";
  clipChiclet?: boolean;
};

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function renderPreviewRust(
  doc: IconDocument,
  size: number,
  slot: string | null,
  backdrop: BackdropSpec | undefined,
  assets: AssetEntry[],
  options?: RustRenderOptions,
): Promise<HTMLCanvasElement | null> {
  if (!isTauri()) return null;
  const args: Record<string, unknown> = {
    doc,
    assets,
    size,
    slot,
    backdrop,
  };
  if (options) args.options = options;
  const rendered = await invoke<RustRenderedPng>("render_preview", args);
  return pngToCanvas(rendered);
}

export async function renderPreviewsRust(
  requests: RustPreviewRequest[],
  assets: AssetEntry[],
): Promise<(HTMLCanvasElement | null)[]> {
  if (!isTauri()) return requests.map(() => null);
  if (!requests.length) return [];
  const rendered = await invoke<RustRenderedPng[]>("render_previews", {
    requests,
    assets,
  });
  return Promise.all(rendered.map(pngToCanvas));
}

export async function renderLayerThumbRust(
  layer: Layer,
  size: number,
  dark: boolean,
  assets: AssetEntry[],
): Promise<HTMLCanvasElement | null> {
  if (!isTauri()) return null;
  const rendered = await invoke<RustRenderedPng>("render_layer_thumb", {
    layer,
    assets,
    size,
    dark,
  });
  return pngToCanvas(rendered);
}

export async function renderLayerThumbsRust(
  requests: RustLayerThumbRequest[],
  assets: AssetEntry[],
): Promise<(HTMLCanvasElement | null)[]> {
  if (!isTauri()) return requests.map(() => null);
  if (!requests.length) return [];
  const rendered = await invoke<RustRenderedPng[]>("render_layer_thumbs", {
    requests,
    assets,
  });
  return Promise.all(rendered.map(pngToCanvas));
}

function pngToCanvas(rendered: RustRenderedPng): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = rendered.width;
      canvas.height = rendered.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas2D unavailable for Rust preview PNG."));
        return;
      }
      ctx.drawImage(image, 0, 0);
      resolve(canvas);
    };
    image.onerror = () => reject(new Error("Failed to decode Rust preview PNG."));
    image.src = `data:image/png;base64,${rendered.data}`;
  });
}
