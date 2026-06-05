use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const POPOVER_LABEL_PREFIX: &str = "ictool-popover-";

#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, SWP_FRAMECHANGED,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_EX_APPWINDOW, WS_EX_NOACTIVATE,
    WS_EX_TOOLWINDOW,
};

#[derive(Serialize)]
struct Asset {
    name: String,
    data: String, // base64 of the file bytes
}

#[derive(Serialize)]
struct IconPackage {
    name: String,
    json: String,
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct AssetIn {
    name: String,
    data: String, // base64
}

/// Read a `.icon` package directory: icon.json + Assets/*.
#[tauri::command]
fn read_icon(path: String) -> Result<IconPackage, String> {
    let dir = PathBuf::from(&path);
    let json = fs::read_to_string(dir.join("icon.json")).map_err(|e| e.to_string())?;
    let mut assets = Vec::new();
    let assets_dir = dir.join("Assets");
    if assets_dir.is_dir() {
        for entry in fs::read_dir(&assets_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let p = entry.path();
            if p.is_file() {
                let bytes = fs::read(&p).map_err(|e| e.to_string())?;
                let name = p.file_name().unwrap().to_string_lossy().to_string();
                assets.push(Asset {
                    name,
                    data: STANDARD.encode(&bytes),
                });
            }
        }
    }
    let name = dir
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Untitled".into());
    Ok(IconPackage { name, json, assets })
}

/// Write a `.icon` package: icon.json + Assets/ (assets carry base64 bytes).
#[tauri::command]
fn save_icon(path: String, json: String, assets: Vec<AssetIn>) -> Result<(), String> {
    let dir = PathBuf::from(&path);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let assets_dir = dir.join("Assets");
    fs::create_dir_all(&assets_dir).map_err(|e| e.to_string())?;
    fs::write(dir.join("icon.json"), json).map_err(|e| e.to_string())?;
    for a in assets {
        let bytes = STANDARD.decode(&a.data).map_err(|e| e.to_string())?;
        fs::write(assets_dir.join(&a.name), bytes).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Write rendered PNG files (base64) into a chosen folder.
#[tauri::command]
fn export_pngs(dir: String, files: Vec<AssetIn>) -> Result<(), String> {
    let d = PathBuf::from(&dir);
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    for f in files {
        let bytes = STANDARD.decode(&f.data).map_err(|e| e.to_string())?;
        fs::write(d.join(&f.name), bytes).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(windows)]
fn configure_popover_window_flags<R: tauri::Runtime>(window: &tauri::Window<R>) {
    if !window.label().starts_with(POPOVER_LABEL_PREFIX) {
        return;
    }
    let Ok(hwnd) = window.hwnd() else {
        return;
    };

    unsafe {
        let current = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let next = (current | WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0) & !WS_EX_APPWINDOW.0;
        if next != current {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next as isize);
        }
        let _ = SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        );
    }
}

#[cfg(not(windows))]
fn configure_popover_window_flags<R: tauri::Runtime>(_window: &tauri::Window<R>) {}

fn popover_window_flags_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("popover-window-flags")
        .on_window_ready(|window| configure_popover_window_flags(&window))
        .on_webview_ready(|webview| configure_popover_window_flags(&webview.window()))
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(popover_window_flags_plugin())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![read_icon, save_icon, export_pngs])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
