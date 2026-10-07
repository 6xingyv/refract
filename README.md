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

### Rendering Results

Some default app icons rendered by Refract.

<table>
  <tr>
    <td align="center">
      <a href="./docs/img/results/AppStore-iOS-Default.png"><img src="./docs/img/results/AppStore-iOS-Default.png" width="200" alt="App Store rendered by Refract, iOS Default"/></a><br/>
      App Store
    </td>
    <td align="center">
      <a href="./docs/img/results/Books-iOS-Default.png"><img src="./docs/img/results/Books-iOS-Default.png" width="200" alt="Books rendered by Refract, iOS Default"/></a><br/>
      Books
    </td>
    <td align="center">
      <a href="./docs/img/results/FaceTime-iOS-Default.png"><img src="./docs/img/results/FaceTime-iOS-Default.png" width="200" alt="FaceTime rendered by Refract, iOS Default"/></a><br/>
      FaceTime
    </td>
  </tr>
  <tr>
    <td align="center">
      <a href="./docs/img/results/Games-iOS-Default.png"><img src="./docs/img/results/Games-iOS-Default.png" width="200" alt="Games rendered by Refract, iOS Default"/></a><br/>
      Games
    </td>
    <td align="center">
      <a href="./docs/img/results/Journal-iOS-Default.png"><img src="./docs/img/results/Journal-iOS-Default.png" width="200" alt="Journal rendered by Refract, iOS Default"/></a><br/>
      Journal
    </td>
    <td align="center">
      <a href="./docs/img/results/Maps-iOS-Default.png"><img src="./docs/img/results/Maps-iOS-Default.png" width="200" alt="Maps rendered by Refract, iOS Default"/></a><br/>
      Maps
    </td>
  </tr>
  <tr>
    <td align="center">
      <a href="./docs/img/results/MobileSafari-iOS-Default.png"><img src="./docs/img/results/MobileSafari-iOS-Default.png" width="200" alt="Safari rendered by Refract, iOS Default"/></a><br/>
      Safari
    </td>
    <td align="center">
      <a href="./docs/img/results/Stocks-iOS-Default.png"><img src="./docs/img/results/Stocks-iOS-Default.png" width="200" alt="Stocks rendered by Refract, iOS Default"/></a><br/>
      Stocks
    </td>
    <td align="center">
      <a href="./docs/img/results/Weather-iOS-Default.png"><img src="./docs/img/results/Weather-iOS-Default.png" width="200" alt="Weather rendered by Refract, iOS Default"/></a><br/>
      Weather
    </td>
  </tr>
</table>

## 💻 Develop

```bash
bun install
bun tauri dev
```

`bun run dev` runs the web frontend alone (Open/Save need the Tauri shell; rendering uses
WebGPU when available and automatically falls back to WebGL2).

## 📦 Build

```bash
bun tauri build
```

## 📄 License

Refract is licensed under the [Mozilla Public License 2.0](./LICENSE).
Commercial use is welcome. If Refract benefits your work or business,
please consider sponsoring its development or contributing generally useful
improvements upstream.
