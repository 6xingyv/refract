import { create } from "zustand";
import type { IconDocument, Rendition, Platform, Appearance } from "../model/types";
import { allLayers, slotOf, renditionOf } from "../model/types";

const VARIANTS: Rendition[] = ["Default", "Dark", "Mono"];
const PLATFORM_VARIANTS: Platform[] = ["iOS", "macOS", "watchOS"];
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
import { encodeIcon, decodeIcon } from "../model/io";
import { Renderer } from "../render/renderer";
import { Compositor, AssetStore } from "../render/compositor";
import { open, save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

const assets = new AssetStore();
let compositor: Compositor | null = null;
let initOnce: Promise<void> | null = null;

type ImportAsset = { name: string; dataUrl: string };
type EncodedAsset = { name: string; data: string };
type HistorySnapshot = { doc: IconDocument; selectedId: number };

const isImportableAssetName = (name: string) => /\.(svg|png)$/i.test(name);
const fileNameOf = (name: string) => name.split(/[\\/]/).pop() || name;
const splitAssetName = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? { stem: name.slice(0, dot), ext: name.slice(dot) } : { stem: name, ext: "" };
};
const uniqueAssetName = (name: string, used: Set<string>) => {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const { stem, ext } = splitAssetName(name);
  let i = 2;
  while (used.has(`${stem}-${i}${ext}`)) i++;
  const next = `${stem}-${i}${ext}`;
  used.add(next);
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
        // WebGPU unavailable -> non-glass fallback (tinted shapes only)
        setError(`WebGPU unavailable: ${e?.message ?? e}. Glass effects disabled.`);
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
  previewUrl: string | null;
  sceneUrl: string | null;
  viewW: number;
  viewH: number;
  variants: { id: Rendition; url: string }[];
  platformVariants: { id: Platform; url: string }[];
  layerThumbs: Record<number, string>;
  appearance: Appearance;
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
  setZoom: (z: number) => void;
  setViewport: (w: number, h: number) => void;
  setAppearance: (a: Appearance) => void;
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
  exportPng: () => Promise<void>;
}

let renderTimer: number | undefined;

export const useStore = create<State>((set, get) => {
  const scheduleRender = () => {
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(async () => {
      await ensureCompositor((e) => set({ error: e }));
      if (!compositor) return;
      set({ rendering: true });
      try {
        const doc = get().doc;
        const ap = get().appearance;
        const slot = slotOf(ap);
        const docA = { ...doc, previewRendition: renditionOf(ap) };
        const backdrop = { kind: get().bgKind, color: get().bgColor, image: get().bgImage };
        const { viewW, viewH } = get();
        if (viewW > 0 && viewH > 0) {
          // one full-pane scene canvas: backdrop + centred icon (no separate CSS backdrop to lag)
          const scene = await compositor.renderScene(docA, viewW, viewH, slot, backdrop, get().zoom);
          set({ sceneUrl: scene.toDataURL("image/png"), rendering: false });
        } else {
          const canvas = await compositor.render(docA, 512, slot, backdrop);
          set({ previewUrl: canvas.toDataURL("image/png"), rendering: false });
        }
        // appearance-variant thumbnails (right of the bottom strip): each rendition at its natural slot
        const vs: { id: Rendition; url: string }[] = [];
        for (const r of VARIANTS) {
          try { const c = await compositor.render({ ...doc, previewRendition: r }, 96, undefined, backdrop); vs.push({ id: r, url: c.toDataURL("image/png") }); } catch {}
        }
        set({ variants: vs });
        // platform-variant thumbnails (left of the bottom strip), at the current appearance
        const pvs: { id: Platform; url: string }[] = [];
        for (const p of PLATFORM_VARIANTS) {
          try { const c = await compositor.render({ ...docA, previewPlatform: p }, 96, slot, backdrop); pvs.push({ id: p, url: c.toDataURL("image/png") }); } catch {}
        }
        set({ platformVariants: pvs });
        // per-layer thumbnails for the hierarchy
        const thumbs: Record<number, string> = {};
        for (const g of doc.composition.groups) for (const l of g.layers) {
          try { thumbs[l.id] = compositor.renderLayerThumb(l, 44).toDataURL("image/png"); } catch {}
        }
        set({ layerThumbs: thumbs });
      } catch (e: any) {
        set({ error: String(e?.message ?? e), rendering: false });
      }
    }, 60);
  };

  // initial render
  queueMicrotask(scheduleRender);

  const commitDoc = (doc: IconDocument, selectedId = get().selectedId) => {
    const current = get();
    if (doc === current.doc && selectedId === current.selectedId) return;
    set((s) => ({
      doc,
      selectedId,
      past: [...s.past.slice(-99), { doc: s.doc, selectedId: s.selectedId }],
      future: [],
      error: null,
    }));
    scheduleRender();
  };

  const resetDoc = (doc: IconDocument, selectedId = ICON_ID) => {
    memberClipboard = null;
    set({ doc, selectedId, past: [], future: [], hasMemberClipboard: false });
    scheduleRender();
  };

  return {
    doc: sampleDocument(),
    selectedId: ICON_ID,
    previewUrl: null,
    sceneUrl: null,
    viewW: 1100,
    viewH: 720,
    variants: [],
    platformVariants: [],
    layerThumbs: {},
    appearance: "All",
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
        selectedId: prev.selectedId,
        past: current.past.slice(0, -1),
        future: [{ doc: current.doc, selectedId: current.selectedId }, ...current.future],
      });
      scheduleRender();
    },
    redo: () => {
      const current = get();
      const [next, ...rest] = current.future;
      if (!next) return;
      set({
        doc: next.doc,
        selectedId: next.selectedId,
        past: [...current.past.slice(-99), { doc: current.doc, selectedId: current.selectedId }],
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
    setZoom: (z) => { set({ zoom: Math.max(0.25, Math.min(4, z)) }); scheduleRender(); },
    setViewport: (w, h) => { if (w === get().viewW && h === get().viewH) return; set({ viewW: w, viewH: h }); scheduleRender(); },
    setAppearance: (a) => { set({ appearance: a, doc: { ...get().doc, previewRendition: renditionOf(a) } }); scheduleRender(); },
    setPreviewBgDark: (v) => set({ previewBgDark: v }),
    setBg: (p) => { set(p as any); scheduleRender(); }, // backdrop feeds the glass refraction -> re-render
    toggleGrid: () => set({ showGrid: !get().showGrid }),
    reorder: (dragId, targetId, before) => commitDoc(moveMember(get().doc, dragId, targetId, before)),
    importAssets: async (items) => {
      const used = new Set(allLayers(get().doc).map((l) => l.imageName).filter(Boolean) as string[]);
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
      if (!path.endsWith(".icon")) path += ".icon";
      try {
        // gather referenced asset bytes
        const names = new Set(allLayers(doc).map((l) => l.imageName).filter(Boolean) as string[]);
        const assetIn = await Promise.all([...names].map(async (n) => ({ name: n, data: await assetBase64(n) })));
        await invoke("save_icon", { path, json: encodeIcon(doc), assets: assetIn.filter((a) => a.data) });
      } catch (e: any) {
        set({ error: `Save failed: ${e?.message ?? e}` });
      }
    },

    exportPng: async () => {
      await ensureCompositor((e) => set({ error: e }));
      if (!compositor) return;
      const dir = await open({ directory: true, multiple: false, title: "Choose an export folder" });
      const folder = Array.isArray(dir) ? dir[0] : dir;
      if (!folder) return;
      const doc = get().doc;
      const ap = get().appearance;
      const slot = slotOf(ap);
      const base = { ...doc, previewRendition: renditionOf(ap) };
      try {
        const files: { name: string; data: string }[] = [];
        for (const p of doc.supportedPlatforms) {
          const canvas = await compositor.render({ ...base, previewPlatform: p }, 1024, slot);
          files.push({ name: `${doc.name}-${p}-${ap}.png`, data: canvas.toDataURL("image/png").split(",")[1] });
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
  if (!src) return "";
  const res = await fetch(src);
  const buf = new Uint8Array(await res.arrayBuffer());
  let bin = "";
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin);
}

export { ICON_ID };
