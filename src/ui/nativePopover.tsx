import React from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { currentMonitor, Effect, EffectState, getCurrentWindow, LogicalPosition, LogicalSize, Window as TauriWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

type Placement = "bottom-start" | "bottom-end" | "bottom" | "top-start" | "top-end" | "top";
type PopoverKind = "dropdown" | "tooltip" | "wallpaper" | "color" | "contextMenu";

export type NativeContextMenuItem = {
  id: string;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
};

export type PopupPayload =
  | { kind: "dropdown"; sourceId: string; value: string; options: string[]; variant: "chip" | "plain"; dark: boolean }
  | { kind: "tooltip"; sourceId: string; text: string; dark: boolean }
  | { kind: "wallpaper"; sourceId: string; selected: number; presets: string[]; dark: boolean }
  | { kind: "color"; sourceId: string; value: string; dark: boolean }
  | { kind: "contextMenu"; sourceId: string; items: NativeContextMenuItem[]; dark: boolean };

type PopupResult = { sourceId: string; value?: string | number; cancelled?: boolean };
type PopupReady = { label: string };
type PopupSlot = {
  kind: PopoverKind;
  label: string;
  win: WebviewWindow;
  ready: Promise<void>;
  activeSourceId: string | null;
};

const EDGE = 8;
const POPUP_KINDS: PopoverKind[] = ["tooltip", "dropdown", "wallpaper", "color", "contextMenu"];
let serial = 0;
let eventReady: Promise<void> | null = null;
let readyEventReady: Promise<void> | null = null;
let suppressBlurUntil = 0;
const pending = new Map<string, (value: string | number | null) => void>();
const windows = new Map<string, WebviewWindow>();
const slots = new Map<PopoverKind, PopupSlot>();
const readyResolvers = new Map<string, () => void>();
const sourceKinds = new Map<string, PopoverKind>();
const closedSources = new Set<string>();

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const appIsDarkMode = () => window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false;

function sourceId(kind: PopoverKind) {
  serial += 1;
  return `refract-popover-${kind}-${Date.now()}-${serial}`;
}

function slotLabel(kind: PopoverKind) {
  return `refract-popover-${kind}`;
}

function payloadEvent(kind: PopoverKind) {
  return `native-popover-payload-${kind}`;
}

function markClosed(id: string) {
  closedSources.add(id);
  window.setTimeout(() => closedSources.delete(id), 5000);
}

function hasActivePopover() {
  return [...slots.values()].some((slot) => slot.activeSourceId);
}

function popoverEffect(kind: PopoverKind) {
  const isMac = navigator.platform.toLowerCase().includes("mac");
  if (!isMac) {
    return {
      effects: [Effect.Acrylic],
      color: "#00000000",
    };
  }
  return {
    effects: [kind === "tooltip" ? Effect.Tooltip : Effect.Popover],
    state: EffectState.Active,
  };
}

function popupUrl(kind: PopoverKind) {
  const u = new URL(window.location.href);
  u.search = "";
  u.hash = "";
  u.searchParams.set("popup", "1");
  u.searchParams.set("popup-kind", kind);
  return u.toString();
}

function textWidth(text: string, min: number, max: number) {
  return clamp(Math.ceil(text.length * 7.2 + 18), min, max);
}

function sizeFor(payload: PopupPayload, anchorWidth: number) {
  if (payload.kind === "tooltip") {
    return { width: textWidth(payload.text, 44, 220), height: 24 };
  }
  if (payload.kind === "wallpaper") {
    const rows = Math.ceil(payload.presets.length / 2);
    return { width: 156, height: rows * 54 + 20 + Math.max(0, rows - 1) * 8 };
  }
  if (payload.kind === "color") {
    return { width: 220, height: 238 };
  }
  if (payload.kind === "contextMenu") {
    const maxLabel = payload.items.reduce((n, item) => Math.max(n, item.label.length), 0);
    const separators = payload.items.filter((item) => item.separatorBefore).length;
    return {
      width: textWidth("X".repeat(maxLabel), 132, 210),
      height: Math.min(280, payload.items.length * 26 + separators * 9 + 10),
    };
  }
  const maxLabel = payload.options.reduce((n, o) => Math.max(n, o.length), 0);
  return {
    width: Math.max(Math.ceil(anchorWidth), textWidth("X".repeat(maxLabel), 88, 180)),
    height: Math.min(240, payload.options.length * 26 + 10),
  };
}

async function screenPosition(anchor: HTMLElement, size: { width: number; height: number }, placement: Placement) {
  const appWindow = getCurrentWindow();
  const scale = await appWindow.scaleFactor();
  const inner = await appWindow.innerPosition();
  const monitor = await currentMonitor();
  const rect = anchor.getBoundingClientRect();

  const innerX = inner.x / scale;
  const innerY = inner.y / scale;
  const anchorLeft = innerX + rect.left;
  const anchorRight = innerX + rect.right;
  const anchorTop = innerY + rect.top;
  const anchorBottom = innerY + rect.bottom;
  const workX = monitor ? monitor.workArea.position.x / monitor.scaleFactor : innerX - rect.left;
  const workY = monitor ? monitor.workArea.position.y / monitor.scaleFactor : innerY - rect.top;
  const workW = monitor ? monitor.workArea.size.width / monitor.scaleFactor : window.innerWidth;
  const workH = monitor ? monitor.workArea.size.height / monitor.scaleFactor : window.innerHeight;

  const [preferredSide, align = "center"] = placement.split("-") as ["top" | "bottom", "start" | "end" | "center" | undefined];
  const gap = 6;
  const below = workY + workH - anchorBottom - gap - EDGE;
  const above = anchorTop - workY - gap - EDGE;
  const side = preferredSide === "bottom"
    ? (below < size.height && above > below ? "top" : "bottom")
    : (above < size.height && below > above ? "bottom" : "top");

  const rawX = align === "start"
    ? anchorLeft
    : align === "end"
      ? anchorRight - size.width
      : anchorLeft + rect.width / 2 - size.width / 2;
  const rawY = side === "bottom" ? anchorBottom + gap : anchorTop - size.height - gap;

  return {
    x: clamp(Math.round(rawX), Math.round(workX + EDGE), Math.round(workX + workW - size.width - EDGE)),
    y: clamp(Math.round(rawY), Math.round(workY + EDGE), Math.round(workY + workH - size.height - EDGE)),
  };
}

async function pointScreenPosition(clientX: number, clientY: number, size: { width: number; height: number }) {
  const appWindow = getCurrentWindow();
  const scale = await appWindow.scaleFactor();
  const inner = await appWindow.innerPosition();
  const monitor = await currentMonitor();

  const innerX = inner.x / scale;
  const innerY = inner.y / scale;
  const workX = monitor ? monitor.workArea.position.x / monitor.scaleFactor : innerX;
  const workY = monitor ? monitor.workArea.position.y / monitor.scaleFactor : innerY;
  const workW = monitor ? monitor.workArea.size.width / monitor.scaleFactor : window.innerWidth;
  const workH = monitor ? monitor.workArea.size.height / monitor.scaleFactor : window.innerHeight;
  const rawX = innerX + clientX;
  const rawY = innerY + clientY;

  return {
    x: clamp(Math.round(rawX), Math.round(workX + EDGE), Math.round(workX + workW - size.width - EDGE)),
    y: clamp(Math.round(rawY), Math.round(workY + EDGE), Math.round(workY + workH - size.height - EDGE)),
  };
}

async function ensureEventListener() {
  if (eventReady) return eventReady;
  eventReady = listen<PopupResult>("native-popover-result", (event) => {
    const { sourceId, value, cancelled } = event.payload;
    pending.get(sourceId)?.(cancelled ? null : value ?? null);
    pending.delete(sourceId);
    closeNativePopover(sourceId);
  }).then(() => undefined);
  return eventReady;
}

async function ensureReadyListener() {
  if (readyEventReady) return readyEventReady;
  readyEventReady = listen<PopupReady>("native-popover-ready", (event) => {
    readyResolvers.get(event.payload.label)?.();
  }).then(() => undefined);
  return readyEventReady;
}

async function ensurePopoverSlot(kind: PopoverKind) {
  const cached = slots.get(kind);
  if (cached) return cached;

  await ensureEventListener();
  await ensureReadyListener();

  const label = slotLabel(kind);
  let finishReady = () => {};
  const ready = new Promise<void>((resolve) => {
    let done = false;
    finishReady = () => {
      if (done) return;
      done = true;
      readyResolvers.delete(label);
      resolve();
    };
    readyResolvers.set(label, finishReady);
  });

  let existing = await WebviewWindow.getByLabel(label).catch(() => null);
  if (existing && kind === "color") {
    await existing.destroy().catch(() => {});
    existing = null;
  }
  const parent = getCurrentWindow();
  const win = existing ?? new WebviewWindow(label, {
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    closable: false,
    decorations: false,
    focus: kind === "color",
    focusable: kind === "color",
    height: 1,
    parent: parent.label,
    preventOverflow: true,
    resizable: false,
    shadow: true,
    skipTaskbar: true,
    transparent: true,
    url: popupUrl(kind),
    visible: false,
    width: 1,
    windowEffects: popoverEffect(kind),
    x: 0,
    y: 0,
  });

  const slot: PopupSlot = { kind, label, win, ready, activeSourceId: null };
  slots.set(kind, slot);
  if (existing) {
    finishReady();
  } else {
    void win.once("tauri://error", () => {
      if (slots.get(kind)?.win === win) slots.delete(kind);
      finishReady();
    });
  }
  return slot;
}

export async function prewarmNativePopovers() {
  if (!isTauri()) return;
  await Promise.all(POPUP_KINDS.filter((kind) => kind !== "color").map(async (kind) => {
    const slot = await ensurePopoverSlot(kind);
    await slot.ready;
  }));
}

export async function closeNativePopover(id: string) {
  markClosed(id);
  const win = windows.get(id);
  const kind = sourceKinds.get(id);
  const slot = kind ? slots.get(kind) : null;
  const isActiveSlot = !!slot && slot.win === win && slot.activeSourceId === id;
  pending.get(id)?.(null);
  windows.delete(id);
  sourceKinds.delete(id);
  pending.delete(id);
  if (isActiveSlot) {
    slot.activeSourceId = null;
    try {
      await slot.win.hide();
      await emitTo(slot.label, payloadEvent(slot.kind), null);
    } catch {}
    return;
  }
  try {
    await win?.destroy();
  } catch {
    try { await win?.close(); } catch {}
  }
}

function closeNativePopoversByKind(kind: PopoverKind) {
  const prefix = `refract-popover-${kind}-`;
  return Promise.all([...windows.keys()].filter((id) => id.startsWith(prefix)).map(closeNativePopover));
}

export async function closeAllNativePopovers() {
  await Promise.all([...windows.keys()].map(closeNativePopover));
}

async function destroyPopoverSlot(kind: PopoverKind) {
  const slot = slots.get(kind);
  if (!slot) return;
  const activeId = slot.activeSourceId;
  if (activeId) await closeNativePopover(activeId);
  slots.delete(kind);
  readyResolvers.delete(slot.label);
  try {
    await slot.win.destroy();
  } catch {
    try { await slot.win.close(); } catch {}
  }
}

async function openNativePopover(anchor: HTMLElement, payload: PopupPayload, placement: Placement) {
  if (!isTauri()) return null;
  closedSources.delete(payload.sourceId);
  const slot = await ensurePopoverSlot(payload.kind);
  await slot.ready;
  if (closedSources.has(payload.sourceId)) return null;

  if (slot.activeSourceId && slot.activeSourceId !== payload.sourceId) {
    await closeNativePopover(slot.activeSourceId);
  }

  const size = sizeFor(payload, anchor.getBoundingClientRect().width);
  const pos = await screenPosition(anchor, size, placement);
  slot.activeSourceId = payload.sourceId;
  windows.set(payload.sourceId, slot.win);
  sourceKinds.set(payload.sourceId, payload.kind);

  await slot.win.setSize(new LogicalSize(size.width, size.height));
  await slot.win.setPosition(new LogicalPosition(pos.x, pos.y));
  if (closedSources.has(payload.sourceId)) {
    await closeNativePopover(payload.sourceId);
    return null;
  }

  await emitTo(slot.label, payloadEvent(slot.kind), payload);
  if (closedSources.has(payload.sourceId)) {
    await closeNativePopover(payload.sourceId);
    return null;
  }

  suppressBlurUntil = Date.now() + 250;
  await slot.win.show();
  return slot.win;
}

async function openNativePopoverAtPoint(clientX: number, clientY: number, payload: PopupPayload) {
  if (!isTauri()) return null;
  closedSources.delete(payload.sourceId);
  const slot = await ensurePopoverSlot(payload.kind);
  await slot.ready;
  if (closedSources.has(payload.sourceId)) return null;

  if (slot.activeSourceId && slot.activeSourceId !== payload.sourceId) {
    await closeNativePopover(slot.activeSourceId);
  }

  const size = sizeFor(payload, 0);
  const pos = await pointScreenPosition(clientX, clientY, size);
  slot.activeSourceId = payload.sourceId;
  windows.set(payload.sourceId, slot.win);
  sourceKinds.set(payload.sourceId, payload.kind);

  await slot.win.setSize(new LogicalSize(size.width, size.height));
  await slot.win.setPosition(new LogicalPosition(pos.x, pos.y));
  if (closedSources.has(payload.sourceId)) {
    await closeNativePopover(payload.sourceId);
    return null;
  }

  await emitTo(slot.label, payloadEvent(slot.kind), payload);
  if (closedSources.has(payload.sourceId)) {
    await closeNativePopover(payload.sourceId);
    return null;
  }

  suppressBlurUntil = Date.now() + 250;
  await slot.win.show();
  return slot.win;
}

export async function openNativeDropdown(anchor: HTMLElement, value: string, options: string[], variant: "chip" | "plain") {
  await closeNativePopoversByKind("tooltip");
  const id = sourceId("dropdown");
  const dark = appIsDarkMode();
  const payload: PopupPayload = { kind: "dropdown", sourceId: id, value, options, variant, dark };
  const win = await openNativePopover(anchor, payload, variant === "plain" ? "bottom-end" : "bottom-start");
  if (!win) return null;
  return new Promise<string | null>((resolve) => pending.set(id, (v) => resolve(typeof v === "string" ? v : null)));
}

export async function openNativeWallpaper(anchor: HTMLElement, presets: string[], selected: number) {
  await closeNativePopoversByKind("tooltip");
  const id = sourceId("wallpaper");
  const dark = appIsDarkMode();
  const win = await openNativePopover(anchor, { kind: "wallpaper", sourceId: id, presets, selected, dark }, "bottom-end");
  if (!win) return null;
  return new Promise<number | null>((resolve) => pending.set(id, (v) => resolve(typeof v === "number" ? v : null)));
}

export async function openNativeColorPicker(anchor: HTMLElement, value: string) {
  await closeNativePopoversByKind("tooltip");
  await destroyPopoverSlot("color");
  const id = sourceId("color");
  const dark = appIsDarkMode();
  const win = await openNativePopover(anchor, { kind: "color", sourceId: id, value, dark }, "bottom-end");
  if (!win) return null;
  return new Promise<string | null>((resolve) => pending.set(id, (v) => resolve(typeof v === "string" ? v : null)));
}

export async function openNativeContextMenu(clientX: number, clientY: number, items: NativeContextMenuItem[]) {
  await closeNativePopoversByKind("tooltip");
  const id = sourceId("contextMenu");
  const dark = appIsDarkMode();
  const win = await openNativePopoverAtPoint(clientX, clientY, { kind: "contextMenu", sourceId: id, items, dark });
  if (!win) return null;
  return new Promise<string | null>((resolve) => pending.set(id, (v) => resolve(typeof v === "string" ? v : null)));
}

export function NativeTooltipProvider() {
  const active = React.useRef<{ id: string; anchor: HTMLElement; ticket: number } | null>(null);
  const ticket = React.useRef(0);

  React.useEffect(() => {
    if (!isTauri()) return;
    void prewarmNativePopovers();
    const show = (target: EventTarget | null) => {
      const el = target instanceof Element ? target.closest<HTMLElement>("[data-tooltip]") : null;
      const text = el?.dataset.tooltip?.trim();
      if (!el || !text) return;
      if (active.current?.anchor === el) return;
      ticket.current += 1;
      const id = sourceId("tooltip");
      const currentTicket = ticket.current;
      active.current = { id, anchor: el, ticket: currentTicket };
      const dark = appIsDarkMode();
      void closeNativePopoversByKind("tooltip").then(() => {
        if (active.current?.id !== id || active.current.ticket !== currentTicket) return;
        void openNativePopover(el, { kind: "tooltip", sourceId: id, text, dark }, el.dataset.tooltipPlacement === "top" ? "top" : "bottom").then((win) => {
          if (win && (active.current?.id !== id || active.current.ticket !== currentTicket)) {
            void closeNativePopover(id);
          }
        });
      });
    };
    const hide = (target: EventTarget | null, related: EventTarget | null) => {
      const el = target instanceof Element ? target.closest<HTMLElement>("[data-tooltip]") : null;
      if (!el || (related instanceof Node && el.contains(related))) return;
      const id = active.current?.id ?? null;
      ticket.current += 1;
      active.current = null;
      if (id) void closeNativePopover(id);
    };
    const onPointerOver = (e: PointerEvent) => show(e.target);
    const onPointerOut = (e: PointerEvent) => hide(e.target, e.relatedTarget);
    const onFocusIn = (e: FocusEvent) => show(e.target);
    const onFocusOut = (e: FocusEvent) => hide(e.target, e.relatedTarget);
    const hideAll = () => {
      ticket.current += 1;
      active.current = null;
      void closeAllNativePopovers();
    };
    const onPointerDown = () => {
      if (hasActivePopover()) hideAll();
    };
    const handleBlur = () => {
      window.setTimeout(() => {
        if (Date.now() < suppressBlurUntil) return;
        void TauriWindow.getFocusedWindow().then((focusedWindow) => {
          const focusedLabel = focusedWindow?.label ?? "";
          if (focusedLabel.startsWith("refract-popover-")) return;
          hideAll();
        }).catch(hideAll);
      }, 0);
    };
    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerout", onPointerOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("pointerdown", onPointerDown, { capture: true });
    const unlistenMoved = getCurrentWindow().onMoved(hideAll);
    const unlistenResized = getCurrentWindow().onResized(hideAll);
    const unlistenFocus = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused) handleBlur();
    });
    return () => {
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("pointerdown", onPointerDown, { capture: true });
      void unlistenMoved.then((fn) => fn());
      void unlistenResized.then((fn) => fn());
      void unlistenFocus.then((fn) => fn());
      void closeAllNativePopovers();
    };
  }, []);

  return null;
}

type Rgb = { r: number; g: number; b: number };
type Hsv = { h: number; s: number; v: number };

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace("#", "").trim();
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const n = /^[0-9a-f]{6}$/i.test(full) ? parseInt(full, 16) : 0xffffff;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex({ r, g, b }: Rgb) {
  return `#${[r, g, b].map((n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, "0")).join("")}`;
}

function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const c = v * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = v - c;
  let rp = 0, gp = 0, bp = 0;
  if (h < 60) [rp, gp, bp] = [c, x, 0];
  else if (h < 120) [rp, gp, bp] = [x, c, 0];
  else if (h < 180) [rp, gp, bp] = [0, c, x];
  else if (h < 240) [rp, gp, bp] = [0, x, c];
  else if (h < 300) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];
  return { r: (rp + m) * 255, g: (gp + m) * 255, b: (bp + m) * 255 };
}

function NativeContextMenu({ items, send }: { items: NativeContextMenuItem[]; send: (value?: string | number) => Promise<void> }) {
  return (
    <div className="native-context-menu-window" onContextMenu={(e) => e.preventDefault()}>
      {items.map((item) => (
        <React.Fragment key={item.id}>
          {item.separatorBefore && <div className="native-context-menu-separator" />}
          <button
            type="button"
            disabled={item.disabled}
            className={`native-context-menu-option ${item.danger ? "native-context-menu-option-danger" : ""}`}
            onClick={() => void send(item.id)}
          >
            {item.label}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}

function NativeColorPicker({ value, send }: { value: string; send: (value?: string | number) => Promise<void> }) {
  const [hsv, setHsv] = React.useState(() => rgbToHsv(hexToRgb(value)));
  const hex = rgbToHex(hsvToRgb(hsv));
  const hue = `hsl(${hsv.h}, 100%, 50%)`;

  const updateSv = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHsv((c) => ({
      ...c,
      s: clamp((e.clientX - rect.left) / rect.width, 0, 1),
      v: 1 - clamp((e.clientY - rect.top) / rect.height, 0, 1),
    }));
  };
  const updateHue = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHsv((c) => ({ ...c, h: clamp((e.clientX - rect.left) / rect.width, 0, 1) * 360 }));
  };

  return (
    <div className="native-color-window">
      <div
        className="native-color-sv"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hue})` }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          updateSv(e);
        }}
        onPointerMove={(e) => { if (e.buttons === 1) updateSv(e); }}
      >
        <span className="native-color-sv-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
      </div>
      <div
        className="native-color-hue"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          updateHue(e);
        }}
        onPointerMove={(e) => { if (e.buttons === 1) updateHue(e); }}
      >
        <span className="native-color-hue-thumb" style={{ left: `${(hsv.h / 360) * 100}%` }} />
      </div>
      <div className="native-color-footer">
        <span className="native-color-swatch" style={{ background: hex }} />
        <span className="native-color-hex">{hex.toUpperCase()}</span>
        <button className="native-color-button" onClick={() => void send(hex)}>Done</button>
      </div>
    </div>
  );
}

export function PopupWindow() {
  const popupKind = React.useMemo<PopoverKind | null>(() => {
    const raw = new URLSearchParams(window.location.search).get("popup-kind");
    return raw === "tooltip" || raw === "dropdown" || raw === "wallpaper" || raw === "color" || raw === "contextMenu" ? raw : null;
  }, []);
  const [payload, setPayload] = React.useState<PopupPayload | null>(() => {
    const raw = new URLSearchParams(window.location.search).get("data");
    if (!raw) return null;
    try { return JSON.parse(raw) as PopupPayload; } catch { return null; }
  });

  React.useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    const eventName = popupKind ? payloadEvent(popupKind) : "native-popover-payload";
    void listen<PopupPayload | null>(eventName, (event) => {
      if (event.payload && popupKind && event.payload.kind !== popupKind) return;
      setPayload(event.payload);
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
      void emitTo("main", "native-popover-ready", { label: getCurrentWindow().label });
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [popupKind]);

  React.useEffect(() => {
    document.body.classList.toggle("native-popover-dark", !!payload?.dark);
  }, [payload?.dark]);

  const send = async (value?: string | number) => {
    if (!payload) return;
    await emitTo("main", "native-popover-result", { sourceId: payload.sourceId, value });
    setPayload(null);
    await getCurrentWindow().hide();
  };

  if (!payload) return null;
  if (payload.kind === "tooltip") {
    return <div className="native-tooltip-window">{payload.text}</div>;
  }
  if (payload.kind === "color") {
    return <NativeColorPicker value={payload.value} send={send} />;
  }
  if (payload.kind === "contextMenu") {
    return <NativeContextMenu items={payload.items} send={send} />;
  }
  if (payload.kind === "wallpaper") {
    return (
      <div className="native-wallpaper-window">
        {payload.presets.map((css, i) => (
          <button
            key={i}
            className={`native-wallpaper-option ${i === payload.selected ? "native-option-selected" : ""}`}
            style={{ background: css }}
            onClick={() => void send(i)}
          />
        ))}
      </div>
    );
  }
  return (
    <div className="native-dropdown-window">
      {payload.options.map((option) => (
        <button
          key={option}
          className={`native-dropdown-option ${option === payload.value ? "native-option-selected" : ""}`}
          onClick={() => void send(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
