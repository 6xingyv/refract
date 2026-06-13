use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const POPOVER_LABEL_PREFIX: &str = "refract-popover-";
#[cfg(target_os = "macos")]
const NS_VIEW_TAG_BLUR_VIEW: isize = 91376254;

#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, SWP_FRAMECHANGED, SWP_NOMOVE,
    SWP_NOSIZE, SWP_NOZORDER, WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
};

#[cfg(target_os = "macos")]
use objc2::msg_send;

#[cfg(target_os = "macos")]
use objc2_app_kit::{
    NSColor, NSPopUpMenuWindowLevel, NSWindow, NSWindowAnimationBehavior, NSWindowButton,
    NSWindowCollectionBehavior, NSWindowStyleMask, NSWindowTitleVisibility,
};

#[cfg(target_os = "macos")]
use window_vibrancy::{
    apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial, NSVisualEffectState,
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

#[derive(Serialize)]
struct NativePopoverMetrics {
    radius: f64,
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

/// Read SVG/PNG files dropped onto the app.
#[tauri::command]
fn read_image_assets(paths: Vec<String>) -> Result<Vec<Asset>, String> {
    let mut assets = Vec::new();
    for raw in paths {
        let path = PathBuf::from(&raw);
        if !path.is_file() {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_ascii_lowercase());
        if !matches!(ext.as_deref(), Some("svg" | "png")) {
            continue;
        }
        let name = path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .ok_or_else(|| format!("Invalid asset path: {}", path.display()))?;
        let bytes = fs::read(&path).map_err(|e| format!("{}: {}", path.display(), e))?;
        assets.push(Asset {
            name,
            data: STANDARD.encode(&bytes),
        });
    }
    Ok(assets)
}

#[cfg(target_os = "macos")]
fn popover_kind_from_label(label: &str) -> &str {
    label.strip_prefix(POPOVER_LABEL_PREFIX).unwrap_or_default()
}

#[cfg(target_os = "macos")]
fn popover_radius_for_kind(kind: &str) -> f64 {
    match kind {
        "dropdown" | "contextMenu" | "tooltip" => 8.0,
        _ => 10.0,
    }
}

#[cfg(target_os = "macos")]
fn native_popover_radius<R: tauri::Runtime>(window: &tauri::Window<R>) -> Option<f64> {
    let ns_window = window.ns_window().ok()?;
    if ns_window.is_null() {
        return None;
    }
    let ns_window = unsafe { &*(ns_window.cast::<NSWindow>()) };
    let content_view = ns_window.contentView()?;
    let blur_view = content_view.viewWithTag(NS_VIEW_TAG_BLUR_VIEW)?;
    let radius: f64 = unsafe { msg_send![&*blur_view, cornerRadius] };
    radius.is_finite().then_some(radius)
}

#[tauri::command]
fn native_popover_metrics<R: tauri::Runtime>(window: tauri::Window<R>) -> NativePopoverMetrics {
    #[cfg(target_os = "macos")]
    {
        let fallback = popover_radius_for_kind(popover_kind_from_label(window.label()));
        return NativePopoverMetrics {
            radius: native_popover_radius(&window).unwrap_or(fallback),
        };
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        NativePopoverMetrics { radius: 6.0 }
    }
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
        let mut next = (current | WS_EX_TOOLWINDOW.0) & !WS_EX_APPWINDOW.0;
        next &= !WS_EX_NOACTIVATE.0;
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
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED,
        );
    }
}

#[cfg(target_os = "macos")]
fn configure_popover_window_flags<R: tauri::Runtime>(window: &tauri::Window<R>) {
    let label = window.label();
    if !label.starts_with(POPOVER_LABEL_PREFIX) {
        return;
    }
    let kind = popover_kind_from_label(label);
    let (material, radius) = match kind {
        "dropdown" | "contextMenu" => (NSVisualEffectMaterial::Menu, popover_radius_for_kind(kind)),
        "tooltip" => (
            NSVisualEffectMaterial::Tooltip,
            popover_radius_for_kind(kind),
        ),
        _ => (
            NSVisualEffectMaterial::Popover,
            popover_radius_for_kind(kind),
        ),
    };
    let Ok(ns_window) = window.ns_window() else {
        return;
    };
    if ns_window.is_null() {
        return;
    }

    let ns_window = unsafe { &*(ns_window.cast::<NSWindow>()) };
    let native_popup_style = (ns_window.styleMask()
        | NSWindowStyleMask::Titled
        | NSWindowStyleMask::FullSizeContentView)
        & !(NSWindowStyleMask::Closable
            | NSWindowStyleMask::Miniaturizable
            | NSWindowStyleMask::Resizable);
    ns_window.setStyleMask(native_popup_style);
    let conflicting_behaviors = NSWindowCollectionBehavior::Managed
        | NSWindowCollectionBehavior::Stationary
        | NSWindowCollectionBehavior::ParticipatesInCycle
        | NSWindowCollectionBehavior::FullScreenPrimary
        | NSWindowCollectionBehavior::FullScreenNone;
    let popover_behaviors = NSWindowCollectionBehavior::MoveToActiveSpace
        | NSWindowCollectionBehavior::Transient
        | NSWindowCollectionBehavior::IgnoresCycle
        | NSWindowCollectionBehavior::FullScreenAuxiliary;

    ns_window.setLevel(NSPopUpMenuWindowLevel);
    ns_window.setCollectionBehavior(
        (ns_window.collectionBehavior() & !conflicting_behaviors) | popover_behaviors,
    );
    ns_window.setHidesOnDeactivate(true);
    ns_window.setExcludedFromWindowsMenu(true);
    ns_window.setAnimationBehavior(NSWindowAnimationBehavior::None);
    ns_window.setTitleVisibility(NSWindowTitleVisibility::Hidden);
    ns_window.setTitlebarAppearsTransparent(true);
    ns_window.setOpaque(false);
    ns_window.setBackgroundColor(Some(&NSColor::clearColor()));
    ns_window.setHasShadow(true);
    for button in [
        NSWindowButton::CloseButton,
        NSWindowButton::MiniaturizeButton,
        NSWindowButton::ZoomButton,
    ] {
        if let Some(button) = ns_window.standardWindowButton(button) {
            button.setHidden(true);
        }
    }
    let _ = clear_vibrancy(window.clone());
    let _ = apply_vibrancy(
        window.clone(),
        material,
        Some(NSVisualEffectState::Active),
        Some(radius),
    );
    ns_window.invalidateShadow();
}

#[cfg(not(any(windows, target_os = "macos")))]
fn configure_popover_window_flags<R: tauri::Runtime>(_window: &tauri::Window<R>) {}

fn window_system_integration_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("window-system-integration")
        .on_window_ready(|window| configure_popover_window_flags(&window))
        .on_webview_ready(|webview| configure_popover_window_flags(&webview.window()))
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(window_system_integration_plugin())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            read_icon,
            save_icon,
            export_pngs,
            read_image_assets,
            native_popover_metrics
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
