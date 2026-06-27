<img src="./docs/img/icon.png" width="100" alt="App Icon" align="right"/>

# Refract

<a href="https://github.com/6xingyv/refract/stargazers">
    <img src="https://img.shields.io/github/stars/6xingyv/refract?style=social" alt="Stars">
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

`bun run dev` runs the web frontend alone (Open/Save need the Tauri shell; rendering uses
WebGPU when available and automatically falls back to WebGL2).

Auto-update release setup is documented in [docs/UPDATER.md](./docs/UPDATER.md).

## 📦 Build

```bash
bun tauri build
```

## 📄 License

Refract is licensed under the [Mozilla Public License 2.0](./LICENSE).
Commercial use is welcome. If Refract benefits your work or business,
please consider sponsoring its development or contributing generally useful
improvements upstream.
