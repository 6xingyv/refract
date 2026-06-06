import { useStore } from "../state/store";
import type { Rendition } from "../model/types";
import { PillButton } from "./widgets";

const RENDS: { id: Rendition; label: string }[] = [
  { id: "Default", label: "Light" },
  { id: "Dark", label: "Dark" },
  { id: "Mono", label: "Mono" },
  { id: "TintedLight", label: "Tint" },
  { id: "ClearLight", label: "Clear" },
];

export function Toolbar() {
  const doc = useStore((s) => s.doc);
  const update = useStore((s) => s.update);
  const zoom = useStore((s) => s.zoom);
  const setZoom = useStore((s) => s.setZoom);
  const lightAngleDeg = useStore((s) => s.lightAngleDeg);
  const setLightAngle = useStore((s) => s.setLightAngle);
  const openIcon = useStore((s) => s.openIcon);
  const saveIcon = useStore((s) => s.saveIcon);
  const exportPng = useStore((s) => s.exportPng);

  return (
    <div className="h-11 shrink-0 flex items-center gap-2 px-3">
      <span className="text-[13px] font-semibold text-[color:var(--tx)] min-w-[120px] truncate">{doc.name}</span>
      <div className="flex-1" />

      {/* appearance segmented control */}
      <div className="control-pill flex rounded-full p-[2px]">
        {RENDS.map((r) => (
          <button
            key={r.id}
            onClick={() => update((d) => ({ ...d, previewRendition: r.id }))}
            className={`px-2.5 h-[22px] text-[11px] rounded-full transition-colors ${doc.previewRendition === r.id ? "control-pill-active text-[color:var(--tx)] shadow-sm" : "text-[color:var(--tx-2)] hover:text-[color:var(--tx)]"}`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* light angle */}
      <div className="control-pill flex items-center h-[26px] px-2.5 gap-1">
        <span className="w-3 h-3 rounded-full bg-yellow-400/90 inline-block" />
          <input
            className="w-9 bg-transparent text-[12px] text-[color:var(--tx-2)] outline-none tabular-nums"
            value={`${Math.round(lightAngleDeg)}°`}
            onChange={(e) => { const n = parseInt(e.target.value); if (!isNaN(n)) setLightAngle(n); }}
          />
      </div>

      {/* zoom */}
      <div className="control-pill flex items-center h-[26px] px-1">
        <button className="w-5 text-[color:var(--tx-2)]" onClick={() => setZoom(zoom - 0.25)}>−</button>
        <span className="text-[12px] text-[color:var(--tx-2)] tabular-nums w-10 text-center">{Math.round(zoom * 100)}%</span>
        <button className="w-5 text-[color:var(--tx-2)]" onClick={() => setZoom(zoom + 0.25)}>+</button>
      </div>

      <div className="w-px h-5 bg-[color:var(--line)] mx-0.5" />
      <PillButton onClick={openIcon}>Open</PillButton>
      <PillButton onClick={saveIcon}>Save</PillButton>
      <PillButton onClick={exportPng}>Export</PillButton>
    </div>
  );
}
