import { useRef } from "react";
import { Grid3x3, ChevronUp, ChevronDown, FolderOpen, Save, Download } from "lucide-react";
import { useStore } from "../state/store";
import type { Rendition, Platform, Appearance } from "../model/types";
import { PLATFORMS, renditionOf } from "../model/types";
import { BG_PRESETS, presetCss } from "../render/backdrop";
import gridSquare from "../assets/grid-square.png";
import gridCircle from "../assets/grid-circle.png";
import type { ChromePlatform } from "./WindowChrome";
import { openNativeColorPicker, openNativeWallpaper } from "./nativePopover";

const SQUARE_PLATS: Platform[] = ["iOS", "macOS"];

export function Preview({ chromePlatform: _chromePlatform }: { chromePlatform: ChromePlatform }) {
  const doc = useStore((s) => s.doc);
  const previewCanvas = useStore((s) => s.previewCanvas);
  const lightAngleDeg = useStore((s) => s.lightAngleDeg);
  const viewW = useStore((s) => s.viewW);
  const viewH = useStore((s) => s.viewH);
  const variants = useStore((s) => s.variants);
  const platformVariants = useStore((s) => s.platformVariants);
  const zoom = useStore((s) => s.zoom);
  const setZoom = useStore((s) => s.setZoom);
  const update = useStore((s) => s.update);
  const setLightAngle = useStore((s) => s.setLightAngle);
  const rendering = useStore((s) => s.rendering);
  const error = useStore((s) => s.error);
  const openIcon = useStore((s) => s.openIcon);
  const saveIcon = useStore((s) => s.saveIcon);
  const exportPng = useStore((s) => s.exportPng);
  const appearance = useStore((s) => s.appearance);
  const setAppearance = useStore((s) => s.setAppearance);
  const bgKind = useStore((s) => s.bgKind);
  const bgImage = useStore((s) => s.bgImage);
  const bgColor = useStore((s) => s.bgColor);
  const setBg = useStore((s) => s.setBg);
  const showGrid = useStore((s) => s.showGrid);
  const toggleGrid = useStore((s) => s.toggleGrid);

  const wallpaperRef = useRef<HTMLButtonElement>(null);
  const colorRef = useRef<HTMLButtonElement>(null);
  const setPlat = (p: Platform) => update((d) => ({ ...d, previewPlatform: p }));

  // bottom-left platform tiles: merge iOS+macOS into one square when squares are "shared".
  const supported = doc.supportedPlatforms;
  const squares = SQUARE_PLATS.filter((p) => supported.includes(p));
  const platTiles: { key: string; label: string; platform: Platform; circle: boolean }[] = [];
  if (doc.squaresShared && squares.length) {
    platTiles.push({ key: "shared", label: squares.map((p) => PLATFORMS[p].displayName).join(", "), platform: squares[0], circle: false });
  } else {
    for (const p of squares) platTiles.push({ key: p, label: PLATFORMS[p].displayName, platform: p, circle: false });
  }
  if (supported.includes("watchOS")) platTiles.push({ key: "watchOS", label: "watchOS", platform: "watchOS", circle: true });
  const pvUrl = (p: Platform) => platformVariants.find((v) => v.id === p)?.url;

  const selRend = renditionOf(appearance);
  const darkBackdrop = bgKind === "image" || luminance(bgColor) < 0.5;
  // grid overlay sized to match the scene icon (centre pane = window minus the side panels/bars)
  const gridPx = Math.min(Math.max(120, (viewW || 0) - 530), Math.max(120, (viewH || 0) - 136)) * 0.62 * Math.min(2.5, Math.max(0.4, zoom));

  return (
    <div className="flex-1 min-w-0 flex flex-col relative z-10">
      <div className="h-11 flex items-center px-4 gap-2 shrink-0 relative z-10">
        <div className="flex items-center gap-2 shrink-0 relative grow min-w-0" data-tauri-drag-region>
          <span className="text-[13px] font-semibold text-[color:var(--tx)] truncate">{doc.name}</span>
          <SmallBtn onClick={openIcon}><FolderOpen size={13} />Open</SmallBtn>
          <SmallBtn onClick={saveIcon}><Save size={13} />Save</SmallBtn>
          <SmallBtn onClick={exportPng}><Download size={13} />Export</SmallBtn>

          <div className="flex-1" />
        </div>


        {/* 1st selector: background — left colour (editable) / right built-in image */}
        <div className="relative flex h-[26px] items-center control-pill p-[3px] gap-[3px]" data-tauri-no-drag>
          <button
            ref={colorRef}
            aria-label="Background colour"
            data-tooltip="Background colour"
            className={`w-[22px] h-[20px] rounded-s-xl rounded-e-md cursor-pointer ${bgKind === "color" ? "ring-2 ring-accent" : ""}`}
            style={{ background: bgColor }}
            onClick={async () => {
              setBg({ bgKind: "color" });
              const next = colorRef.current ? await openNativeColorPicker(colorRef.current, bgColor) : null;
              if (next) setBg({ bgKind: "color", bgColor: next });
            }}
          />
          <button
            ref={wallpaperRef}
            aria-label="Background image"
            data-tooltip="Background image"
            onClick={async () => {
              setBg({ bgKind: "image" });
              const selected = wallpaperRef.current
                ? await openNativeWallpaper(wallpaperRef.current, BG_PRESETS.map(presetCss), bgImage)
                : null;
              if (selected != null) setBg({ bgKind: "image", bgImage: selected });
            }}
            className={`w-[22px] h-[20px] rounded-s-md rounded-e-xl ${bgKind === "image" ? "ring-2 ring-accent" : ""}`}
            style={{ background: presetCss(BG_PRESETS[bgImage]) }} />
        </div>

        {/* 2nd selector: grid show/hide toggle */}
        <button aria-label="Show grid" data-tooltip="Show grid" onClick={toggleGrid}
          className={`control-pill flex items-center justify-center w-[30px] h-[26px] ${showGrid ? "control-pill-active text-accent" : "text-[color:var(--tx-2)]"}`}>
          <GridIcon />
        </button>

        {/* light angle */}
        <LightAngleControl
          value={lightAngleDeg}
          onChange={setLightAngle}
        />

        {/* zoom */}
        <div className="control-pill flex items-center h-[26px] pl-2.5 pr-1.5 gap-1" data-tauri-no-drag>
          <span className="text-[12px] text-[color:var(--tx-2)] tabular-nums w-9 text-right">{Math.round(zoom * 100)}%</span>
          <span className="text-[color:var(--tx-3)] flex flex-col">
            <button onClick={() => setZoom(zoom + 0.25)}><ChevronUp size={11} /></button>
            <button onClick={() => setZoom(zoom - 0.25)}><ChevronDown size={11} /></button>
          </span>
        </div>
      </div>

      {/* icon area */}
      <div className="flex-1 flex items-center justify-center min-h-0 relative z-10 pointer-events-none">
        <div className="relative" style={{ width: gridPx, height: gridPx }}>
          {showGrid && <GridGuide src={PLATFORMS[doc.previewPlatform].circle ? gridCircle : gridSquare} dark={darkBackdrop} />}
        </div>
        {!previewCanvas && <span className="absolute text-sm text-[color:var(--tx-3)]">{rendering ? "rendering..." : ""}</span>}
      </div>

      {/* bottom bar: platforms (left) <-> appearances (right) */}
      <div className="h-[92px] flex items-end justify-between px-6 pb-4 relative z-10">
        <div className="flex gap-3">
          {platTiles.map((t) => (
            <Tile key={t.key} label={t.label} url={pvUrl(t.platform)} circle={t.circle}
              selected={doc.previewPlatform === t.platform} onClick={() => setPlat(t.platform)} />
          ))}
        </div>
        <div className="flex gap-3">
          {(variants.length ? variants : APP_FALLBACK).map((v) => (
            <Tile key={v.id} label={v.id} url={v.url} circle={PLATFORMS[doc.previewPlatform].circle}
              selected={selRend === v.id} onClick={() => setAppearance(v.id as Appearance)} />
          ))}
        </div>
      </div>

      {error && (
        <div className="absolute bottom-2 left-3 right-3 z-20 text-[11px] text-red-700 bg-[color:var(--popover)] border border-red-300/70 rounded-lg px-2.5 py-1.5 shadow">{error}</div>
      )}
    </div>
  );
}

const APP_FALLBACK: { id: Rendition; url?: string }[] = [{ id: "Default" }, { id: "Dark" }, { id: "Mono" }];

function Tile({ label, url, selected, onClick, circle }: { label: string; url?: string; selected: boolean; onClick: () => void; circle?: boolean }) {
  return (
    <div className="relative flex flex-col items-center" data-tooltip={label} data-tooltip-placement="top">
      <button onClick={onClick}
        className={`w-[44px] h-[44px] overflow-hidden bg-[color:var(--chip)] ${circle ? "rounded-full" : "rounded-[10px]"} ${selected ? "ring-2 ring-accent ring-offset-2 ring-offset-transparent" : "ring-1 ring-[color:var(--line)]"}`}>
        {url && <img src={url} className="w-full h-full" draggable={false} />}
      </button>
    </div>
  );
}

function SmallBtn({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return <button onClick={onClick} className="preview-command h-[26px] px-2.5 rounded-full text-[12px] flex items-center gap-1">{children}</button>;
}

const GridIcon = () => <Grid3x3 size={14} strokeWidth={1.6} />;

function LightAngleControl({ value, onChange }: { value: number; onChange: (angle: number) => void }) {
  const dialRef = useRef<HTMLButtonElement>(null);
  const draggingRef = useRef(false);
  const angle = normalizeAngle(value);
  const dotX = 50 + 34 * Math.cos((angle * Math.PI) / 180);
  const dotY = 50 + 34 * Math.sin((angle * Math.PI) / 180);

  const updateFromPoint = (clientX: number, clientY: number) => {
    const rect = dialRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = clientX - (rect.left + rect.width / 2);
    const y = clientY - (rect.top + rect.height / 2);
    onChange(normalizeAngle((Math.atan2(y, x) * 180) / Math.PI));
  };

  return (
    <div className="control-pill flex items-center h-[26px] px-2.5 gap-1.5" data-tauri-no-drag>
      <button
        ref={dialRef}
        aria-label="Light angle"
        data-tooltip="Light angle"
        className="light-dial relative w-[16px] h-[16px] rounded-full inline-block cursor-grab active:cursor-grabbing"
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          draggingRef.current = true;
          updateFromPoint(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (draggingRef.current) updateFromPoint(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          draggingRef.current = false;
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => { draggingRef.current = false; }}
      >
        <span
          className="absolute w-[4px] h-[4px] rounded-full bg-[color:var(--tx)]"
          style={{ left: `${dotX}%`, top: `${dotY}%`, transform: "translate(-50%,-50%)" }}
        />
      </button>
      <input
        className="w-9 bg-transparent text-[12px] text-[color:var(--tx-2)] outline-none tabular-nums"
        value={`${Math.round(angle)}°`}
        onChange={(e) => {
          const n = parseInt(e.target.value);
          if (!isNaN(n)) onChange(normalizeAngle(n));
        }}
      />
    </div>
  );
}

/** Alignment-grid overlay — the real Icon Composer grid (appicongrid.square/circle), tinted for the backdrop. */
function GridGuide({ src, dark }: { src: string; dark: boolean }) {
  return (
    <div className="absolute inset-0 pointer-events-none" style={{
      WebkitMaskImage: `url(${src})`, maskImage: `url(${src})`,
      WebkitMaskSize: "contain", maskSize: "contain",
      WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat",
      WebkitMaskPosition: "center", maskPosition: "center",
      background: dark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.42)",
    }} />
  );
}

const luminance = (hex: string): number => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};

const normalizeAngle = (angle: number): number => ((angle % 360) + 360) % 360;
