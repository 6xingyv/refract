import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { PopupWindow } from "./ui/nativePopover";
import "./styles.css";

const isPopupWindow = new URLSearchParams(window.location.search).get("popup") === "1";

createRoot(document.getElementById("root")!).render(
  isPopupWindow
    ? <PopupWindow />
    : (
      <StrictMode>
        <App />
      </StrictMode>
    )
);
