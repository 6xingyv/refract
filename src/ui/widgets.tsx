import React from "react";
import { ChevronsUpDown, ChevronDown } from "lucide-react";
import type { IcColor } from "../model/types";
import { openNativeColorPicker, openNativeDropdown } from "./nativePopover";

/* ---- section: gray header + optional variation dropdown, thin divider ---- */
export function Section({ title, variation, children }: { title: string; variation?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="px-3.5 pt-3 pb-2.5 border-b border-[color:var(--line)]">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-semibold text-[color:var(--tx-3)]">{title}</span>
        {variation}
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between h-[30px]">
      <span className="text-[13px] text-[color:var(--tx)]">{label}</span>
      <div className="flex items-center gap-1.5">{children}</div>
    </div>
  );
}

/* ---- blue toggle ---- */
export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`w-[36px] h-[21px] rounded-full transition-colors relative shrink-0 ${on ? "bg-accent" : "bg-[color:var(--chip)]"}`}
    >
      <span className={`absolute top-[2px] w-[17px] h-[17px] rounded-full bg-white shadow-sm transition-all ${on ? "left-[17px]" : "left-[2px]"}`} />
    </button>
  );
}

/* ---- value chip: editable number + unit, frosted ---- */
export function ValueChip({ value, unit, onChange, w = "min-w-[52px]" }: { value: number; unit: string; onChange: (v: number) => void; w?: string }) {
  const [text, setText] = React.useState(String(value));
  React.useEffect(() => setText(String(value)), [value]);
  return (
    <div className={`flex items-center bg-[color:var(--chip)] rounded-[6px] px-2 h-[22px] ${w} justify-end`}>
      <input
        className="w-8 bg-transparent text-right text-[12px] outline-none tabular-nums text-[color:var(--tx)]"
        value={text}
        onChange={(e) => { setText(e.target.value); const n = parseFloat(e.target.value); if (!isNaN(n)) onChange(n); }}
      />
      <span className="text-[12px] text-[color:var(--tx-3)] ml-0.5">{unit}</span>
    </div>
  );
}

/** Percentage chip (model value 0..1 shown as %). */
export function Pct({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return <ValueChip value={Math.round(value * 100)} unit="%" onChange={(n) => onChange(Math.max(0, Math.min(100, n)) / 100)} />;
}

type DropdownKind = "chip" | "plain";

function Dropdown({ value, options, onChange, kind }: { value: string; options: string[]; onChange?: (v: string) => void; kind: DropdownKind }) {
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const disabled = !onChange || options.length <= 1;

  const triggerClass = kind === "chip" ? "dropdown-trigger dropdown-trigger-chip" : "dropdown-trigger dropdown-trigger-plain";

  return (
    <div className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        className={triggerClass}
        onClick={async () => {
          if (disabled) return;
          const next = triggerRef.current ? await openNativeDropdown(triggerRef.current, value, options, kind) : null;
          if (next != null) onChange?.(next);
        }}
      >
        <span className="truncate">{value}</span>
        {kind === "chip"
          ? <ChevronsUpDown size={12} strokeWidth={2} className="shrink-0 text-[color:var(--tx-3)]" />
          : <ChevronDown size={11} className="shrink-0 text-[color:var(--tx-3)]" />}
      </button>
    </div>
  );
}

/* ---- dropdown: value + up/down chevrons, frosted ---- */
export function Select({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return <Dropdown value={value} options={options} onChange={onChange} kind="chip" />;
}

/** Inline variation dropdown shown in a section header (gray text, no chip). */
export function Variation({ value, options, onChange }: { value: string; options: string[]; onChange?: (v: string) => void }) {
  return <Dropdown value={value} options={options} onChange={onChange} kind="plain" />;
}

const hexFromColor = (color: IcColor) =>
  `#${[color.r, color.g, color.b].map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, "0")).join("")}`;
const colorFromHex = (hex: string, alpha: number): IcColor => ({
  r: parseInt(hex.slice(1, 3), 16) / 255,
  g: parseInt(hex.slice(3, 5), 16) / 255,
  b: parseInt(hex.slice(5, 7), 16) / 255,
  a: /^[#][0-9a-f]{8}$/i.test(hex) ? parseInt(hex.slice(7, 9), 16) / 255 : alpha,
});

export function ColorWell({ color, onChange }: { color: IcColor; onChange: (c: IcColor) => void }) {
  const ref = React.useRef<HTMLButtonElement>(null);
  const hex = hexFromColor(color);
  return (
    <button
      ref={ref}
      className="w-[22px] h-[22px] rounded-[6px] border border-[color:var(--line)] cursor-pointer shadow-inner"
      style={{ background: hex }}
      onClick={async () => {
        const next = ref.current ? await openNativeColorPicker(ref.current, hex, color.a) : null;
        if (next) onChange(colorFromHex(next, color.a));
      }}
    />
  );
}

/** Frosted pill button used in the toolbar. */
export function PillButton({ children, onClick, title, active }: { children: React.ReactNode; onClick?: () => void; title?: string; active?: boolean }) {
  return (
    <button aria-label={title} data-tooltip={title} onClick={onClick}
      className={`control-pill h-[26px] px-2.5 text-[12px] flex items-center gap-1 ${active ? "control-pill-active text-[color:var(--tx)]" : "text-[color:var(--tx-2)]"}`}>
      {children}
    </button>
  );
}
