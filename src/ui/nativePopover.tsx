import React from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { currentMonitor, Effect, EffectState, getCurrentWindow, LogicalPosition, LogicalSize, Window as TauriWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

type Placement = "bottom-start" | "bottom-end" | "bottom" | "top-start" | "top-end" | "top";
type PopoverKind = "dropdown" | "tooltip" | "wallpaper";

export type PopupPayload =
  | { kind: "dropdown"; sourceId: string; value: string; options: string[]; variant: "chip" | "plain"; dark: boolean }
  | { kind: "tooltip"; sourceId: string; text: string; dark: boolean }
  | { kind: "wallpaper"; sourceId: string; selected: number; presets: string[]; dark: boolean };

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
const POPUP_KINDS: PopoverKind[] = ["tooltip", "dropdown", "wallpaper"];
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

function sourceId(kind: PopoverKind) {
  serial += 1;
  return `ictool-popover-${kind}-${Date.now()}-${serial}`;
}

function slotLabel(kind: PopoverKind) {
  return `ictool-popover-${kind}`;
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

  const existing = await WebviewWindow.getByLabel(label).catch(() => null);
  const parent = getCurrentWindow();
  const win = existing ?? new WebviewWindow(label, {
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    closable: false,
    decorations: false,
    focus: false,
    focusable: false,
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
  await Promise.all(POPUP_KINDS.map(async (kind) => {
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
  const prefix = `ictool-popover-${kind}-`;
  return Promise.all([...windows.keys()].filter((id) => id.startsWith(prefix)).map(closeNativePopover));
}

export async function closeAllNativePopovers() {
  await Promise.all([...windows.keys()].map(closeNativePopover));
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

export async function openNativeDropdown(anchor: HTMLElement, value: string, options: string[], variant: "chip" | "plain") {
  await closeNativePopoversByKind("tooltip");
  const id = sourceId("dropdown");
  const dark = document.documentElement.classList.contains("ui-dark") || document.querySelector(".ui-dark") != null;
  const payload: PopupPayload = { kind: "dropdown", sourceId: id, value, options, variant, dark };
  const win = await openNativePopover(anchor, payload, variant === "plain" ? "bottom-end" : "bottom-start");
  if (!win) return null;
  return new Promise<string | null>((resolve) => pending.set(id, (v) => resolve(typeof v === "string" ? v : null)));
}

export async function openNativeWallpaper(anchor: HTMLElement, presets: string[], selected: number) {
  await closeNativePopoversByKind("tooltip");
  const id = sourceId("wallpaper");
  const dark = document.documentElement.classList.contains("ui-dark") || document.querySelector(".ui-dark") != null;
  const win = await openNativePopover(anchor, { kind: "wallpaper", sourceId: id, presets, selected, dark }, "bottom-end");
  if (!win) return null;
  return new Promise<number | null>((resolve) => pending.set(id, (v) => resolve(typeof v === "number" ? v : null)));
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
      const dark = document.documentElement.classList.contains("ui-dark") || document.querySelector(".ui-dark") != null;
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
          if (focusedLabel.startsWith("ictool-popover-")) return;
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

export function PopupWindow() {
  const popupKind = React.useMemo<PopoverKind | null>(() => {
    const raw = new URLSearchParams(window.location.search).get("popup-kind");
    return raw === "tooltip" || raw === "dropdown" || raw === "wallpaper" ? raw : null;
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
    document.body.classList.toggle("ui-dark", !!payload?.dark);
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
