import { create } from "zustand";
import type { IconDocument, Rendition, Platform, Appearance, MonoPreviewRendition } from "../model/types";
import { renditionOf, specSlot, slotOf, resolveLayer, appearanceOf, ARTWORK_RENDITIONS, isMonoPreview, RENDITIONS } from "../model/types";
import { normalizeInternalAngle } from "../model/angles";

const VARIANTS = ARTWORK_RENDITIONS;
const PLATFORM_VARIANTS: Platform[] = ["iOS", "macOS", "watchOS"];
const FIXED_RENDER_LIGHT_ANGLE = 45;
import {
  sampleDocument,
  ICON_ID,
  moveMember,
  addImageLayers,
  deleteMember,
  selectionAfterDelete,
  copyMember,
  pasteMember,
  type CopiedMember,
} from "../model/document";
import { encodeIcon, decodeIcon, iconAssetNames } from "../model/io";
import { Renderer } from "../render/renderer";
import { Compositor, AssetStore, type RenderOptions } from "../render/compositor";
import {
  renderLayerThumbsRust,
  type RustLayerThumbRequest,
  type RustPreviewRequest,
} from "../render/rustRenderer";
import { extractForegroundLayer } from "../render/exportLayers";
import { open, save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

const assets = new AssetStore();
let compositor: Compositor | null = null;
let initOnce: Promise<void> | null = null;

type ImportAsset = { name: string; dataUrl: string };
type EncodedAsset = { name: string; data: string };
type HistorySnapshot = Pick<State, "doc" | "selectedId" | "appearance" | "monoPreviewRendition">;
const historySnapshot = ({ doc, selectedId, appearance, monoPreviewRendition }: State): HistorySnapshot =>
  ({ doc, selectedId, appearance, monoPreviewRendition });

export interface ExportOptions {
  variants: Rendition[];
  clipChiclet: boolean;
  layered: boolean;
}

const isImportableAssetName = (name: string) => /\.(svg|png)$/i.test(name);
const fileNameOf = (name: string) => name.split(/[\\/]/).pop() || name;
const splitAssetName = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? { stem: name.slice(0, dot), ext: name.slice(dot) } : { stem: name, ext: "" };
};
const uniqueAssetName = (name: string, used: Set<string>) => {
  if (!used.has(name.toLowerCase())) {
    used.add(name.toLowerCase());
    return name;
  }
  const { stem, ext } = splitAssetName(name);
  let i = 2;
  while (used.has(`${stem}-${i}${ext}`.toLowerCase())) i++;
  const next = `${stem}-${i}${ext}`;
  used.add(next.toLowerCase());
  return next;
};
let memberClipboard: CopiedMember | null = null;

async function ensureCompositor(setError: (e: string | null) => void) {
  if (compositor) return;
  if (!initOnce) {
    initOnce = (async () => {
      try {
        const renderer = await Renderer.create();
        compositor = new Compositor(renderer, assets);
      } catch (e: any) {
        // GPU unavailable -> non-glass fallback (tinted shapes only)
        setError(`GPU rendering unavailable: ${e?.message ?? e}. Glass effects disabled.`);
        compositor = new Compositor(null, assets);
      }
    })();
  }
  await initOnce;
}

export type BgKind = "color" | "image";

interface State {
  doc: IconDocument;
  selectedId: number;
  lightAngleDeg: number;
  animateLight: boolean;
  previewCanvas: HTMLCanvasElement | null;
  viewW: number;
  viewH: number;
  variants: { id: Rendition; url: string }[];
  platformVariants: { id: Platform; url: string }[];
  layerThumbs: Record<number, string>;
  appearance: Appearance;
  monoPreviewRendition: MonoPreviewRendition;
  previewBgDark: boolean;
  bgKind: BgKind;
  bgImage: number;       // index into the built-in preview backdrops
  bgColor: string;       // css colour for the "color" backdrop
  showGrid: boolean;
  zoom: number;
  error: string | null;
  rendering: boolean;
  past: HistorySnapshot[];
  future: HistorySnapshot[];
  hasMemberClipboard: boolean;

  select: (id: number) => void;
  undo: () => void;
  redo: () => void;
  deleteSelected: () => void;
  copySelected: () => boolean;
  pasteCopied: () => boolean;
  setLightAngle: (angle: number) => void;
  setAnimateLight: (enabled: boolean) => void;
  setZoom: (z: number) => void;
  setViewport: (w: number, h: number) => void;
  setAppearance: (a: Appearance) => void;
  setPreviewRendition: (r: Rendition) => void;
  setPreviewBgDark: (v: boolean) => void;
  setBg: (p: Partial<{ bgKind: BgKind; bgImage: number; bgColor: string }>) => void;
  toggleGrid: () => void;
  reorder: (dragId: number, targetId: number, before: boolean) => void;
  importAssets: (items: ImportAsset[]) => Promise<void>;
  importAssetPaths: (paths: string[]) => Promise<void>;
  update: (fn: (doc: IconDocument) => IconDocument) => void;
  setDoc: (doc: IconDocument) => void;
  openIcon: () => Promise<void>;
  saveIcon: () => Promise<void>;
  exportPng: (options?: ExportOptions) => Promise<void>;
}

type RenderScope = "preview" | "all";
let previewRenderTimer: number | undefined;
let derivedRenderTimer: number | undefined;
let previewRenderRequest = 0;
let derivedRenderRequest = 0;
let previewRenderRunning = false;
let previewRenderRerun = false;

const previewCssSize = (viewW: number, viewH: number, zoom: number) =>
  Math.min(Math.max(120, viewW - 530), Math.max(120, viewH - 136)) *
  0.62 *
  Math.min(2.5, Math.max(0.4, zoom));

const previewRenderSize = (viewW: number, viewH: number, zoom: number) => {
  const scale = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  return Math.max(48, Math.min(1400, Math.round(previewCssSize(viewW, viewH, zoom) * scale)));
};

export const useStore = create<State>((set, get) => {
  const renderIconCanvas = async (
    doc: IconDocument,
    size: number,
    slot: string | null,
    backdrop: { kind: BgKind; color: string; image: number } | undefined,
    options?: RenderOptions,
  ) => {
    // The Rust renderer currently rasterizes flat layers only; it has no
    // JFA/SDF, refraction, specular, blur or glass-material compositing.
    // Keep preview/export on the GPU compositor until those passes reach
    // feature parity. Rust remains useful for independent layer thumbnails.
    await ensureCompositor((e) => set({ error: e }));
    if (!compositor) throw new Error("Compositor unavailable.");
    return compositor.render(doc, size, slot, backdrop, options);
  };

  const renderIconCanvases = async (requests: RustPreviewRequest[], isCurrent = () => true): Promise<(HTMLCanvasElement | null)[]> => {
    // Render serially because every glass layer samples the canvas produced by
    // the layers below it and the renderer owns per-frame transient resources.
    const canvases: (HTMLCanvasElement | null)[] = [];
    for (const request of requests) {
      if (!isCurrent()) break;
      try {
        canvases.push(await renderIconCanvas(
          request.doc,
          request.size,
          request.slot,
          request.backdrop,
          request.options,
        ));
      } catch {
        canvases.push(null);
      }
    }
    return [...canvases, ...Array<HTMLCanvasElement | null>(requests.length - canvases.length).fill(null)];
  };

  const renderLayerThumbCanvases = async (requests: RustLayerThumbRequest[]): Promise<(HTMLCanvasElement | null)[]> => {
    try {
      const rustCanvases = await renderLayerThumbsRust(requests, assets.entries());
      if (
        rustCanvases.length === requests.length &&
        rustCanvases.every((canvas): canvas is HTMLCanvasElement => canvas !== null)
      ) {
        return rustCanvases;
      }
    } catch {
      // Fall through to the Canvas2D compatibility path.
    }

    try {
      await ensureCompositor((e) => set({ error: e }));
      if (!compositor) throw new Error("Compositor unavailable.");
      return requests.map((request) => {
        try {
          return compositor!.renderLayerThumb(request.layer, request.size, request.dark);
        } catch {
          return null;
        }
      });
    } catch {
      return requests.map(() => null);
    }
  };

  const renderPreview = async (request: number) => {
    const doc = get().doc;
    const slot = slotOf(get().appearance);
    const docA = { ...doc, lightAngleDeg: get().lightAngleDeg };
    const backdrop = { kind: get().bgKind, color: get().bgColor, image: get().bgImage };
    const { viewW, viewH } = get();
    const size = viewW > 0 && viewH > 0 ? previewRenderSize(viewW, viewH, get().zoom) : 512;

    set({ rendering: true });
    try {
      const canvas = await renderIconCanvas(docA, size, slot, backdrop);
      if (request !== previewRenderRequest) return;
      set({ previewCanvas: canvas, rendering: false, error: null });
    } catch (e: any) {
      if (request === previewRenderRequest) set({ error: String(e?.message ?? e), rendering: false });
    }
  };

  const renderDerived = async (request: number) => {
    try {
      const doc = { ...get().doc, lightAngleDeg: FIXED_RENDER_LIGHT_ANGLE };
      const ap = get().appearance;
      const slot = slotOf(ap);
      const docA = doc;
      const backdrop = { kind: get().bgKind, color: get().bgColor, image: get().bgImage };

      // Publish cheap thumbnails before the six material/platform previews.
      // Hidden artwork remains available for editing; rows express visibility.
      const thumbLayers = doc.composition.groups.flatMap((g) => g.layers.map((layer) => ({
        ...resolveLayer(layer, slot, doc.previewPlatform), isHidden: false,
      })));
      const thumbCanvases = await renderLayerThumbCanvases(thumbLayers.map((layer): RustLayerThumbRequest => ({
        layer, size: 44, dark: RENDITIONS[doc.previewRendition].dark,
      })));
      if (request !== derivedRenderRequest) return;
      const thumbs: Record<number, string> = {};
      thumbCanvases.forEach((canvas, i) => {
        if (canvas) thumbs[thumbLayers[i].id] = canvas.toDataURL("image/png");
      });
      set({ layerThumbs: thumbs });

      const variantRequests = VARIANTS.map((r): RustPreviewRequest => ({
        doc: { ...doc, previewRendition: r === "Mono" ? get().monoPreviewRendition : r },
        size: 96,
        slot: specSlot(r),
        backdrop,
      }));
      const variantCanvases = await renderIconCanvases(variantRequests, () => request === derivedRenderRequest && !document.hidden);
      if (request !== derivedRenderRequest) return;
      const vs = variantCanvases.flatMap((canvas, i) =>
        canvas ? [{ id: VARIANTS[i], url: canvas.toDataURL("image/png") }] : [],
      );
      if (request === derivedRenderRequest) set({ variants: vs });

      const platformRequests = PLATFORM_VARIANTS.map((p): RustPreviewRequest => ({
        doc: { ...docA, previewPlatform: p },
        size: 96,
        slot,
        backdrop,
      }));
      const platformCanvases = await renderIconCanvases(platformRequests, () => request === derivedRenderRequest && !document.hidden);
      if (request !== derivedRenderRequest) return;
      const pvs = platformCanvases.flatMap((canvas, i) =>
        canvas ? [{ id: PLATFORM_VARIANTS[i], url: canvas.toDataURL("image/png") }] : [],
      );
      if (request === derivedRenderRequest) set({ platformVariants: pvs });

    } catch (e: any) {
      if (request === derivedRenderRequest) set({ error: String(e?.message ?? e) });
    }
  };

  const startPreviewRender = async () => {
    if (previewRenderRunning) {
      previewRenderRerun = true;
      return;
    }
    previewRenderRunning = true;
    try {
      do {
        previewRenderRerun = false;
        await renderPreview(++previewRenderRequest);
      } while (previewRenderRerun);
    } finally {
      previewRenderRunning = false;
    }
  };

  const schedulePreviewRender = (delay = 50) => {
    if (previewRenderTimer !== undefined) return;
    previewRenderTimer = window.setTimeout(() => {
      previewRenderTimer = undefined;
      void startPreviewRender();
    }, delay);
  };

  const scheduleDerivedRender = (delay = 180) => {
    window.clearTimeout(derivedRenderTimer);
    const request = ++derivedRenderRequest;
    derivedRenderTimer = window.setTimeout(() => void renderDerived(request), delay);
  };

  const scheduleRender = (scope: RenderScope = "all") => {
    // Invalidate composition changes immediately. During a light sweep still
    // present completed frames, or slow readback could starve the preview.
    if (scope === "all") previewRenderRequest++;
    if (document.hidden) {
      derivedRenderRequest++;
      previewRenderRerun = false;
      return;
    }
    schedulePreviewRender(scope === "preview" ? 16 : 50);
    if (scope === "all") scheduleDerivedRender();
  };

  // initial render
  queueMicrotask(() => scheduleRender("all"));
  document.addEventListener("visibilitychange", () => scheduleRender("all"));

  const commitDoc = (doc: IconDocument, selectedId = get().selectedId) => {
    const current = get();
    if (doc === current.doc && selectedId === current.selectedId) return;
    set((s) => ({
      doc,
      selectedId,
      ...(doc.previewPlatform !== s.doc.previewPlatform ? { layerThumbs: {} } : {}),
      past: [...s.past.slice(-99), historySnapshot(s)],
      future: [],
      error: null,
    }));
    scheduleRender();
  };

  const resetDoc = (doc: IconDocument, selectedId = ICON_ID) => {
    memberClipboard = null;
    set({
      doc, selectedId, lightAngleDeg: doc.lightAngleDeg,
      appearance: appearanceOf(doc.previewRendition),
      monoPreviewRendition: isMonoPreview(doc.previewRendition) ? doc.previewRendition : "ClearLight",
      previewCanvas: null, variants: [], platformVariants: [], layerThumbs: {},
      past: [], future: [], hasMemberClipboard: false, error: null,
    });
    scheduleRender();
  };

  const initialDoc = sampleDocument();

  return {
    doc: initialDoc,
    selectedId: ICON_ID,
    lightAngleDeg: initialDoc.lightAngleDeg,
    animateLight: false,
    previewCanvas: null,
    viewW: 1100,
    viewH: 720,
    variants: [],
    platformVariants: [],
    layerThumbs: {},
    appearance: "All",
    monoPreviewRendition: "ClearLight",
    previewBgDark: false,
    bgKind: "color",
    bgImage: 0,
    bgColor: "#2a2a2c",
    showGrid: false,
    zoom: 1,
    error: null,
    rendering: false,
    past: [],
    future: [],
    hasMemberClipboard: false,

    select: (id) => set({ selectedId: id }),
    undo: () => {
      const current = get();
      const prev = current.past[current.past.length - 1];
      if (!prev) return;
      set({
        doc: prev.doc,
        appearance: prev.appearance,
        monoPreviewRendition: prev.monoPreviewRendition,
        layerThumbs: {},
        selectedId: prev.selectedId,
        past: current.past.slice(0, -1),
        future: [historySnapshot(current), ...current.future],
      });
      scheduleRender();
    },
    redo: () => {
      const current = get();
      const [next, ...rest] = current.future;
      if (!next) return;
      set({
        doc: next.doc,
        appearance: next.appearance,
        monoPreviewRendition: next.monoPreviewRendition,
        layerThumbs: {},
        selectedId: next.selectedId,
        past: [...current.past.slice(-99), historySnapshot(current)],
        future: rest,
      });
      scheduleRender();
    },
    deleteSelected: () => {
      const { doc, selectedId } = get();
      if (selectedId === ICON_ID) return;
      commitDoc(deleteMember(doc, selectedId), selectionAfterDelete(doc, selectedId));
    },
    copySelected: () => {
      memberClipboard = copyMember(get().doc, get().selectedId);
      set({ hasMemberClipboard: !!memberClipboard });
      return !!memberClipboard;
    },
    pasteCopied: () => {
      if (!memberClipboard) return false;
      const pasted = pasteMember(get().doc, memberClipboard, get().selectedId);
      commitDoc(pasted.doc, pasted.selectedId);
      return true;
    },
    setLightAngle: (angle) => {
      const next = normalizeInternalAngle(angle);
      if (get().lightAngleDeg === next) return;
      set({ lightAngleDeg: next });
      scheduleRender("preview");
    },
    setAnimateLight: (enabled) => set({ animateLight: enabled }),
    setZoom: (z) => { set({ zoom: Math.max(0.25, Math.min(4, z)) }); scheduleRender("preview"); },
    setViewport: (w, h) => { if (w === get().viewW && h === get().viewH) return; set({ viewW: w, viewH: h }); scheduleRender("preview"); },
    setAppearance: (a) => {
      const r = a === "Mono" ? get().monoPreviewRendition : renditionOf(a);
      set({ appearance: a, doc: { ...get().doc, previewRendition: r }, layerThumbs: {} });
      scheduleRender();
    },
    setPreviewRendition: (r) => {
      const preview = r === "Mono" ? get().monoPreviewRendition : r;
      set({
        appearance: appearanceOf(preview), doc: { ...get().doc, previewRendition: preview },
        layerThumbs: {},
        ...(isMonoPreview(preview) ? { monoPreviewRendition: preview } : {}),
      });
      scheduleRender();
    },
    setPreviewBgDark: (v) => set({ previewBgDark: v }),
    setBg: (p) => { set(p as any); scheduleRender(); }, // backdrop feeds the glass refraction -> re-render
    toggleGrid: () => set({ showGrid: !get().showGrid }),
    reorder: (dragId, targetId, before) => commitDoc(moveMember(get().doc, dragId, targetId, before)),
    importAssets: async (items) => {
      const used = new Set([
        ...assets.entries().map((asset) => asset.name),
        ...iconAssetNames(encodeIcon(get().doc)),
      ].map((name) => name.toLowerCase()));
      const valid = items
        .map((i) => ({ ...i, name: fileNameOf(i.name) }))
        .filter((i) => isImportableAssetName(i.name))
        .map((i) => ({ ...i, name: uniqueAssetName(i.name, used) }));
      if (!valid.length) return;

      const imported: ImportAsset[] = [];
      const failed: string[] = [];
      for (const it of valid) {
        try {
          await assets.add(it.name, it.dataUrl);
          imported.push(it);
        } catch {
          failed.push(it.name);
        }
      }

      if (imported.length) {
        const doc = addImageLayers(get().doc, imported.map((i) => i.name));
        commitDoc(doc, doc.composition.groups[0]?.layers[0]?.id ?? get().selectedId);
        if (failed.length) set({ error: `Import failed: ${failed.join(", ")}` });
      } else if (failed.length) {
        set({ error: `Import failed: ${failed.join(", ")}` });
      }
    },

    importAssetPaths: async (paths) => {
      const valid = paths.filter(isImportableAssetName);
      if (!valid.length) return;
      try {
        const imported = await invoke<EncodedAsset[]>("read_image_assets", { paths: valid });
        await get().importAssets(imported.map((a) => ({ name: a.name, dataUrl: dataUrl(a.name, a.data) })));
      } catch (e: any) {
        set({ error: `Import failed: ${e?.message ?? e}` });
      }
    },
    update: (fn) => commitDoc(fn(get().doc)),
    setDoc: (doc) => resetDoc(doc),

    openIcon: async () => {
      // A `.icon` is a directory (a folder on Windows / a package on macOS), so pick a folder.
      const dir = await open({ directory: true, multiple: false, title: "Open a .icon folder" });
      const path = Array.isArray(dir) ? dir[0] : dir;
      if (!path) return;
      try {
        const pkg = await invoke<{ name: string; json: string; assets: { name: string; data: string }[] }>("read_icon", { path });
        await assets.set(pkg.assets.map((a) => ({ name: a.name, dataUrl: dataUrl(a.name, a.data) })));
        resetDoc(decodeIcon(pkg.json, pkg.name));
      } catch (e: any) {
        set({ error: `Open failed: ${e?.message ?? e}` });
      }
    },

    saveIcon: async () => {
      const doc = get().doc;
      let path = await save({ defaultPath: `${doc.name}.icon`, filters: [{ name: "Refract", extensions: ["icon"] }] });
      if (!path) return;
      if (!path.toLowerCase().endsWith(".icon")) path += ".icon";
      try {
        // Use the serialized references so appearance/platform and preserved
        // locale/direction image overrides are packaged with their source art.
        const json = encodeIcon(doc);
        const assetIn = await Promise.all(iconAssetNames(json).map(async (name) => ({ name, data: await assetBase64(name) })));
        await invoke("save_icon", { path, json, assets: assetIn });
      } catch (e: any) {
        set({ error: `Save failed: ${e?.message ?? e}` });
      }
    },

    exportPng: async (options = {
      variants: [get().doc.previewRendition],
      clipChiclet: true,
      layered: false,
    }) => {
      if (!options.variants.length) return;
      const dir = await open({ directory: true, multiple: false, title: "Choose an export folder" });
      const folder = Array.isArray(dir) ? dir[0] : dir;
      if (!folder) return;
      const doc = get().doc;
      try {
        const files: { name: string; data: string }[] = [];
        if (!options.layered) {
          const exportJobs: { name: string; request: RustPreviewRequest }[] = [];
          for (const variant of options.variants) {
            const base = { ...doc, previewRendition: variant, lightAngleDeg: FIXED_RENDER_LIGHT_ANGLE };
            const slot = specSlot(variant);
            for (const p of doc.supportedPlatforms) {
              exportJobs.push({
                name: `${doc.name}-${p}-${variant}.png`,
                request: {
                  doc: { ...base, previewPlatform: p },
                  size: 1024,
                  slot,
                  options: { clipChiclet: options.clipChiclet },
                },
              });
            }
          }

          const canvases = await renderIconCanvases(exportJobs.map((job) => job.request));
          exportJobs.forEach((job, i) => {
            const canvas = canvases[i];
            if (!canvas) throw new Error(`Render failed for ${job.name}`);
            files.push({
              name: job.name,
              data: canvas.toDataURL("image/png").split(",")[1],
            });
          });
          await invoke("export_pngs", { dir: folder, files });
          return;
        }

        for (const variant of options.variants) {
          const base = { ...doc, previewRendition: variant, lightAngleDeg: FIXED_RENDER_LIGHT_ANGLE };
          const slot = specSlot(variant);
          for (const p of doc.supportedPlatforms) {
            const render = async (layer: "combined" | "foreground" | "background", suffix = "") => {
              await ensureCompositor((e) => set({ error: e }));
              if (!compositor) throw new Error("Compositor unavailable.");
              const canvas = await compositor!.render({ ...base, previewPlatform: p }, 1024, slot, undefined, {
                layer,
                clipChiclet: options.clipChiclet,
                chicletHighlight: options.clipChiclet,
              });
              files.push({
                name: `${doc.name}-${p}-${variant}${suffix}.png`,
                data: canvas.toDataURL("image/png").split(",")[1],
              });
            };
            if (options.layered) {
              await ensureCompositor((e) => set({ error: e }));
              if (!compositor) throw new Error("Compositor unavailable.");
              const renderOptions = {
                clipChiclet: options.clipChiclet,
                chicletHighlight: options.clipChiclet,
              };
              const combined = await compositor.render(
                { ...base, previewPlatform: p },
                1024,
                slot,
                undefined,
                { ...renderOptions, layer: "combined" },
              );
              const background = await compositor.render(
                { ...base, previewPlatform: p },
                1024,
                slot,
                undefined,
                { ...renderOptions, layer: "background" },
              );
              const foregroundMask = await compositor.render(
                { ...base, previewPlatform: p },
                1024,
                slot,
                undefined,
                {
                  layer: "foreground",
                  clipChiclet: options.clipChiclet,
                  chicletHighlight: false,
                  materialAlphaMask: true,
                },
              );
              const layers = extractForegroundLayer(combined, background, foregroundMask);
              files.push({
                name: `${doc.name}-${p}-${variant}-foreground.png`,
                data: layers.foreground.toDataURL("image/png").split(",")[1],
              });
              files.push({
                name: `${doc.name}-${p}-${variant}-background.png`,
                data: layers.background.toDataURL("image/png").split(",")[1],
              });
            } else {
              if (options.clipChiclet) {
                const canvas = await renderIconCanvas({ ...base, previewPlatform: p }, 1024, slot, undefined);
                files.push({
                  name: `${doc.name}-${p}-${variant}.png`,
                  data: canvas.toDataURL("image/png").split(",")[1],
                });
              } else {
                await render("combined");
              }
            }
          }
        }
        await invoke("export_pngs", { dir: folder, files });
      } catch (e: any) {
        set({ error: `Export failed: ${e?.message ?? e}` });
      }
    },
  };
});

function dataUrl(name: string, base64: string): string {
  const mime = name.toLowerCase().endsWith(".svg") ? "image/svg+xml" : name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${base64}`;
}

// re-encode a loaded asset back to base64 (for save).
async function assetBase64(name: string): Promise<string> {
  const src = assets.srcOf(name);
  if (!src) throw new Error(`Referenced asset is missing: ${name}`);
  const res = await fetch(src);
  if (!res.ok) throw new Error(`Failed to read referenced asset: ${name}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (!buf.length) throw new Error(`Referenced asset is empty: ${name}`);
  let bin = "";
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin);
}

export { ICON_ID };
