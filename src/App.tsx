import { useRef, useState, useEffect } from "react";
import { ImagePlus } from "lucide-react";
import { Hierarchy } from "./ui/Hierarchy";
import { Preview } from "./ui/Preview";
import { Inspector } from "./ui/Inspector";
import { WindowChrome, detectChromePlatform } from "./ui/WindowChrome";
import { NativeTooltipProvider } from "./ui/nativePopover";
import { useStore } from "./state/store";
import { backdropCss, isDarkBackdrop } from "./render/backdrop";

const readAsDataUrl = (f: File) =>
  new Promise<{ name: string; dataUrl: string }>((res) => {
    const r = new FileReader();
    r.onload = () => res({ name: f.name, dataUrl: String(r.result) });
    r.readAsDataURL(f);
  });

export function App() {
  const importAssets = useStore((s) => s.importAssets);
  const bgKind = useStore((s) => s.bgKind);
  const bgColor = useStore((s) => s.bgColor);
  const bgImage = useStore((s) => s.bgImage);
  const sceneUrl = useStore((s) => s.sceneUrl);
  const setViewport = useStore((s) => s.setViewport);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const platform = detectChromePlatform();

  // the whole window is ONE scene canvas (backdrop + centred icon), so changing the background
  // re-renders everything together instead of leaving the icon lagging behind a CSS backdrop.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const update = () => setViewport(el.clientWidth, el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [setViewport]);

  const spec = { kind: bgKind, color: bgColor, image: bgImage };
  const reset = () => { depth.current = 0; setDragging(false); };
  // only handle OS file drags here; internal hierarchy drag-reorder is left to the rows.
  const isFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  const onDrop = async (e: React.DragEvent) => {
    if (!isFiles(e)) return;
    e.preventDefault();
    reset();
    const files = Array.from(e.dataTransfer.files).filter((f) => /\.(svg|png)$/i.test(f.name));
    if (!files.length) return;
    importAssets(await Promise.all(files.map(readAsDataUrl)));
  };

  return (
    <div ref={rootRef} className={`h-full w-full flex overflow-hidden relative ${isDarkBackdrop(spec) ? "ui-dark" : ""}`}
      style={{ background: backdropCss(spec), color: "var(--tx)" }}
      onDragEnter={(e) => { if (!isFiles(e)) return; e.preventDefault(); depth.current++; setDragging(true); }}
      onDragOver={(e) => { if (isFiles(e)) e.preventDefault(); }}
      onDragLeave={(e) => { if (!isFiles(e)) return; depth.current--; if (depth.current <= 0) setDragging(false); }}
      onDrop={onDrop}>
      {/* full-window scene canvas (backdrop + icon) behind the transparent panels */}
      {sceneUrl && <img src={sceneUrl} alt="" draggable={false} className="absolute inset-0 w-full h-full z-0 select-none pointer-events-none" />}
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
