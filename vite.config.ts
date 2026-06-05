import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @tauri-apps/cli sets TAURI_DEV_HOST when running `tauri dev`
const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Tauri expects a fixed dev port and quiet output
  clearScreen: false,
  server: {
    port: 9876,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  // .wgsl shaders are imported as raw strings
  assetsInclude: ["**/*.wgsl", "**/*.inc"],
});
