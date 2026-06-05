<img src="./docs/img/icon.png" width="100" alt="App Icon" align="right"/>

# Refract

<a href="https://github.com/6xingyv/refract/stargazers">
    <img src="https://img.shields.io/github/stars/6xingyv/refract?style=social" alt="Stars">
</a>

<a href="#️-license">
    <img src="https://img.shields.io/badge/License-purple.svg" alt="License">
</a>
<a href="https://github.com/6xingyv/refract/releases/latest">
    <img src="https://img.shields.io/badge/Releases-Github-blue.svg" alt="Github Releases">
</a>

Authors `.icon` files and renders icons with the Liquid Glass effect.

## 👓 Preview
<img src="./docs/img/screenshot.png"/>

### 🥇 Comparison

<img src="./docs/img/comparison.png" alt="comparison">
Left: Icon Composer by Apple
Right: Refract
(Please ignore the difference in background colors)

## 💻 Develop

```bash
bun install
bun tauri dev
```

`bun run dev` runs the web frontend alone (Open/Save need the Tauri shell; rendering needs a
WebGPU-capable webview — WebView2/Chromium on Windows works out of the box).

## 📦 Build

```bash
bun tauri build
```
