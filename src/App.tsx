import { useRef, useState, useEffect, useCallback, type CSSProperties } from "react";
import { ImagePlus } from "lucide-react";
import { Hierarchy } from "./ui/Hierarchy";
import { Preview } from "./ui/Preview";
import { Inspector } from "./ui/Inspector";
import { WindowChrome, detectChromePlatform } from "./ui/WindowChrome";
import { NativeTooltipProvider, openNativeContextMenu, type NativeContextMenuItem } from "./ui/nativePopover";
import { ICON_ID, useStore } from "./state/store";
import { addGroup, addLayer } from "./model/document";
import { backdropCss, isDarkBackdrop } from "./render/backdrop";
import { checkForAppUpdates } from "./updater";

type ImportAsset = { name: string; dataUrl: string };
type ContextMenuAction = NativeContextMenuItem & {
  onSelect: () => void;
};

const readAsDataUrl = (f: File, fallbackName = f.name) =>
  new Promise<{ name: string; dataUrl: string }>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res({ name: f.name || fallbackName, dataUrl: String(r.result) });
    r.onerror = () => rej(r.error ?? new Error(`Failed to read ${f.name}`));
    r.readAsDataURL(f);
  });
const isImportableAsset = (name: string) => /\.(svg|png)$/i.test(name);
const INTERNAL_CLIPBOARD_TYPE = "application/x-refract-member";
const extForMime = (mime: string) => mime === "image/svg+xml" ? "svg" : mime === "image/png" ? "png" : null;
const extForName = (name: string) => name.toLowerCase().endsWith(".svg") ? "svg" : name.toLowerCase().endsWith(".png") ? "png" : null;
const isTextEditingTarget = (target: EventTarget | null) =>
  target instanceof Element && !!target.closest("input, textarea, select, [contenteditable]");
const dataTransferString = (item: DataTransferItem) =>
  new Promise<string>((res) => item.getAsString(res));
const looksLikeSvg = (text: string) => /^\s*<svg[\s>]/i.test(text);

async function readClipboardAssets(data: DataTransfer | null): Promise<ImportAsset[]> {
  if (!data) return [];
  const items = Array.from(data.items);
  const stamp = Date.now();
  const fileItems = items
    .filter((item) => item.kind === "file")
    .map((item) => ({ item, file: item.getAsFile() }))
    .filter((entry): entry is { item: DataTransferItem; file: File } =>
      !!entry.file && (!!extForMime(entry.item.type) || !!extForName(entry.file.name)));

  if (fileItems.length) {
    return Promise.all(fileItems.map(({ item, file }, i) => {
      const ext = extForMime(item.type) ?? extForName(file.name) ?? "png";
      const name = isImportableAsset(file.name) ? file.name : `pasted-image-${stamp}-${i + 1}.${ext}`;
      return readAsDataUrl(file, name);
    }));
  }

  const svgItems = items.filter((item) => item.kind === "string" && (item.type === "image/svg+xml" || item.type === "text/plain"));
  const assets: ImportAsset[] = [];
  for (const item of svgItems) {
    const text = await dataTransferString(item);
    if (!looksLikeSvg(text)) continue;
    const file = new File([text], `pasted-image-${stamp}-${assets.length + 1}.svg`, { type: "image/svg+xml" });
    assets.push(await readAsDataUrl(file));
  }
  return assets;
}

export function App() {
  const importAssets = useStore((s) => s.importAssets);
  const importAssetPaths = useStore((s) => s.importAssetPaths);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const deleteSelected = useStore((s) => s.deleteSelected);
  const copySelected = useStore((s) => s.copySelected);
  const pasteCopied = useStore((s) => s.pasteCopied);
  const hasMemberClipboard = useStore((s) => s.hasMemberClipboard);
  const pastCount = useStore((s) => s.past.length);
  const futureCount = useStore((s) => s.future.length);
  const update = useStore((s) => s.update);
  const bgKind = useStore((s) => s.bgKind);
  const bgColor = useStore((s) => s.bgColor);
  const bgImage = useStore((s) => s.bgImage);
  const previewCanvas = useStore((s) => s.previewCanvas);
  const viewW = useStore((s) => s.viewW);
  const viewH = useStore((s) => s.viewH);
  const zoom = useStore((s) => s.zoom);
  const setViewport = useStore((s) => s.setViewport);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const platform = detectChromePlatform();
  const resetDrag = useCallback(() => {
    depth.current = 0;
    setDragging(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void checkForAppUpdates(), 2000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const update = () => setViewport(el.clientWidth, el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [setViewport]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        unlisten = await getCurrentWindow().onDragDropEvent(async ({ payload }) => {
          if (payload.type === "enter") {
            depth.current = 1;
            setDragging(payload.paths.some(isImportableAsset));
            return;
          }
          if (payload.type === "leave") {
            resetDrag();
            return;
          }
          if (payload.type === "drop") {
            resetDrag();
            await importAssetPaths(payload.paths);
          }
        });
        if (cancelled) {
          unlisten();
          unlisten = null;
        }
      } catch {
        // Running in plain Vite/browser preview; the HTML5 drop fallback below still works.
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [importAssetPaths, resetDrag]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTextEditingTarget(e.target)) return;
      const key = e.key.toLowerCase();
      const mod = e.metaKey || e.ctrlKey;
      if (!mod && !e.altKey && !e.shiftKey && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        deleteSelected();
        return;
      }
      if (!mod || e.altKey) return;
      if (key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (!e.shiftKey && key === "y") {
        e.preventDefault();
        redo();
        return;
      }
    };

    const onCopy = (e: ClipboardEvent) => {
      if (isTextEditingTarget(e.target)) return;
      if (!copySelected()) return;
      e.preventDefault();
      e.clipboardData?.setData(INTERNAL_CLIPBOARD_TYPE, "selection");
      e.clipboardData?.setData("text/plain", "Refract selection");
    };

    const onPaste = (e: ClipboardEvent) => {
      if (isTextEditingTarget(e.target)) return;
      e.preventDefault();
      void (async () => {
        const types = Array.from(e.clipboardData?.types ?? []);
        const isInternalPaste =
          types.includes(INTERNAL_CLIPBOARD_TYPE) ||
          e.clipboardData?.getData("text/plain") === "Refract selection";
        if (isInternalPaste && pasteCopied()) return;
        const assets = await readClipboardAssets(e.clipboardData);
        if (assets.length) await importAssets(assets);
      })();
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
    };
  }, [copySelected, deleteSelected, importAssets, pasteCopied, redo, undo]);

  useEffect(() => {
    const actionsFor = (targetId: number): ContextMenuAction[] => [
      { id: "add-part", label: "Add Part", onSelect: () => update(addLayer) },
      { id: "add-group", label: "Add Group", onSelect: () => update(addGroup) },
      { id: "copy", label: "Copy", disabled: targetId === ICON_ID, separatorBefore: true, onSelect: copySelected },
      { id: "paste", label: "Paste", disabled: !hasMemberClipboard, onSelect: pasteCopied },
      { id: "delete", label: "Delete", disabled: targetId === ICON_ID, danger: true, onSelect: deleteSelected },
      { id: "undo", label: "Undo", disabled: pastCount === 0, separatorBefore: true, onSelect: undo },
      { id: "redo", label: "Redo", disabled: futureCount === 0, onSelect: redo },
    ];
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const row = e.target instanceof Element
        ? e.target.closest<HTMLElement>("[data-hierarchy-row-id]")
        : null;
      const rowId = row ? Number(row.dataset.hierarchyRowId) : NaN;
      const targetId = Number.isFinite(rowId) ? rowId : selectedId;
      if (Number.isFinite(rowId)) select(rowId);
      const actions = actionsFor(targetId);
      void openNativeContextMenu(e.clientX, e.clientY, actions.map((item) => ({
        id: item.id,
        label: item.label,
        disabled: item.disabled,
        danger: item.danger,
        separatorBefore: item.separatorBefore,
      }))).then((picked) => {
        const action = actions.find((item) => item.id === picked);
        if (!action || action.disabled) return;
        action.onSelect();
      });
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, [copySelected, deleteSelected, futureCount, hasMemberClipboard, pasteCopied, pastCount, redo, select, selectedId, undo, update]);

  const spec = { kind: bgKind, color: bgColor, image: bgImage };
  const iconCssSize = previewCssSize(viewW, viewH, zoom);
  const previewLeft = 230;
  const previewRight = 300;
  const previewTop = 44;
  const previewBottom = 92;
  const previewW = Math.max(120, viewW - previewLeft - previewRight);
  const previewH = Math.max(120, viewH - previewTop - previewBottom);
  const previewIconStyle: CSSProperties = {
    width: iconCssSize,
    height: iconCssSize,
    left: previewLeft + previewW / 2 - iconCssSize / 2,
    top: previewTop + previewH / 2 - iconCssSize / 2,
  };
  // only handle OS file drags here; internal hierarchy drag-reorder is left to the rows.
  const isFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  const onDrop = async (e: React.DragEvent) => {
    if (!isFiles(e)) return;
    e.preventDefault();
    resetDrag();
    const files = Array.from(e.dataTransfer.files).filter((f) => isImportableAsset(f.name));
    if (!files.length) return;
    await importAssets(await Promise.all(files.map((f) => readAsDataUrl(f))));
  };

  return (
    <div ref={rootRef} className={`h-full w-full flex overflow-hidden relative ${isDarkBackdrop(spec) ? "ui-dark" : ""}`}
      style={{ background: backdropCss(spec), color: "var(--tx)" }}
      onDragEnter={(e) => { if (!isFiles(e)) return; e.preventDefault(); depth.current++; setDragging(true); }}
      onDragOver={(e) => { if (isFiles(e)) e.preventDefault(); }}
      onDragLeave={(e) => { if (!isFiles(e)) return; depth.current--; if (depth.current <= 0) setDragging(false); }}
      onDrop={onDrop}>
      {previewCanvas && <PreviewCanvas source={previewCanvas} style={previewIconStyle} />}
      <NativeTooltipProvider />
      <WindowChrome platform={platform} />
      <Hierarchy chromePlatform={platform} />
      <Preview chromePlatform={platform} />
      <Inspector chromePlatform={platform} />
      {dragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-accent/10 backdrop-blur-[2px] pointer-events-none">
          <div className="px-6 py-4 rounded-2xl bg-[color:var(--popover)] shadow-xl border-2 border-dashed border-accent text-[15px] font-medium text-accent flex items-center gap-2">
            <ImagePlus size={20} /> Drop SVG / PNG to import
          </div>
        </div>
      )}
    </div>
  );
}

const previewCssSize = (viewW: number, viewH: number, zoom: number) =>
  Math.min(Math.max(120, viewW - 530), Math.max(120, viewH - 136)) *
  0.62 *
  Math.min(2.5, Math.max(0.4, zoom));

function PreviewCanvas({ source, style }: { source: HTMLCanvasElement; style: CSSProperties }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0);
  }, [source]);

  return (
    <canvas
      ref={canvasRef}
      width={source.width}
      height={source.height}
      className="absolute z-0 select-none pointer-events-none"
      style={style}
    />
  );
}
