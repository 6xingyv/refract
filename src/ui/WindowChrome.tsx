import { Minus, Square, X } from "lucide-react";

export type ChromePlatform = "mac" | "windows" | "linux";

export function detectChromePlatform(): ChromePlatform {
  const platform = typeof navigator !== "undefined" ? navigator.platform.toLowerCase() : "";
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent.toLowerCase() : "";
  if (platform.includes("mac") || userAgent.includes("mac os")) return "mac";
  if (platform.includes("win") || userAgent.includes("windows")) return "windows";
  return "linux";
}

const withCurrentWindow = async (action: "minimize" | "toggleMaximize" | "close") => {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const appWindow = getCurrentWindow();
  await appWindow[action]();
};

export function WindowChrome({ platform }: { platform: ChromePlatform }) {
  if (platform === "mac") return <MacTrafficLights />;
  return <DesktopWindowControls />;
}

function DesktopWindowControls() {
  return (
    <div className="absolute right-0 top-0 z-40 flex h-11" data-tauri-no-drag>
      <button
        aria-label="Minimize"
        data-tooltip="Minimize"
        className="window-control"
        onClick={() => void withCurrentWindow("minimize")}
      >
        <Minus size={15} />
      </button>
      <button
        aria-label="Maximize"
        data-tooltip="Maximize"
        className="window-control"
        onClick={() => void withCurrentWindow("toggleMaximize")}
      >
        <Square size={12} />
      </button>
      <button
        aria-label="Close"
        data-tooltip="Close"
        className="window-control window-control-close"
        onClick={() => void withCurrentWindow("close")}
      >
        <X size={16} />
      </button>
    </div>
  );
}

function MacTrafficLights() {
  return (
    <div className="absolute left-3.5 top-[15px] z-40 flex gap-2" data-tauri-no-drag>
      <button
        aria-label="Close"
        data-tooltip="Close"
        className="traffic-light traffic-light-close"
        onClick={() => void withCurrentWindow("close")}
      />
      <button
        aria-label="Minimize"
        data-tooltip="Minimize"
        className="traffic-light traffic-light-minimize"
        onClick={() => void withCurrentWindow("minimize")}
      />
      <button
        aria-label="Maximize"
        data-tooltip="Maximize"
        className="traffic-light traffic-light-maximize"
        onClick={() => void withCurrentWindow("toggleMaximize")}
      />
    </div>
  );
}
