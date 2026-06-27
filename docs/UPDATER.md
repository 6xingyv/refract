# Auto Updater

Refract uses the Tauri v2 updater plugin. The app checks a GitHub Releases JSON
asset at startup:

```text
https://github.com/6xingyv/refract/releases/latest/download/latest.json
```

## Version Bump

Use one command to keep the JavaScript package, Rust package, and Cargo lockfile
in sync:

```bash
bun run version 0.1.6
```

`src-tauri/tauri.conf.json` reads the application version from `../package.json`,
so the Tauri bundle version follows the same source.

## Signing Keys

Generate an updater signing key once:

```bash
bun tauri signer generate --write-keys updater.key
```

Keep `updater.key` private. Do not commit it. The command also writes
`updater.key.pub`, which is safe to copy into GitHub secrets.

For GitHub Actions releases, configure these repository secrets:

- `TAURI_UPDATER_PUBKEY`: the full contents of `updater.key.pub`
- `TAURI_SIGNING_PRIVATE_KEY`: the full contents of `updater.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: only required if the private key has a password

For a local release build, provide the same values as environment variables:

```bash
$env:TAURI_UPDATER_PUBKEY=(Get-Content .\updater.key.pub -Raw).Trim()
$env:TAURI_SIGNING_PRIVATE_KEY=(Get-Content .\updater.key -Raw)

$config = @{ plugins = @{ updater = @{ pubkey = $env:TAURI_UPDATER_PUBKEY } } } | ConvertTo-Json -Depth 5
Set-Content .\.tauri-updater-config.json $config
bun tauri build --config .tauri-updater-config.json
```

If the private key has a password, also set:

```bash
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD="..."
```

## GitHub latest.json

The release workflow builds the updater artifacts, uploads the generated `.sig`
files, and writes `latest.json` automatically from the downloaded workflow
artifacts.

The generated JSON follows this shape:

```json
{
  "version": "0.1.6",
  "notes": "Release notes for 0.1.6.",
  "pub_date": "2026-06-27T00:00:00Z",
  "platforms": {
    "windows-x86_64-msi": {
      "signature": "CONTENTS_OF_THE_MSI_ZIP_SIG_FILE",
      "url": "https://github.com/6xingyv/refract/releases/download/0.1.6/Refract_0.1.6_x64.msi.zip"
    },
    "darwin-aarch64": {
      "signature": "CONTENTS_OF_THE_DARWIN_AARCH64_SIG_FILE",
      "url": "https://github.com/6xingyv/refract/releases/download/0.1.6/Refract_0.1.6_universal.app.tar.gz"
    },
    "darwin-x86_64": {
      "signature": "CONTENTS_OF_THE_DARWIN_X86_64_SIG_FILE",
      "url": "https://github.com/6xingyv/refract/releases/download/0.1.6/Refract_0.1.6_universal.app.tar.gz"
    },
    "linux-x86_64-appimage": {
      "signature": "CONTENTS_OF_THE_APPIMAGE_TAR_GZ_SIG_FILE",
      "url": "https://github.com/6xingyv/refract/releases/download/0.1.6/Refract_0.1.6_amd64.AppImage.tar.gz"
    }
  }
}
```

The updater first looks for `os-arch-installer` and then `os-arch`. The workflow
currently builds Windows MSI, so it publishes `windows-x86_64-msi`. The manifest
generator also supports NSIS if the Windows bundle changes later.
