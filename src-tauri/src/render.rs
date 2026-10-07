use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Cursor;
use tiny_skia::{Pixmap, Transform};

const LOGICAL_SIZE: f32 = 1024.0;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderAsset {
    name: String,
    data_url: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackdropSpec {
    kind: String,
    color: String,
    image: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderedPng {
    data: String,
    width: u32,
    height: u32,
    renderer: &'static str,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RenderOptions {
    layer: Option<String>,
    clip_chiclet: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderPreviewRequest {
    doc: IconDocument,
    size: u32,
    slot: Option<String>,
    backdrop: Option<BackdropSpec>,
    #[serde(default)]
    options: Option<RenderOptions>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderLayerThumbRequest {
    layer: serde_json::Value,
    size: u32,
    dark: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IconDocument {
    composition: IconComposition,
    #[serde(default = "default_platform")]
    preview_platform: String,
    #[serde(default = "default_rendition")]
    preview_rendition: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IconComposition {
    #[serde(default)]
    groups: Vec<Group>,
    #[serde(default = "default_fill")]
    fill: Fill,
    #[serde(default)]
    fill_specs: HashMap<String, Fill>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Group {
    #[serde(default)]
    is_hidden: bool,
    #[serde(default)]
    layers: Vec<Layer>,
    #[serde(default = "one")]
    opacity: f32,
    #[serde(default)]
    position: Position,
    #[serde(default = "one")]
    scale: f32,
    #[serde(default = "normal_blend")]
    blend_mode: String,
    #[serde(default)]
    specs: HashMap<String, GroupSpec>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct GroupSpec {
    opacity: Option<f32>,
    blend_mode: Option<String>,
    is_hidden: Option<bool>,
    position: Option<Position>,
    scale: Option<f32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Layer {
    #[serde(default)]
    is_hidden: bool,
    #[serde(default)]
    image_name: Option<String>,
    #[serde(default = "default_fill")]
    fill: Fill,
    #[serde(default = "one")]
    opacity: f32,
    #[serde(default)]
    position: Position,
    #[serde(default = "one")]
    scale: f32,
    #[serde(default = "normal_blend")]
    blend_mode: String,
    #[serde(default)]
    specs: HashMap<String, LayerSpec>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct LayerSpec {
    image_name: Option<Option<String>>,
    fill: Option<Fill>,
    opacity: Option<f32>,
    blend_mode: Option<String>,
    is_hidden: Option<bool>,
    position: Option<Position>,
    scale: Option<f32>,
}

#[derive(Debug, Copy, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Position {
    #[serde(default)]
    x: f32,
    #[serde(default)]
    y: f32,
}

impl Default for Position {
    fn default() -> Self {
        Self { x: 0.0, y: 0.0 }
    }
}

#[derive(Debug, Copy, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Color {
    r: f32,
    g: f32,
    b: f32,
    #[serde(default = "one")]
    a: f32,
}

#[derive(Debug, Copy, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fill {
    #[serde(default = "automatic_fill_kind")]
    kind: FillKind,
    #[serde(default = "default_primary")]
    primary_color: Color,
    #[serde(default = "default_secondary")]
    secondary_color: Color,
    #[serde(default = "default_orientation")]
    orientation_deg: f32,
}

#[derive(Debug, Copy, Clone, Deserialize, PartialEq, Eq)]
enum FillKind {
    #[serde(rename = "none")]
    None,
    #[serde(rename = "solid")]
    Solid,
    #[serde(rename = "linearGradient")]
    LinearGradient,
    #[serde(rename = "automatic")]
    Automatic,
    #[serde(rename = "automaticGradient")]
    AutomaticGradient,
}

#[derive(Clone)]
struct Image {
    width: u32,
    height: u32,
    data: Vec<u8>,
}

struct Canvas {
    size: u32,
    data: Vec<u8>,
}

struct PlatformInfo {
    corner_radius_pct: f32,
    circle: bool,
}

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
enum AssetKind {
    Png,
    Svg,
}

#[tauri::command]
pub fn render_preview(
    doc: IconDocument,
    assets: Vec<RenderAsset>,
    size: u32,
    slot: Option<String>,
    backdrop: Option<BackdropSpec>,
    options: Option<RenderOptions>,
) -> Result<RenderedPng, String> {
    let asset_map = decode_assets(assets);
    render_preview_with_assets(doc, &asset_map, size, slot, backdrop, options)
}

#[tauri::command]
pub fn render_previews(
    requests: Vec<RenderPreviewRequest>,
    assets: Vec<RenderAsset>,
) -> Result<Vec<RenderedPng>, String> {
    let asset_map = decode_assets(assets);
    requests
        .into_iter()
        .map(|request| {
            render_preview_with_assets(
                request.doc,
                &asset_map,
                request.size,
                request.slot,
                request.backdrop,
                request.options,
            )
        })
        .collect()
}

fn render_preview_with_assets(
    doc: IconDocument,
    asset_map: &HashMap<String, Image>,
    size: u32,
    slot: Option<String>,
    backdrop: Option<BackdropSpec>,
    options: Option<RenderOptions>,
) -> Result<RenderedPng, String> {
    let size = size.clamp(16, 2048);
    let options = options.unwrap_or_default();
    let layer_mode = match options.layer.as_deref() {
        Some("foreground") => "foreground",
        Some("background") => "background",
        _ => "combined",
    };
    let include_background = layer_mode != "foreground";
    let include_foreground = layer_mode != "background";
    let mut canvas = Canvas::new(size);
    let slot = slot.or_else(|| spec_slot(&doc.preview_rendition));

    if include_background {
        if let Some(backdrop) = backdrop.as_ref() {
            paint_backdrop(&mut canvas, backdrop);
        }
        paint_background(&mut canvas, &doc, slot.as_deref());
    }

    if include_foreground {
        for group_raw in doc.composition.groups.iter().rev() {
            let group = resolve_group(group_raw, slot.as_deref(), Some(&doc.preview_platform));
            if group.is_hidden {
                continue;
            }

            for layer_raw in group.layers.iter().rev() {
                let layer = resolve_layer(layer_raw, slot.as_deref(), Some(&doc.preview_platform));
                if layer.is_hidden {
                    continue;
                }

                let source = rasterize_layer(&layer, asset_map, size);
                let layer_image = if layer.image_name.is_some() && layer.fill.kind == FillKind::None
                {
                    source
                } else {
                    fill_shape(&source, layer.fill, rendition_dark(&doc.preview_rendition))
                };
                draw_transformed(&mut canvas, &layer_image, &group, &layer);
            }
        }
    }

    if options.clip_chiclet.unwrap_or(true) {
        apply_chiclet_mask(&mut canvas, platform_info(&doc.preview_platform));
    }
    let png = encode_png(&canvas)?;
    Ok(RenderedPng {
        data: STANDARD.encode(png),
        width: size,
        height: size,
        renderer: "rust-cpu",
    })
}

#[tauri::command]
pub fn render_layer_thumb(
    layer: serde_json::Value,
    assets: Vec<RenderAsset>,
    size: u32,
    dark: bool,
) -> Result<RenderedPng, String> {
    let asset_map = decode_assets(assets);
    render_layer_thumb_with_assets(layer, &asset_map, size, dark)
}

#[tauri::command]
pub fn render_layer_thumbs(
    requests: Vec<RenderLayerThumbRequest>,
    assets: Vec<RenderAsset>,
) -> Result<Vec<RenderedPng>, String> {
    let asset_map = decode_assets(assets);
    requests
        .into_iter()
        .map(|request| {
            render_layer_thumb_with_assets(request.layer, &asset_map, request.size, request.dark)
        })
        .collect()
}

fn render_layer_thumb_with_assets(
    layer: serde_json::Value,
    asset_map: &HashMap<String, Image>,
    size: u32,
    dark: bool,
) -> Result<RenderedPng, String> {
    let layer: Layer = serde_json::from_value(layer).map_err(|error| error.to_string())?;
    let size = size.clamp(16, 512);
    let shape = rasterize_layer(&layer, asset_map, size);
    let image = if layer.image_name.is_some() && layer.fill.kind == FillKind::None {
        shape
    } else {
        fill_shape(&shape, layer.fill, dark)
    };
    Ok(RenderedPng {
        data: STANDARD.encode(encode_rgba_png(image.width, image.height, &image.data)?),
        width: image.width,
        height: image.height,
        renderer: "rust-cpu",
    })
}

fn decode_assets(assets: Vec<RenderAsset>) -> HashMap<String, Image> {
    assets
        .into_iter()
        .filter_map(|asset| {
            let bytes = decode_data_url(&asset.data_url)?;
            decode_asset(asset_kind(&asset), &bytes)
                .ok()
                .map(|image| (asset.name, image))
        })
        .collect()
}

fn asset_kind(asset: &RenderAsset) -> AssetKind {
    let name = asset.name.to_ascii_lowercase();
    let data_url = asset.data_url.to_ascii_lowercase();
    if name.ends_with(".svg") || data_url.starts_with("data:image/svg+xml") {
        AssetKind::Svg
    } else {
        AssetKind::Png
    }
}

fn decode_asset(kind: AssetKind, bytes: &[u8]) -> Result<Image, String> {
    match kind {
        AssetKind::Svg => decode_svg(bytes).or_else(|_| decode_png(bytes)),
        AssetKind::Png => decode_png(bytes).or_else(|_| decode_svg(bytes)),
    }
}

fn decode_data_url(data_url: &str) -> Option<Vec<u8>> {
    let encoded = data_url
        .split_once(',')
        .map(|(_, data)| data)
        .unwrap_or(data_url);
    STANDARD.decode(encoded.trim()).ok()
}

fn decode_png(bytes: &[u8]) -> Result<Image, String> {
    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    // Normalize palette, low-bit-depth, grayscale and 16-bit PNGs before
    // converting them to the renderer's straight RGBA8 representation. This
    // also preserves tRNS/palette transparency instead of dropping the asset.
    decoder.set_transformations(png::Transformations::normalize_to_color8());
    let mut reader = decoder.read_info().map_err(|error| error.to_string())?;
    let mut buf = vec![
        0;
        reader
            .output_buffer_size()
            .ok_or("Missing PNG output size")?
    ];
    let info = reader
        .next_frame(&mut buf)
        .map_err(|error| error.to_string())?;
    let bytes = &buf[..info.buffer_size()];
    if info.bit_depth != png::BitDepth::Eight {
        return Err("PNG normalization did not produce 8-bit pixels".into());
    }

    let mut data = Vec::with_capacity(info.width as usize * info.height as usize * 4);
    match info.color_type {
        png::ColorType::Rgba => data.extend_from_slice(bytes),
        png::ColorType::Rgb => {
            for px in bytes.chunks_exact(3) {
                data.extend_from_slice(&[px[0], px[1], px[2], 255]);
            }
        }
        png::ColorType::GrayscaleAlpha => {
            for px in bytes.chunks_exact(2) {
                data.extend_from_slice(&[px[0], px[0], px[0], px[1]]);
            }
        }
        png::ColorType::Grayscale => {
            for y in bytes {
                data.extend_from_slice(&[*y, *y, *y, 255]);
            }
        }
        png::ColorType::Indexed => {
            return Err("PNG normalization did not expand indexed pixels".into());
        }
    }

    Ok(Image {
        width: info.width,
        height: info.height,
        data,
    })
}

fn decode_svg(bytes: &[u8]) -> Result<Image, String> {
    let opt = usvg::Options::default();
    let tree = usvg::Tree::from_data(bytes, &opt).map_err(|error| error.to_string())?;
    let svg_size = tree.size();
    let width = svg_size.width().ceil().clamp(1.0, 4096.0) as u32;
    let height = svg_size.height().ceil().clamp(1.0, 4096.0) as u32;
    let mut pixmap = Pixmap::new(width, height).ok_or("Invalid SVG render target size")?;
    let transform = Transform::from_scale(
        width as f32 / svg_size.width(),
        height as f32 / svg_size.height(),
    );
    resvg::render(&tree, transform, &mut pixmap.as_mut());
    Ok(Image {
        width,
        height,
        data: pixmap.take_demultiplied(),
    })
}

fn encode_png(canvas: &Canvas) -> Result<Vec<u8>, String> {
    encode_rgba_png(canvas.size, canvas.size, &canvas.data)
}

fn encode_rgba_png(width: u32, height: u32, data: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|error| error.to_string())?;
        writer
            .write_image_data(data)
            .map_err(|error| error.to_string())?;
    }
    Ok(out)
}

fn rasterize_layer(layer: &Layer, assets: &HashMap<String, Image>, size: u32) -> Image {
    if let Some(name) = layer.image_name.as_ref() {
        if let Some(image) = assets.get(name) {
            return fit_image(image, size);
        }
    }
    placeholder_shape(size)
}

fn fit_image(image: &Image, size: u32) -> Image {
    let mut out = Image::transparent(size, size);
    let scale = (size as f32 / image.width as f32).min(size as f32 / image.height as f32);
    let w = (image.width as f32 * scale).max(1.0);
    let h = (image.height as f32 * scale).max(1.0);
    let left = (size as f32 - w) * 0.5;
    let top = (size as f32 - h) * 0.5;

    for y in 0..size {
        for x in 0..size {
            let sx = (x as f32 + 0.5 - left) / scale - 0.5;
            let sy = (y as f32 + 0.5 - top) / scale - 0.5;
            if sx < 0.0
                || sy < 0.0
                || sx > image.width as f32 - 1.0
                || sy > image.height as f32 - 1.0
            {
                continue;
            }
            let px = sample_bilinear(image, sx, sy);
            out.set_pixel(x, y, px);
        }
    }

    out
}

fn placeholder_shape(size: u32) -> Image {
    let mut out = Image::transparent(size, size);
    let inset = size as f32 * 0.16;
    let side = size as f32 - inset * 2.0;
    let radius = size as f32 * 0.22;
    for y in 0..size {
        for x in 0..size {
            let a = rounded_shape_alpha(
                x as f32 + 0.5,
                y as f32 + 0.5,
                inset,
                inset,
                side,
                side,
                radius,
            );
            if a > 0.0 {
                out.set_pixel(x, y, [255, 255, 255, byte(a)]);
            }
        }
    }
    out
}

fn fill_shape(shape: &Image, fill: Fill, dark: bool) -> Image {
    let mut out = Image::transparent(shape.width, shape.height);
    if fill.kind == FillKind::None {
        return out;
    }

    let (x0, y0, x1, y1) =
        gradient_line(shape.width.max(shape.height) as f32, fill.orientation_deg);
    let vx = x1 - x0;
    let vy = y1 - y0;
    let denom = (vx * vx + vy * vy).max(1.0);
    let gradient_stop = if fill.kind == FillKind::AutomaticGradient {
        shade(fill.primary_color, if dark { 0.55 } else { 0.78 })
    } else {
        fill.secondary_color
    };

    for y in 0..shape.height {
        for x in 0..shape.width {
            let src = shape.pixel(x, y);
            let alpha = src[3] as f32 / 255.0;
            if alpha <= 0.0 {
                continue;
            }
            let t = if fill.kind == FillKind::LinearGradient
                || fill.kind == FillKind::AutomaticGradient
            {
                (((x as f32 - x0) * vx + (y as f32 - y0) * vy) / denom).clamp(0.0, 1.0)
            } else {
                0.0
            };
            let c = if fill.kind == FillKind::LinearGradient
                || fill.kind == FillKind::AutomaticGradient
            {
                mix(fill.primary_color, gradient_stop, t)
            } else if fill.kind == FillKind::Automatic {
                mix(system_bg_start(dark), system_bg_end(dark), t)
            } else {
                fill.primary_color
            };
            out.set_pixel(x, y, [byte(c.r), byte(c.g), byte(c.b), byte(alpha * c.a)]);
        }
    }
    out
}

fn draw_transformed(canvas: &mut Canvas, source: &Image, group: &Group, layer: &Layer) {
    let size = canvas.size as f32;
    let k = size / LOGICAL_SIZE;
    let tx = (group.position.x + layer.position.x) * k;
    let ty = (group.position.y + layer.position.y) * k;
    let scale = (group.scale * layer.scale).max(0.001);
    let center = size * 0.5;
    let opacity = (group.opacity * layer.opacity).clamp(0.0, 1.0);

    for y in 0..canvas.size {
        for x in 0..canvas.size {
            let sx = center + ((x as f32 + 0.5 - tx - center) / scale) - 0.5;
            let sy = center + ((y as f32 + 0.5 - ty - center) / scale) - 0.5;
            if sx < 0.0
                || sy < 0.0
                || sx > source.width as f32 - 1.0
                || sy > source.height as f32 - 1.0
            {
                continue;
            }
            let mut px = sample_bilinear(source, sx, sy);
            px[3] = byte((px[3] as f32 / 255.0) * opacity);
            canvas.blend_pixel(x, y, px, &layer.blend_mode);
        }
    }
}

fn paint_background(canvas: &mut Canvas, doc: &IconDocument, slot: Option<&str>) {
    let fill = slot
        .and_then(|key| doc.composition.fill_specs.get(key).copied())
        .unwrap_or(doc.composition.fill);
    paint_fill_rect(canvas, fill, rendition_dark(&doc.preview_rendition));
}

fn paint_fill_rect(canvas: &mut Canvas, fill: Fill, dark: bool) {
    if fill.kind == FillKind::None {
        return;
    }
    let (x0, y0, x1, y1) = gradient_line(
        canvas.size as f32,
        if fill.kind == FillKind::Automatic {
            90.0
        } else {
            fill.orientation_deg
        },
    );
    let vx = x1 - x0;
    let vy = y1 - y0;
    let denom = (vx * vx + vy * vy).max(1.0);
    let gradient_stop = if fill.kind == FillKind::AutomaticGradient {
        shade(fill.primary_color, if dark { 0.55 } else { 0.78 })
    } else {
        fill.secondary_color
    };

    for y in 0..canvas.size {
        for x in 0..canvas.size {
            let t = (((x as f32 - x0) * vx + (y as f32 - y0) * vy) / denom).clamp(0.0, 1.0);
            let c = match fill.kind {
                FillKind::Solid => fill.primary_color,
                FillKind::LinearGradient => mix(fill.primary_color, fill.secondary_color, t),
                FillKind::AutomaticGradient => mix(fill.primary_color, gradient_stop, t),
                FillKind::Automatic => mix(system_bg_start(dark), system_bg_end(dark), t),
                FillKind::None => continue,
            };
            canvas.blend_pixel(x, y, [byte(c.r), byte(c.g), byte(c.b), byte(c.a)], "normal");
        }
    }
}

fn paint_backdrop(canvas: &mut Canvas, backdrop: &BackdropSpec) {
    if backdrop.kind == "image" {
        let preset = backdrop_preset(backdrop.image);
        let radial = preset.2;
        for y in 0..canvas.size {
            for x in 0..canvas.size {
                let t = if radial {
                    let cx = canvas.size as f32 * 0.3;
                    let cy = canvas.size as f32 * 0.2;
                    let dx = x as f32 - cx;
                    let dy = y as f32 - cy;
                    (dx.hypot(dy) / (canvas.size as f32 * 1.414)).clamp(0.0, 1.0)
                } else {
                    ((x + y) as f32 / (canvas.size.saturating_sub(1).max(1) * 2) as f32)
                        .clamp(0.0, 1.0)
                };
                let c = mix(preset.0, preset.1, t);
                canvas.set_pixel(x, y, [byte(c.r), byte(c.g), byte(c.b), 255]);
            }
        }
    } else {
        let c = parse_hex_color(&backdrop.color).unwrap_or(Color {
            r: 0.92,
            g: 0.92,
            b: 0.94,
            a: 1.0,
        });
        canvas.clear([byte(c.r), byte(c.g), byte(c.b), byte(c.a)]);
    }
}

fn apply_chiclet_mask(canvas: &mut Canvas, platform: PlatformInfo) {
    let size = canvas.size;
    let radius = size as f32 * platform.corner_radius_pct;
    for y in 0..size {
        for x in 0..size {
            let alpha = if platform.circle {
                circle_alpha(
                    x as f32 + 0.5,
                    y as f32 + 0.5,
                    size as f32 * 0.5,
                    size as f32 * 0.5,
                    size as f32 * 0.5,
                )
            } else {
                rounded_shape_alpha(
                    x as f32 + 0.5,
                    y as f32 + 0.5,
                    0.0,
                    0.0,
                    size as f32,
                    size as f32,
                    radius,
                )
            };
            let i = ((y * size + x) * 4 + 3) as usize;
            canvas.data[i] = byte((canvas.data[i] as f32 / 255.0) * alpha);
        }
    }
}

fn resolve_group(raw: &Group, slot: Option<&str>, platform_slot: Option<&str>) -> Group {
    let mut out = raw.clone();
    if let Some(slot) = slot {
        if let Some(spec) = raw.specs.get(slot) {
            apply_group_spec(&mut out, spec);
        }
    }
    if let Some(platform_slot) = platform_slot {
        if Some(platform_slot) != slot {
            if let Some(spec) = raw.specs.get(platform_slot) {
                apply_group_spec(&mut out, spec);
            }
        }
    }
    out
}

fn apply_group_spec(group: &mut Group, spec: &GroupSpec) {
    if let Some(value) = spec.opacity {
        group.opacity = value;
    }
    if let Some(value) = spec.blend_mode.as_ref() {
        group.blend_mode = value.clone();
    }
    if let Some(value) = spec.is_hidden {
        group.is_hidden = value;
    }
    if let Some(value) = spec.position {
        group.position = value;
    }
    if let Some(value) = spec.scale {
        group.scale = value;
    }
}

fn resolve_layer(raw: &Layer, slot: Option<&str>, platform_slot: Option<&str>) -> Layer {
    let mut out = raw.clone();
    if let Some(slot) = slot {
        if let Some(spec) = raw.specs.get(slot) {
            apply_layer_spec(&mut out, spec);
        }
    }
    if let Some(platform_slot) = platform_slot {
        if Some(platform_slot) != slot {
            if let Some(spec) = raw.specs.get(platform_slot) {
                apply_layer_spec(&mut out, spec);
            }
        }
    }
    out
}

fn apply_layer_spec(layer: &mut Layer, spec: &LayerSpec) {
    if let Some(value) = spec.image_name.as_ref() {
        layer.image_name = value.clone();
    }
    if let Some(value) = spec.fill {
        layer.fill = value;
    }
    if let Some(value) = spec.opacity {
        layer.opacity = value;
    }
    if let Some(value) = spec.blend_mode.as_ref() {
        layer.blend_mode = value.clone();
    }
    if let Some(value) = spec.is_hidden {
        layer.is_hidden = value;
    }
    if let Some(value) = spec.position {
        layer.position = value;
    }
    if let Some(value) = spec.scale {
        layer.scale = value;
    }
}

impl Canvas {
    fn new(size: u32) -> Self {
        Self {
            size,
            data: vec![0; size as usize * size as usize * 4],
        }
    }

    fn clear(&mut self, px: [u8; 4]) {
        for chunk in self.data.chunks_exact_mut(4) {
            chunk.copy_from_slice(&px);
        }
    }

    fn set_pixel(&mut self, x: u32, y: u32, px: [u8; 4]) {
        let i = ((y * self.size + x) * 4) as usize;
        self.data[i..i + 4].copy_from_slice(&px);
    }

    fn blend_pixel(&mut self, x: u32, y: u32, src: [u8; 4], mode: &str) {
        if src[3] == 0 {
            return;
        }
        let i = ((y * self.size + x) * 4) as usize;
        let dst = [
            self.data[i],
            self.data[i + 1],
            self.data[i + 2],
            self.data[i + 3],
        ];
        let out = blend(dst, src, mode);
        self.data[i..i + 4].copy_from_slice(&out);
    }
}

impl Image {
    fn transparent(width: u32, height: u32) -> Self {
        Self {
            width,
            height,
            data: vec![0; width as usize * height as usize * 4],
        }
    }

    fn pixel(&self, x: u32, y: u32) -> [u8; 4] {
        let i = ((y * self.width + x) * 4) as usize;
        [
            self.data[i],
            self.data[i + 1],
            self.data[i + 2],
            self.data[i + 3],
        ]
    }

    fn set_pixel(&mut self, x: u32, y: u32, px: [u8; 4]) {
        let i = ((y * self.width + x) * 4) as usize;
        self.data[i..i + 4].copy_from_slice(&px);
    }
}

fn sample_bilinear(image: &Image, x: f32, y: f32) -> [u8; 4] {
    let x0 = x.floor().clamp(0.0, image.width.saturating_sub(1) as f32) as u32;
    let y0 = y.floor().clamp(0.0, image.height.saturating_sub(1) as f32) as u32;
    let x1 = (x0 + 1).min(image.width - 1);
    let y1 = (y0 + 1).min(image.height - 1);
    let tx = x - x0 as f32;
    let ty = y - y0 as f32;
    let pixels = [
        (image.pixel(x0, y0), (1.0 - tx) * (1.0 - ty)),
        (image.pixel(x1, y0), tx * (1.0 - ty)),
        (image.pixel(x0, y1), (1.0 - tx) * ty),
        (image.pixel(x1, y1), tx * ty),
    ];

    // Interpolate premultiplied RGB, then unpremultiply. Interpolating
    // straight RGB would pull arbitrary RGB values from transparent PNG
    // texels into antialiased edges and create dark/bright fringes.
    let mut alpha = 0.0;
    let mut premul = [0.0; 3];
    for (px, weight) in pixels {
        let a = px[3] as f32 / 255.0;
        alpha += a * weight;
        for channel in 0..3 {
            premul[channel] += (px[channel] as f32 / 255.0) * a * weight;
        }
    }

    if alpha <= 1e-6 {
        return [0, 0, 0, 0];
    }
    let mut out = [0; 4];
    for channel in 0..3 {
        out[channel] = byte(premul[channel] / alpha);
    }
    out[3] = byte(alpha);
    out
}

fn blend(dst: [u8; 4], src: [u8; 4], mode: &str) -> [u8; 4] {
    let sa = src[3] as f32 / 255.0;
    let da = dst[3] as f32 / 255.0;
    let oa = sa + da * (1.0 - sa);
    if oa <= 0.0 {
        return [0, 0, 0, 0];
    }

    let mut out = [0; 4];
    for i in 0..3 {
        let sc = src[i] as f32 / 255.0;
        let dc = dst[i] as f32 / 255.0;
        let blended = match mode {
            "multiply" | "plus-darker" => sc * dc,
            "screen" => 1.0 - (1.0 - sc) * (1.0 - dc),
            "darken" => sc.min(dc),
            "lighten" | "plus-lighter" => sc.max(dc),
            _ => sc,
        };
        let oc = (blended * sa + dc * da * (1.0 - sa)) / oa;
        out[i] = byte(oc);
    }
    out[3] = byte(oa);
    out
}

fn rounded_shape_alpha(px: f32, py: f32, x: f32, y: f32, w: f32, h: f32, radius: f32) -> f32 {
    let radius = radius.clamp(0.0, w.min(h) * 0.5);
    if radius <= 0.0 {
        return if px >= x && px <= x + w && py >= y && py <= y + h {
            1.0
        } else {
            0.0
        };
    }
    let cx = (px - (x + w * 0.5)).abs() - (w * 0.5 - radius);
    let cy = (py - (y + h * 0.5)).abs() - (h * 0.5 - radius);
    let ox = cx.max(0.0);
    let oy = cy.max(0.0);
    let outside = (ox.powf(4.5) + oy.powf(4.5)).powf(1.0 / 4.5) - radius;
    (0.5 - outside).clamp(0.0, 1.0)
}

fn circle_alpha(px: f32, py: f32, cx: f32, cy: f32, r: f32) -> f32 {
    (0.5 - ((px - cx).hypot(py - cy) - r)).clamp(0.0, 1.0)
}

fn gradient_line(size: f32, deg: f32) -> (f32, f32, f32, f32) {
    let r = deg.to_radians();
    let dx = r.cos() * size * 0.5;
    let dy = r.sin() * size * 0.5;
    (
        size * 0.5 - dx,
        size * 0.5 - dy,
        size * 0.5 + dx,
        size * 0.5 + dy,
    )
}

fn mix(a: Color, b: Color, t: f32) -> Color {
    Color {
        r: a.r + (b.r - a.r) * t,
        g: a.g + (b.g - a.g) * t,
        b: a.b + (b.b - a.b) * t,
        a: a.a + (b.a - a.a) * t,
    }
}

fn shade(c: Color, amount: f32) -> Color {
    Color {
        r: (c.r * amount).clamp(0.0, 1.0),
        g: (c.g * amount).clamp(0.0, 1.0),
        b: (c.b * amount).clamp(0.0, 1.0),
        a: c.a,
    }
}

fn byte(v: f32) -> u8 {
    (v.clamp(0.0, 1.0) * 255.0).round() as u8
}

fn parse_hex_color(value: &str) -> Option<Color> {
    let hex = value.trim().trim_start_matches('#');
    if hex.len() != 6 && hex.len() != 8 {
        return None;
    }
    let rgb = u32::from_str_radix(&hex[..6], 16).ok()?;
    let a = if hex.len() == 8 {
        u8::from_str_radix(&hex[6..], 16).ok()? as f32 / 255.0
    } else {
        1.0
    };
    Some(Color {
        r: ((rgb >> 16) & 255) as f32 / 255.0,
        g: ((rgb >> 8) & 255) as f32 / 255.0,
        b: (rgb & 255) as f32 / 255.0,
        a,
    })
}

fn backdrop_preset(index: usize) -> (Color, Color, bool) {
    const PRESETS: [(&str, &str, bool); 6] = [
        ("#ff5e62", "#ff9966", false),
        ("#36d1dc", "#5b86e5", false),
        ("#a18cd1", "#fbc2eb", false),
        ("#11998e", "#38ef7d", false),
        ("#fc5c7d", "#6a82fb", false),
        ("#ffd86f", "#fc6262", true),
    ];
    let (a, b, radial) = PRESETS[index.min(PRESETS.len() - 1)];
    (
        parse_hex_color(a).unwrap(),
        parse_hex_color(b).unwrap(),
        radial,
    )
}

fn platform_info(platform: &str) -> PlatformInfo {
    match platform {
        "macOS" => PlatformInfo {
            corner_radius_pct: 0.1855,
            circle: false,
        },
        "watchOS" | "visionOS" => PlatformInfo {
            corner_radius_pct: 0.5,
            circle: true,
        },
        "tvOS" => PlatformInfo {
            corner_radius_pct: 0.1,
            circle: false,
        },
        _ => PlatformInfo {
            corner_radius_pct: 0.26,
            circle: false,
        },
    }
}

fn spec_slot(rendition: &str) -> Option<String> {
    match rendition {
        "Dark" => Some("Dark".into()),
        "Mono" | "TintedLight" | "TintedDark" => Some("Mono".into()),
        "Default" | "Light" => Some("Default".into()),
        _ => None,
    }
}

fn rendition_dark(rendition: &str) -> bool {
    matches!(rendition, "Dark" | "Mono" | "TintedDark" | "ClearDark")
}

fn system_bg_start(dark: bool) -> Color {
    if dark {
        Color {
            r: 60.0 / 255.0,
            g: 60.0 / 255.0,
            b: 66.0 / 255.0,
            a: 1.0,
        }
    } else {
        Color {
            r: 246.0 / 255.0,
            g: 247.0 / 255.0,
            b: 250.0 / 255.0,
            a: 1.0,
        }
    }
}

fn system_bg_end(dark: bool) -> Color {
    if dark {
        Color {
            r: 24.0 / 255.0,
            g: 24.0 / 255.0,
            b: 28.0 / 255.0,
            a: 1.0,
        }
    } else {
        Color {
            r: 219.0 / 255.0,
            g: 222.0 / 255.0,
            b: 230.0 / 255.0,
            a: 1.0,
        }
    }
}

fn default_fill() -> Fill {
    Fill {
        kind: FillKind::Automatic,
        primary_color: default_primary(),
        secondary_color: default_secondary(),
        orientation_deg: default_orientation(),
    }
}

fn default_primary() -> Color {
    Color {
        r: 0.36,
        g: 0.66,
        b: 1.0,
        a: 1.0,
    }
}

fn default_secondary() -> Color {
    Color {
        r: 0.18,
        g: 0.42,
        b: 0.95,
        a: 1.0,
    }
}

fn automatic_fill_kind() -> FillKind {
    FillKind::Automatic
}

fn default_orientation() -> f32 {
    90.0
}

fn default_platform() -> String {
    "iOS".into()
}

fn default_rendition() -> String {
    "Default".into()
}

fn normal_blend() -> String {
    "normal".into()
}

fn one() -> f32 {
    1.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn renders_minimal_document_as_png() {
        let doc: IconDocument = serde_json::from_value(json!({
            "composition": {
                "fill": {
                    "kind": "linearGradient",
                    "primaryColor": { "r": 0.2, "g": 0.48, "b": 1.0, "a": 1.0 },
                    "secondaryColor": { "r": 0.1, "g": 0.26, "b": 0.85, "a": 1.0 },
                    "orientationDeg": 90
                },
                "groups": [{
                    "isHidden": false,
                    "opacity": 1.0,
                    "position": { "x": 0.0, "y": 0.0 },
                    "scale": 1.0,
                    "blendMode": "normal",
                    "layers": [{
                        "isHidden": false,
                        "imageName": null,
                        "isGlass": true,
                        "fill": {
                            "kind": "solid",
                            "primaryColor": { "r": 0.95, "g": 0.97, "b": 1.0, "a": 1.0 },
                            "secondaryColor": { "r": 0.18, "g": 0.42, "b": 0.95, "a": 1.0 },
                            "orientationDeg": 90
                        },
                        "opacity": 1.0,
                        "position": { "x": 0.0, "y": 0.0 },
                        "scale": 1.0,
                        "blendMode": "normal"
                    }]
                }]
            },
            "previewPlatform": "iOS",
            "previewRendition": "Default"
        }))
        .unwrap();

        let rendered = render_preview(
            doc,
            Vec::new(),
            64,
            Some("Default".into()),
            Some(BackdropSpec {
                kind: "color".into(),
                color: "#ffffff".into(),
                image: 0,
            }),
            None,
        )
        .unwrap();
        let bytes = STANDARD.decode(rendered.data).unwrap();
        assert!(bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
        assert!(bytes.len() > 128);
    }

    #[test]
    fn decodes_svg_asset_for_rust_rendering() {
        let svg = br##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#ff3355"/></svg>"##;
        let image = decode_svg(svg).unwrap();
        assert_eq!(image.width, 32);
        assert_eq!(image.height, 32);
        assert!(image.data.chunks_exact(4).any(|px| px[3] > 0));
    }

    #[test]
    fn renders_layer_thumb_as_png() {
        let layer = json!({
            "isHidden": false,
            "imageName": null,
            "fill": {
                "kind": "solid",
                "primaryColor": { "r": 0.1, "g": 0.8, "b": 0.5, "a": 1.0 },
                "secondaryColor": { "r": 0.18, "g": 0.42, "b": 0.95, "a": 1.0 },
                "orientationDeg": 90
            },
            "opacity": 1.0,
            "position": { "x": 0.0, "y": 0.0 },
            "scale": 1.0,
            "blendMode": "normal"
        });
        let rendered = render_layer_thumb(layer, Vec::new(), 44, false).unwrap();
        let bytes = STANDARD.decode(rendered.data).unwrap();
        assert_eq!(rendered.width, 44);
        assert_eq!(rendered.height, 44);
        assert!(bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
    }

    #[test]
    fn bilinear_sampling_keeps_visible_color_at_transparent_edge() {
        let image = Image {
            width: 2,
            height: 2,
            data: vec![255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0],
        };
        let px = sample_bilinear(&image, 0.5, 0.5);
        assert!(px[0] > 240, "red channel was contaminated: {px:?}");
        assert!(px[1] < 16, "transparent RGB leaked into the sample: {px:?}");
        assert!(
            (120..=135).contains(&px[3]),
            "unexpected interpolated alpha: {px:?}"
        );
    }
}
