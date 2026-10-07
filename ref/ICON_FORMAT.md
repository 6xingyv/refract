# The `.icon` file format (Icon Composer 1.5)

Reverse-engineered from `IconComposerFoundation.framework` and **validated against Apple's own
compiler** `ictool` (the same tool Xcode invokes). Every shape below was confirmed by feeding a
candidate `icon.json` to:

```
ictool --output-format xml1 --platform macosx --minimum-deployment-target 26.0 \
       --compile <out-dir> <Foo.icon>
```

and checking for `com.apple.actool.errors` / a produced `Assets.car`. Items marked “validated”
compiled with **0 errors**; the compiler's own error strings pinned down the enum domains.

---

## 1. Package layout

```
Foo.icon/                 # a directory (package)
├── icon.json             # the composition (this document)
└── Assets/               # imported art, flat directory
    ├── symbol.svg
    └── badge.png
```

- `Assets/` is a flat directory of SVG / PNG files.
- A layer's `image-name` is the asset's **basename including its extension** (e.g. `"symbol.svg"`).
  *(Validated: `"symbol"` → “references an image … that does not exist”; `"symbol.svg"` → OK.)*

---

## 2. Top-level object (`icon.json` root)

| key | type | notes |
|---|---|---|
| `supported-platforms` | object | **required**. See below. Platforms observed from Apple's generator: `iOS`, `macOS`, `watchOS`. watchOS is a `circles` entry; iOS/macOS are `squares`. |
| `fill` | Fill (see §4) | the icon background fill. Apple's generator may omit this and put the base fill in `fill-specializations[0].value` instead. |
| `groups` | `[Group]` | the layer groups (back-to-front) |
| `fill-specializations` | `[Specialization<Fill>]` | background fill values/overrides. Apple's generator can use this for both the base fill and appearance overrides. |
| `color-space-for-untagged-svg-colors` | string | e.g. `"display-p3"` (optional). Present in Apple-generated files. |
| `implicit-asset-mirroring` | bool | (optional) |
| `features` | `[string]` | forward-compat gate; unknown values make older apps refuse the file. Omit. |

There is **no** top-level `version`/`format-version` field — versioning rides on `features`.

`supported-platforms`:
```json
{
  "supported-platforms": {
    "squares": "shared",
    "circles": ["watchOS"]
  }
}
```

- `squares` can be `"shared"` when iOS and macOS share one square composition.
- `squares` can also be an array, e.g. `["iOS", "macOS"]`, when square compositions are split.
- `circles` is an array; Apple's generated sample uses `["watchOS"]`.

---

## 3. Group & Layer

Both are dictionaries. Every per-member property is a `SpecializableProperty<T>`: it serializes as a
**base key** plus an optional **`<base>-specializations`** array (§5). Omit a property to use its default.
Apple's official generator also commonly serializes a property **only** as `<base>-specializations`,
with the first entry omitting all axes (`appearance`, `idiom`, etc.) to carry the default/base value.
Readers should therefore resolve a property from either the base key or the base specialization entry.

### Group
| base key | type | |
|---|---|---|
| `name` | string | |
| `layers` | `[Layer]` | |
| `opacity` | Double | 0…1 |
| `blend-mode` | BlendMode (§6) | |
| `lighting` | `"individual"` / `"combined"` | Liquid Glass “Mode” |
| `specular` | bool | Liquid Glass specular highlight on/off |
| `blur-material` | **Double** | strength; **bare number, not an object**. Omit = no blur. *(Validated: object form fails; `0.5` OK.)* |
| `translucency` | `{enabled:bool, value:Double}` | both keys required |
| `shadow` | `{kind:ShadowKind, opacity:Double}` | §6 |
| `position` | Position (§4) | |
| `is-hidden` | bool | |
| `asset-mirroring` | `{mirrorable:bool?}` | RTL mirroring |

Specialization keys observed: `opacity-specializations`, `blend-mode-specializations`,
`lighting-specializations`, `specular-specializations`, `blur-material-specializations`,
`translucency-specializations`, `shadow-specializations`, `position-specializations`,
`hidden-specializations`, `asset-mirroring-specializations`.

Apple-generated examples show:
- `blend-mode-specializations` without a base `blend-mode`.
- `blur-material-specializations` without a base `blur-material`.
- `shadow-specializations` without a base `shadow`.
- base `opacity`, `lighting`, `position`, `specular`, and `translucency` still emitted directly when unchanged.

### Layer
| base key | type | |
|---|---|---|
| `name` | string | |
| `image-name` | string (basename + ext) | references `Assets/<image-name>` |
| `is-glass` | bool | Liquid Glass on this layer |
| `fill` | Fill (§4) | |
| `opacity` | Double | |
| `blend-mode` | BlendMode | |
| `position` | Position | |
| `is-hidden` | bool | |
| `asset-mirroring` | `{mirrorable:bool?}` | |
| `kind`, `material` | (discriminators) | optional; leave absent |

Specialization keys: `image-name-specializations`, `glass-specializations` (note: `glass-`, not
`is-glass-`), `fill-specializations`, `opacity-specializations`, `blend-mode-specializations`,
`position-specializations`, `hidden-specializations`, `asset-mirroring-specializations`.

> Base keys are `is-hidden` / `is-glass`; the matching specialization arrays drop the `is-`
> (`hidden-specializations` / `glass-specializations`). *(Validated together in one document.)*

Apple-generated examples show layers with `fill-specializations`, `blend-mode-specializations`, or
`opacity-specializations` but no corresponding base `fill`, `blend-mode`, or `opacity` key. Layer
`is-glass` may also be omitted; treat absent optional base keys as defaults unless a specialization
entry overrides them.

---

## 4. Value types

### Color — a **string** `"<color-space>:<components>"`
- System color: `"named:system-blue"` (names: system-red/green/blue/orange/yellow/brown/pink/
  purple/gray/teal/indigo/mint/cyan).
- RGBA: `"srgb:r,g,b,a"`, `"extended-srgb:r,g,b,a"`, or `"display-p3:r,g,b,a"` — four comma-separated doubles.
- Gray: `"gray:white,alpha"` or `"extended-gray:white,alpha"` — two doubles.

*(Validated: srgb / extended-srgb / display-p3 / gray / extended-gray / named all compile.)*

### Fill — a string **or** a kind-keyed object
- `"none"` or `"automatic"` — bare strings.
- `{ "solid": <Color> }`
- `{ "linear-gradient": [<Color>, <Color>], "orientation": <Orientation> }` — exactly 2 colors.
- `{ "automatic-gradient": <Color> }`

`Orientation` = `{ "start": {"x":Double,"y":Double}, "stop": {"x":Double,"y":Double} }` (unit square,
top-left origin). *(Validated. Compiler: “A fill should be one of: orientation, solid, linear-gradient
or automatic-gradient”.)*

### Position
```json
{ "scale": 1.0, "translation-in-points": [x, y] }
```
- `translation-in-points` is a **2-element array** (a `CGVector`), in points (1024-pt logical canvas).
- Both `scale` and `translation-in-points` are required when `position` is present.
- Optional `relative-translation` (bool) + `translation` (array) select a normalized variant.

*(Validated: object `{dx,dy}` fails; array `[x,y]` OK; `scale`-only fails “missing”.)*

---

## 5. Specializations (per-appearance / per-platform overrides)

Each `<base>-specializations` is an **array** of objects:
```json
{ "appearance": "dark", "value": <same shape as the base value> }
```
- `appearance` is optional. If it is omitted, and no other axis (`idiom`, `localization`,
  `languageDirection`) is present, the entry is the default/base value for that property.
- `appearance` ∈ `base` / `light` / `dark` / `tinted` (mono is rendered from the `dark` source
  appearance; “clear” variants are expressed via the `*-clear` color renditions).
- Optional fields: `idiom` (platform/shape axis), `localization` (locale id), `languageDirection`
  (`language`/`base`/`left-to-right`/`right-to-left`).
- `value` matches the base type (Color string, Double, bool, Position object, …).

*(Validated: `opacity-specializations:[{appearance:dark, value:0.5}]` and
`glass-specializations:[{appearance:tinted, value:false}]` compile.)*

Apple-generated sample patterns:
```json
{
  "fill-specializations": [
    { "value": { "automatic-gradient": "srgb:0.35778,0.58113,0.76226,1.00000" } },
    {
      "appearance": "dark",
      "value": {
        "linear-gradient": [
          "srgb:0.13733,0.23684,0.41791,1.00000",
          "srgb:0.03860,0.07202,0.12349,1.00000"
        ],
        "orientation": {
          "start": { "x": 0.5, "y": 0 },
          "stop": { "x": 0.5, "y": 0.7 }
        }
      }
    }
  ],
  "blend-mode-specializations": [
    { "value": "normal" },
    { "appearance": "tinted", "value": "normal" }
  ]
}
```

Resolution rule for readers:
1. Start from the base key if present.
2. Apply any specialization entry with no axes as the base/default value.
3. Apply matching axis entries (`appearance`, `idiom`, localization/direction) over that base.

---

## 6. Enum domains (compiler-confirmed)

- **BlendMode**: `normal`, `plus-lighter`, `plus-darker`, `overlay`, `multiply`, `soft-light`,
  `hard-light`, `darken`, `lighten`, `screen`. *(`color` rejected — compiler listed the full set.)*
- **Lighting**: `individual`, `combined`.
- **Fill.kind**: `none`, `automatic`, `solid`, `linear-gradient`, `automatic-gradient`.
- **Shadow.kind**: `automatic`, `neutral`, `none`, `layer-color`. *(`chiclet` rejected.)*
- **Platform**: `iOS`, `macOS`, `watchOS`.
- **Color space**: `named`, `srgb`, `extended-srgb`, `display-p3`, `gray`, `extended-gray`.

---

## 7. Minimal valid example (compiles to `Assets.car`, 0 errors)

```json
{
  "supported-platforms": { "squares": ["iOS", "macOS"], "circles": ["watchOS"] },
  "fill": { "automatic-gradient": "extended-srgb:0,0.478,1,1" },
  "groups": [
    {
      "name": "Group",
      "blur-material": 0.5,
      "translucency": { "enabled": true, "value": 0.6 },
      "shadow": { "kind": "neutral", "opacity": 0.5 },
      "lighting": "combined",
      "specular": true,
      "position": { "scale": 1, "translation-in-points": [0, 0] },
      "layers": [
        {
          "name": "symbol",
          "image-name": "symbol.svg",
          "is-glass": true,
          "fill": { "solid": "named:system-blue" },
          "position": { "scale": 1, "translation-in-points": [0, 0] },
          "glass-specializations": [ { "appearance": "tinted", "value": false } ]
        }
      ]
    }
  ]
}
```

---

## 8. Apple-generated sample notes

`ref/icon.json` is an Apple official-tool output and illustrates the writer style used by current
tools:

- Root background fill is authored as `fill-specializations`, not a direct `fill`.
- The first specialization entry can be axisless (`{ "value": ... }`) and represents the default
  value.
- Dark/tinted appearances are written as additional specialization entries, e.g.
  `{ "appearance": "dark", "value": ... }`.
- `supported-platforms.squares` is `"shared"` for shared iOS/macOS square composition.
- Group blur and shadow can be emitted only as `blur-material-specializations` and
  `shadow-specializations`.
- Layer blend/fill/opacity can be emitted only as specialization arrays.
- Asset names may contain spaces and punctuation, e.g. `"2 – Layer.svg"`; `image-name` still matches
  the exact basename inside `Assets/`.
- `color-space-for-untagged-svg-colors` can be present at the root with value `"display-p3"`.

When round-tripping official files, preserve unknown top-level keys and axisless specialization
entries verbatim unless the editor intentionally rewrites that property. Preserve the original
color strings and gradient endpoints too: `display-p3` / `extended-srgb` carry color-space
information, and a gradient ending at `y:0.7` is not equivalent to one ending at `y:1`.

Actual shipped `.icon` files (StikDebug and Feather) also use `glass` and `hidden` as base keys.
Refract reads these aliases alongside `is-glass` and `is-hidden`, preserves their spelling for
imported properties, and emits only the active spelling when editing them. New documents retain
the `is-glass` / `is-hidden` spelling recorded as compiler-validated in section 3. The release
samples establish an alternate spelling, not a public canonicalization rule or acceptance by
every Icon Composer version; the historical compiler-validated example in section 7 is unchanged.

---

## 9. Inspector ↔ model map (for UI fidelity)

The inspector renders for the focused member; each property is a `SpecializableProperty`, surfaced
through a generic **Variation** menu (add a per-appearance / per-platform override).

- **Icon (root)** — Background (image / solid color), **Fill** (None / Solid / Gradient / Automatic /
  System Light / System Dark, with primary/secondary color wells + gradient orientation handle),
  **Tint** (color + spectrum-position + strength, 0–1), **Platforms** (iOS/macOS/watchOS, with a
  Shared / Unique / iOS-Only / macOS-Only composition scope), Document settings.
- **Group** — *Appearance*: Opacity, Blend Mode, Hidden. *Liquid Glass*: Specular (toggle),
  Blur (toggle + strength), Translucency (toggle + value), Shadow (**kind menu** + opacity),
  Lighting (Individual / Combined). *Composition*: Scale, Position X/Y (points), Mirror in RTL.
- **Layer** — Image (asset picker), Fill, Opacity, Blend Mode, Hidden, Glass (toggle),
  Composition: Scale / Position / Mirror in RTL.
- **Preview renditions** (6): Default(Light), Dark, Clear Light, Clear Dark, Tinted Light,
  Tinted Dark. The inspector still edits All / Default / Dark / Mono artwork. Clear and Tinted
  resolve the Mono artwork slot (encoded as `appearance:"tinted"`), falling back to base when
  absent. Legacy `Mono` remains an internal rendition for the inspector. This replaces the
  earlier preview assumption that Mono always resolves Dark artwork; the precise system
  fallback chain still requires CPU-side implementation analysis.

Note: the real Shadow control is **kind + opacity** (no colour well, no radius — the blur radius is
chosen by the renderer from the kind). Specular at the group level is a plain on/off.

---

## 10. Coverage of our reimplementation

**Read + written:** all base properties (§2–§6), root `fill-specializations`, official-generator
axisless default specialization entries, **appearance** specializations (`light` / `dark` /
`tinted`), and editable platform/idiom specializations (`iOS` / `macOS` / `watchOS`). Layer
`image-name-specializations`, `fill-specializations`, and asset mirroring specializations are also
modeled and round-trip. Unchanged imported properties retain their source representation,
including omitted defaults, color-space tags, gradient endpoints, and axisless entries. A changed
base value or editable override uses the canonical codec; unrelated values stay verbatim.

**Preserved verbatim** (via the original JSON kept per object) but not edited: `features`,
`material`, layer `kind`, `color-space-for-untagged-svg-colors`, etc.

**Not yet edited:** specialization axes outside the current UI model, such as `localization`,
`languageDirection`, `base`-appearance entries, and combined appearance + idiom overrides.
These entries are retained verbatim even when another slot of the same property is edited; they
are never projected into a global appearance/platform slot. The preview still only resolves the
editable axes, and its color/gradient model is an approximation of richer source values.

In particular, `appearance:"base"` with no `idiom` or other axis is **not** parsed as a default
value or exposed as an editable slot. It is retained unchanged. Editing the same property's base
key in the inspector does not update that entry, so the final file can contain a new base key
alongside the old explicit `base` appearance. Their precedence is not established by the inspected
samples; use Icon Composer to edit this form. Platform entries with `appearance:"base"` **and** a
recognized `idiom` remain editable platform slots. Apple's [authoring documentation](https://developer.apple.com/documentation/xcode/creating-your-app-icon-using-icon-composer)
describes the All setting and per-variant overrides but does not establish this JSON enum's
resolution rule.

**Package saves:** asset names are collected from the final encoded `image-name` and every
`image-name-specializations` entry, including overrides outside the UI model. Source SVG/PNG bytes
are written under the flat `Assets/` directory without rasterization. Missing/empty assets, duplicate
filenames ignoring case, invalid basenames, and malformed JSON are rejected before the existing
package is changed. Assets are written before `icon.json`; a filesystem error during writing can
still leave a partially updated package. No `Assets.car` compiler is included.

---

## 11. Rendering audit and shader alignment (2026-10-07)

### Evidence and scope

The material arithmetic below was reconstructed from `IconRendering.framework/default.metallib`
in Apple's iPhone16,1 iOS **26.4 release, 23E246** restore image. The MTLB function ranges and SHA-256
records were checked against extracted AIR modules before inspecting their LLVM IR. The modules
identify Metal 4.0, AIR 2.8, Apple metal compiler 32023.880 and SDK 26.4. Framework headers describe
available operations; they do not establish a runtime call sequence.

The library SHA-256 is `51f49dded42d3f6d9f9288f3c6990a6c293a73d323cdeb2af143deaf4edd7bf5`.
Relevant AIR function hashes:

| Function | SHA-256 |
| --- | --- |
| `glassHighlight_v1` | `9be71a8d2078847191e4b5095fd5e1f355b2c8d7c8215783c7b32dda4b70846e` |
| `shapeAwareGradientMask` | `b8842557770825597b7aafdd66d195fed92caeba0843bbafc0958b10c4adc21c` |
| `SimulatedGlass::glass_background` | `f4cf006592d6e89defbcb4da5b8b0dc9b05bf4b70612c870f266707ee914b022` |
| `SimulatedGlass::distance_gradient` | `c72f7f4d799c3efe2e6f82f0430b9b0a9fe5c1713ab1bc74b274387cfff341f7` |

Research binaries and disassembled IR are kept outside this repository. This section documents
the reconstructed arithmetic and its adapters, not a pixel-identical renderer or Apple's full
render graph. Apple's [WWDC25 authoring session](https://developer.apple.com/videos/play/wwdc2025/361/)
describes the three artwork variants and six display appearances.

### Implemented changes

| Area | Previous behavior | Current implementation |
| --- | --- | --- |
| Normals | Two broad Gaussian SDF passes, then a wider Sobel filter | Four central-difference samples; a fixed one-pixel signed-distance filter conditions our JFA input, with gradient attenuation near medial axes |
| Highlight | Squared curvature, smoothstep band, arbitrary intensity reduction and opposite fill light | Recovered lobe arithmetic with independent glyph static/dynamic widths and a separate container key/fill/rim pass; see the width follow-up below |
| Highlight color | White regardless of the specular color | Group specular color and opacity; separate additive premultiplied contribution |
| Translucency | Vertical ramp with hand-tuned light/density bands and saturation boosts | Vertical `simplifiedShapeAwareGradientMask_v1` with its own contour width and cubic opacity smoothing; see the direction follow-up below |
| Appearance | Final RGB transform also recolored specular light | Separate artwork and container-backdrop matrices; upper layers sample the scene with identity; specular remains separate |
| Alpha | Background blur sampled straight-alpha pixels; glass discarded background alpha | Premultiplied texture uploads/blur, preserved background alpha, straight-alpha material composition with one geometry coverage application |
| Transforms | Material rendered before moving/scaling the result; parent scale did not scale child translation | Geometry/color placed in icon coordinates before refraction; parent transform precedes child transform |
| Group composition | Group opacity applied per child; group blend ignored | Isolated group canvas, group opacity/blend applied once after child composition |
| Concurrent rendering | Preview/derived/export could overlap shared frame resource cleanup | A queue owns the complete frame across GPU readback and cleanup |
| Resources | Transient textures destroyed each frame; shape caches bounded only by count | Idle texture reuse with 64 MiB per backend, shape cache 128 MiB, shadow cache 32 MiB; warmup constrained by budget |
| Dynamic preview | Static light and incomplete rendition controls | Three artwork tiles; Mono has Clear/Tinted and Light/Dark preview controls, plus an optional light sweep that pauses when hidden/reduced motion is requested |

Both WGSL and GLSL use the same **68-float / 17-vec4** parameter layout. Slots 12–16 contain
specular RGBA and four affine RGB rows. Colored-shadow cache keys include the appearance matrix.
Zero-opacity shadows and disabled material blur skip their passes. Geometry preparation is
independent of light/tint changes, and obsolete derived batches stop between icons.

### Arithmetic and adapters

For highlight distance `d` after inset, height `h`, normal `n`, light direction `l`, spread `s`,
bias `b`, and curvature `c`, the AIR kernel computes:

```text
aa = clamp(fwidth(d), 2^-10, 2) * 0.8330078125
coverage = clamp((h-d)/aa + 0.5, 0, 1) * clamp(d/aa + 0.5, 0, 1)
curve = mix(1, 1-clamp(d/h, 0, 1), c)
light = clamp((dot(n,l)-s) / max(1-s, 2^-10), 0, 1)
intensity = curve * coverage * light / max(1+(1-light)*b, 2^-10)
```

Refract additionally gates by the glass/specular switches and geometry coverage. It starts the
preview bevel at the contour (zero inset) and converts height from the 1024-point design space.
It uses inward normals with incoming light; the highlight wrapper uses outward normals with light toward the
source. Reversing both leaves their dot product unchanged. Apple's kernel uses half precision
at several intermediate steps; our shader arithmetic uses float precision.

The material mask now uses the vertical simplified kernel documented in the translucency
follow-up below. Its contour width and opacity endpoints are independent of specular lighting.

Refraction uses `1-t*t*(3-2*t)` displacement, where `t` is clamped decoded distance/height,
followed by three RGB row dot products and an RGB offset. Apple's background shader decodes
its encoded SDF with a bias/scale and packed normals with `2*GB-1`; copying those constants into
our already-decoded field would be incorrect. Refract retains JFA-generated signed distance,
unpacked normals, premultiplied filtered input and straight-alpha pass outputs.

### Remaining differences

- Apple's full CPU-side parameter selection, appearance matrices, SDF generation/filtering and
  exact combined-lighting graph are not reconstructed. Standard shadow defaults and its blend
  arithmetic were subsequently recovered (see follow-up below). Height/inset/refraction scale,
  tint matrices and the Canvas-only fallback rim remain local approximations. The GPU container
  highlight now uses the recovered kernel/defaults with local light-routing and blend adapters.
- Our `color_layer` applies the recovered mask to a source coating; this is our pass composition,
  not evidence of a corresponding standalone Apple shader with that name. Apple also provides
  simplified mask, glow, clamp and SDF fill functions; their runtime selection is unverified.
- Display-P3/extended-sRGB metadata is preserved on save, but preview lacks the full wide-gamut,
  linear-light/HDR color pipeline. Light/Dark tint now has distinct targets, but its coefficients
  and the Clear Light/Dark veil strengths remain local preview policy.
- `localization`, `languageDirection` and combined appearance + idiom specializations are retained
  but not resolved; RTL mirroring flags are not applied by the preview.
- Authored Canvas `plus-darker` still approximates with multiply. Normal groups now use the native
  receiver-dependent shadow blend. Other group/item blends retain isolated shadow stacking.
  Group isolation is implemented, but
  Apple's interaction between refraction, group blend and group translucency remains unverified.
- Each glass item still reads GPU pixels back to Canvas2D; the whole composition is not resident
  on the GPU. Cache budgets bound retained resources, not peak memory inside one active frame.
- The Rust renderer remains a flat thumbnail path. GPU device/context-loss recovery and complete
  resource disposal are not implemented. The desktop light sweep does not simulate iOS motion
  sensing, smoothing, intensity or power policy.

Compilation: `bun run build` succeeds (TypeScript + Vite); all 14 active WGSL passes compile to
SPIR-V with Naga. This does not verify WebGL driver compilation, device rendering, visual parity
or measured performance. No automated tests were added or run for this rendering audit.

### Follow-up: thin strokes and material inputs

The initial AIR port wrongly assumed our raw JFA distance field was interchangeable with Apple's
prepared field. Integer boundary seeds give unstable derivatives around curves, and normalizing
very small gradients near a stroke's medial axis produces abrupt opposite directions. The preview
now conditions only the signed field used for normals with a one-pixel binomial filter, and limits
gradient amplification using the expected magnitude of a true distance field. Raw distance and
coverage remain unchanged. These are adapters for our JFA, not claimed Apple shader behavior.

The initial highlight mapping also made a 3-point height approximately 9.2 points wide, then
inset it by 60% of that height. Thin strokes could never reach the highlight band. The initial fix
used the design-space scale directly with a half-render-pixel minimum and started the band at
the edge. The width follow-up below supersedes that minimum/default and separates the refraction
bevel from highlight width.

Material fixes:

- Mono no longer refracts a neutral gray placeholder followed by backdrop luminance modulation.
  It samples the actual backdrop through the chiclet so blur/refraction retain background detail.
- Colored shadows use the source's actual per-pixel color and opacity. Sampling a nearest boundary
  seed could select a transparent pixel, producing black seams instead of the artwork's color.
- Material and shadow blur use Gaussian sigma explicitly, in premultiplied F16. Wide kernels first
  reduce the texture until sigma is at most 5.25 working pixels, then use RenderBox's CPU-built
  paired Gaussian taps, described below. They no longer skip thin features with radius-spaced taps.
  Shadow sigma uses the 1024-point design scale; the earlier extra radius multiplier is removed.
- Translucency uses the recovered vertical shape-aware mask, with a separate contour transition
  width, described below. Authored translucency interpolation remains local policy. The material
  blur-strength conversion was subsequently recovered in the percentage follow-up below.
  Automatic shadow currently falls back to Neutral; its material-dependent selection remains
  unverified. Standard preset opacity/offsets were subsequently recovered below.

### Follow-up: Mono backdrop and tint targets

The old material path used one matrix for source artwork, colored shadows and every sampled
background. This desaturated Clear's wallpaper and repeatedly tinted already-composited pixels
in a stack. It also converted every non-glass Mono layer into transparent glass, discarded its
fill, and silently changed translucency/blur. Non-glass artwork now retains its authored fill,
opacity and effects switch, whether lighting is individual or combined.

`appearance.ts` now owns separate artwork and backdrop policies. Apple's
[WWDC25 appearance overview](https://developer.apple.com/videos/play/wwdc2025/220/) describes
Tinted Dark as foreground coloring and Tinted Light as tint infused into glass. Refract now
applies dark tint to the monochrome coating and layer-color shadow, and light tint to the chiclet
backdrop. Clear preserves wallpaper chroma. Only the container applies the backdrop matrix;
all upper glass layers use identity for sampled scene pixels, so tint does not compound with
layer count. The old two-times-luminance multiplier is removed. Canvas fallback uses the same
affine arithmetic. The container cache includes its material matrix; switching mode, brightness
or the light tint color cannot reuse a differently colored backdrop.

Light/Dark Clear use a local neutral veil (16% white / 24% black). Light tint multiplies that
glass backdrop by the selected tint, while dark tint multiplies artwork luminance by the tint.
These values are explicitly **not** recovered Apple coefficients or a claim of visual parity.
The exact system tonal curves and material strengths still need reference-image calibration.
The Inspector exposes the tint color when Tinted is selected, rather than the misleading old
`Tint background` switch. Background-only exports now use the same material base as combined
renders. TypeScript/Vite compilation succeeds; this follow-up has not been visually compared
on Apple hardware.

### Follow-up: native shadow defaults and receiver composition

Source: iPhone16,1 iOS 26.4, build **23E246**, extracted from Apple's restore image/dyld cache.
The CPU binaries below include reconstructed Objective-C symbols and applied cache slide info;
hashes describe the extracted research artifacts, not original standalone distribution files.

| Artifact | SHA-256 |
| --- | --- |
| `IconRendering` | `58b0ba289849f19b6103528cc7e64000bdc29346d722d2246c0ef978b656bd76` |
| `RenderBox` | `24c6fc560a76d5fa387109a1432b672f0028225892b57d7347aac5616496dab8` |
| RenderBox `default.metallib` | `3fa535dfe0caf9eddd3d6a996988f39a62d47550b258cc6b2f20fff5797c1ed3` |

`ICRRenderingParameters.standardShadow` getter at `0x1b30c663c` locates the struct at offset
`0x528`. Its initializer at `0x1b308fea0` supplies the following defaults:

| Shadow field | Native default | Refract mapping |
| --- | --- | --- |
| bias | 0.5 | Runtime application not reconstructed |
| offsetX / offsetY | 16 / 16 | Both scaled by render size / 1024 |
| radius | 0.35 | Native blur radius conversion described below |
| vibrantOpacity | 0.5 | Multiplies authored Layer Color opacity |
| neutralOpacity | 0.1 | Multiplies authored Neutral opacity |
| vibrantBlendMode / neutralBlendMode | plusDarker / plusDarker | Receiver blend for Normal compositions |

The foreground shadow draw at `0x1b308b0e8` selects black modulation for resolved Neutral
(style 3), and white modulation of the baked RGB shadow texture for vibrant. At
`0x1b308b1d0..0x1b308b20c`, the selected preset opacity multiplies the shadow resource's opacity
and authored shadow opacity before `drawShape:fill:alpha:blendMode:`. Refract previously used
the authored scalar directly: Neutral therefore had **ten times** the native draw strength,
and Layer Color twice the native strength. `shadowParameters.ts` now owns this conversion.
`none` disables shadow even if a legacy document retains `enabled: true`.

The blend conversion is a two-stage mapping, not a shared ordinal across frameworks:

```text
IconRendering Swift BlendMode tag 4
  -- table 0x1b30dbc40 / converter 0x1b308b498 --> RBBlendMode/CG plusDarker 26
  -- rb_blend_mode at 0x196988414, cg_table 0x196ace968 --> RB::BlendMode 44
```

RenderBox `alpha_effect_fragment` AIR's `composite_color` branch 44 computes, for premultiplied
source `S`, receiver `D`, and draw coverage/opacity `q`:

```text
A = clamp(S.a + D.a, 0, 1)
RGB = S.rgb + D.rgb + (A - S.a - D.a)
result = mix(D, (RGB, A), q)
```

This arithmetic is now shared by the WGSL and GLSL scene-output paths. It cannot generally be
encoded as a transparent source-over overlay: it may subtract RGB from an opaque receiver.
Normal groups whose effective draw items use Normal blending render into a full receiver scene.
Group opacity interpolates the entire before/after scene in premultiplied space once; the opaque
case uses Canvas copy directly. Shadow alpha remains the blurred coverage until the blend,
with authored/preset draw opacity applied afterwards, which also matters on transparent exports.
The same scene path is used with shadow disabled so toggling a shadow does not switch item
opacity/composition conventions. The final target remains RGBA8, with signed intermediate RGB
clamped by that target. Material/highlight placement and item-opacity handling remain Refract's
pass graph, not a claim of a complete reconstruction of Apple's group graph.

At `0x1b30a1728..0x1b30a1774`, the shadow bake uses `min(width,height)/1024` to scale its offsets
and blur. The default blur passed to `addBlurFilterWithRadius:` is `0.35 * 64` design points
(the 64 is at parameters offset `0x138`). The RenderBox conversion has now been recovered below:
the radius is Gaussian sigma, giving a default of **22.4** design points. Refract's default now
matches this value; an existing document's explicit preview radius is preserved. Bias, Automatic
selection, wide-gamut/HDR transfer and shadows with non-Normal group/item blending remain pending.
The latter retain the isolated overlay fallback with the corrected preset strength.

Compilation: TypeScript/Vite and all 14 WGSL passes compile. No automated tests or device visual
comparison were run for this follow-up; compile success does not establish visual parity.

### Follow-up: translucency direction and the RenderBox Gaussian kernel

The earlier Refract adapter fed the interactive specular light direction and bevel width into
`shapeAwareGradientMask`. This made the coating transparency rotate with the highlight and made
changing specular height change translucency, even when specular was disabled.

The same iOS 26.4 IconRendering library also contains `simplifiedShapeAwareGradientMask_v1`.
Its AIR reads a vertical position relative to a supplied rectangle, two opacity pairs, and a
separate border width. It does **not** take a light direction. For decoded inside-distance `d`:

```text
y = clamp((position.y - bounds.y) / bounds.height, 0, 1)
t = clamp(d / borderWidth, 0, 1)
interiorOpacity = mix(upperInterior, lowerInterior, y)
contourOpacity = mix(upperContour, lowerContour, y)
opacity = clamp(mix(contourOpacity, interiorOpacity, t), 0, 1)
smoothed = opacity² * (3 - 2 * opacity)
aa = clamp(fwidth(t), 0.0009765625, 2) * 0.8330078125
result = mix(1, smoothed, clamp(t / aa + 0.5, 0, 1))
```

`ICRRenderingParameters` initializes the border width to **25.8** at
`0x1b308fed0..0x1b308fedc` (field `0x568`). Fields `0x570/0x578` hold lower/upper interior
opacity **0/1**, loaded from `0x1b30dca50`; fields `0x580/0x588` hold lower/upper contour
opacity **0.61/0.2**, loaded from `0x1b30dcc30`. Their public getters at
`0x1b30c6834..0x1b30c68f4` identify the fields. These are recovered parameter defaults,
not values inferred from screenshots.

WGSL and GLSL now use this vertical mask and the separate border-width uniform (`u[47]`).
The local adapter maps already-transformed shape bounds to the rectangle and interpolates each
opacity from 1 according to authored translucency before smoothstep. It keeps a half-render-pixel
minimum border width. The complete native CPU routing between mask versions, per-appearance
overrides, and authored-strength conversion is not yet reconstructed; using this kernel does not
establish that every native rendition uses these exact defaults. The transparency mask itself
now depends only on geometry and translucency, independently of the interactive light/bevel.

RenderBox's `RBDrawingStateAddBlurFilter` at `0x196978368` casts the radius to float at
`0x1969783f8`, passing it unchanged to `GaussianBlur`'s constructor (`0x19698bd74`).
`GaussianBlur::render` squares it at `0x1969a7078..0x1969a7080` into variance. Thus radius
is **sigma**, not a support radius or a sigma multiplier.

`NarrowBlurKernel::construct` at `0x1969a4708` builds normalized Gaussian weights for integer
distances 0 through 15. It splits the center weight in half and combines adjacent pairs:

```text
w[i] = exp(-i² / (2 * variance)) / (1 + 2 * sum(exp(-j² / (2 * variance)), j=1..15))
pairWeight = float(w[2k] + w[2k+1])                 # w[0] is first halved
pairOffset = float(2k + w[2k+1] / pairWeight)
```

Both directions sample at `±pairOffset` with `pairWeight`. Weights below 0.002 are discarded;
pairs beyond 3 are discarded for variance <= 12.25, and beyond 5 for variance <= 27.5625.
The first weight receives the normalization residual so twice the retained weight sum stays one.
The usual narrow-pass sigma budget is **5.25**; other native quality flags select 3.5 or 7.
`blurKernel.ts` now computes these pairs once per blur invocation; both browser backends consume
the same packed float uniforms. Each pass needs at most 16 bilinear samples instead of 33 samples
and per-fragment exponentials. Background and shadow filtering both use this kernel.

Refract still reduces wide blurs before the separable passes. RenderBox instead has a quality-
and variance-dependent multipass planner; the complete planner/resampling graph remains pending.
Matching the recovered narrow kernel is not a claim of matching native wide-blur output.
TypeScript/Vite and all 14 WGSL passes compile. No automated tests or Apple-device visual
comparison were run for this follow-up.

### Follow-up: internal highlight width and the container contour

The previous glyph default was a fixed **3** design points. It also shared its width with
refraction. The container used a Canvas gradient stroke with a Gaussian blur, driven by screen
position rather than the contour's normal. These paths could not express the native profiles.

`ICRRenderingParameters.standardHighlights` at `0x1b30c5afc` returns the root's `0x170` field.
The standard initializer `0x1b308f4a8`, called from `0x1b308fe50`, defines these values. Table
entries are stored in **display / large / medium / small** order:

| Field | Native values |
| --- | --- |
| curvature | 0.8 / 0 / 0 / 0 |
| glyphsDefault static distance | 12 / 12 / 10 / 10 |
| glyphsDefault dynamic distance | 12 / 12 / 10 / 10 |
| glyphsDefault static opacity | 0.08 / 0.05 / 0.05 / 0.03 |
| glyphsDefault dynamic opacity | 0.3 / 0.18 / 0.2 / 0.2 |
| glyphsDefault inset | 6 / 0 / 2 / 3 |
| glyphsDefault minimum inset pixels | 1 / 0 / 0 / 0 |
| glyphsDefault angular spread | 108 degrees |
| container key / fill / rim distance | each 22 / 22 / 30 / 39 |
| container key opacity, light | 0.6 / 0.6 / 0.5 / 0.4 |
| container key opacity, dark | 0.4 / 0.4 / 0.3 / 0.2 |
| container fill opacity, light | 0.4 / 0.4 / 0.3 / 0.25 |
| container fill opacity, dark | 0.25 / 0.25 / 0.2 / 0.15 |
| container rim opacity, light | 0.08 / 0.08 / 0.06 / 0.04 |
| container rim opacity, dark | 0.05 / 0.05 / 0.04 / 0.03 |
| container key / fill / rim brightness | 1.1 / 1.1 / 1 |
| container key / fill / rim angular spread | 78 / 65 / 180 degrees |
| container key / fill / rim inset | each 0 |
| static direction / bias / intensity | (1, 0, 0) / 1 / 1 |
| dynamic bias | 0.5 |

The glyph default profile starts at relative offset `0x1c0`; a separate white-glyph profile starts
at `0x288`. The public glyph getters at `0x1b30c61e4..0x1b30c62fc` identify static/dynamic distance,
inset, minimum inset and angular spread. The size selector at `0x1b30cf088` compares thresholds
**25 / 60 / 128**; the first two come from `0x1b30dc9e0`, and the last is initialized at
`0x1b308fb84`. The enum descriptions identify small / medium / large / display order.

`highlightParameters.ts` now centralizes these defaults. Automatic glyph width selects 10–12
and scales it by render size / 1024. Explicit preview widths remain supported; the Inspector
shows Automatic/Custom and a design-point value rather than a percentage. These overrides are
preview-only: the `.icon` specular field remains the authored on/off switch. Refraction retains
its own local 3-point bevel. Translucency retains its separate 25.8-point contour transition.

`glassHighlightStrength` is shared by glyph and container passes in WGSL and GLSL. It decodes
distance into render pixels before the AIR's `fwidth` clamp, with width/inset in the same units.
Previously the clamp was applied directly to normalized distance, making its physical minimum
vary with texture resolution. Glyph shading now has independent static/dynamic contributions;
zero width produces no highlight, and zero inset continues to preserve thin strokes.

The GPU container path replaces the blurred Canvas stroke with `chiclet_highlight`, using the
same padded shape/SDF/normal cache as its glass body. It evaluates key/fill/rim lobes with the
container profiles, shades the complete receiver in premultiplied space and preserves its
antialiased alpha. Geometry preparation survives light changes. Canvas-only fallback retains
the approximate directional stroke.

The following conversions remain explicitly **preview policy**, not recovered native routing:

- Render pixels select the size class. Native display-scale/logical-size selection is pending.
- Distance defaults use the 1024-point design scale; complete native uniform packing is pending.
- Angular defaults use `cos(angle)` as the shader's dot threshold. The native CPU angle conversion
  has not been reconstructed, so its exact half-angle/sign convention is not established.
- The container applies all three lobes to static and interactive light, reverses the fill
  direction, and uses source-atop receiver interpolation. The native draw graph/blend conversion
  for these highlights has not been recovered.
- Glyph shading currently selects `glyphsDefault`. White-glyph selection and native thin-stroke
  inset adjustment remain pending; blindly applying the display inset would erase thin strokes.

Compilation: TypeScript/Vite and all **15** active WGSL passes compile. GLSL mirrors the same
kernel and pass layout, but WebGL driver compilation and Apple-device visual comparison have
not been performed. No automated tests were added or run for this follow-up.

### Follow-up: material Blur percentage conversion

The percentage editor and `.icon` codec use the authored scalar directly: **1 means 100%**.
The old rendering adapter converted it to `strength * 0.04 * renderSize` Gaussian sigma,
equivalent to only **40.96** design points at 100%. This retained a historical `/2.5` reduction
from the old shader's radius convention, even after the Gaussian kernel was corrected.

The iOS 26.4 standard initializer at `0x1b308fb64..0x1b308fb74` loads constants from
`0x1b30dc9c0/0x1b30dc9d0` into root fields `0x130..0x148`:

| Field | Value | Use |
| --- | --- | --- |
| `0x138` | 64 | Radius scale |
| `0x140` | 2 | `maxBlurStrength`, identified by getter `0x1b30c5918` |

The renderer stores these parameters at object offset `0x6a8`. Its material blur call at
`0x1b308c6ec..0x1b308c708` loads fields `0x7e0/0x7e8`, selects the lesser of the strength and
maximum, multiplies by the radius scale, and passes the result unchanged to
`addBlurFilterWithRadius:opaque:`. RenderBox interprets that radius as Gaussian sigma, as
documented above. There is no `/2.5` at this call.

`blurParameters.ts` now owns the conversion:

```text
sigmaPixels = clamp(authoredStrength, 0, 2) * 64 * renderSize / 1024
```

At a 1024-pixel render, 50% now gives sigma **32** rather than 20.48; 100% gives **64** rather
than 40.96. Thus the corrected sigma is **1.5625 times** the previous value within the old
editor range. Disabled blur and disabled group glass still skip material blur. Nonfinite
strengths are ignored; valid imported values above the native maximum are preserved by the
codec while effective rendering is capped. The Blur percentage editor permits 0–200% to expose
that render range; this is a Refract UI choice based on the native ceiling, not a recovered Icon
Composer Inspector limit. Other percentage controls retain their 0–100% bounds.

Both browser backends consume the same converted sigma and paired Gaussian weights. The wide-
blur downsampling planner, native material graph and color transfer still differ; recovering
the percentage scale does not establish pixel-identical visual output. TypeScript/Vite compile;
no automated tests or Apple-device visual comparison were performed for this follow-up.

### Follow-up: Games artwork alpha hiding material Blur

The extracted `Games.icon/Assets/6.wings.svg` contains two paths with linear-gradient paints.
Both gradients start with `stop-opacity:0.2` and end at the default opacity of 1. The default
third group uses Blur **0.3**, Combined lighting, and wings layer opacity approximately **0.7**.
These are authored paint alpha values, not fractional geometric coverage within the paths.

Previously SVG `glassAlphaShape` returned the original color raster. Consequently the coverage
texture and color texture carried the same paint alpha. `color_layer` divides color alpha by
coverage to remove antialiasing before the final material composite. This incorrectly removed
the wings' paint gradient too: at an interior alpha of 0.2, `0.2 / 0.2 = 1`. Material blur still
ran, but its result was covered by an opaque coating. In the Combined path the same problem
occurred after applying layer opacity: `(0.2 * 0.7) / (0.2 * 0.7) = 1` for an isolated wing region.

`svgCoverage.ts` now creates a render-only vector copy with opaque paints. Shape paths,
transforms, paint-server coordinates, fill rules, strokes and clipping retain their geometry.
The original raster continues to provide color and paint alpha. Both rasters use the same
aspect fit, supersampling and downsampling; both single-layer and Combined paths consume the
separate coverage raster. The interior ratio becomes `0.2 / 1 = 0.2`. The subsequent correction
below also separates Layer Opacity: with wings opacity 0.7, the coating ratio is now
`(0.2 * 0.7) / 1 = 0.14`. Group Opacity still fades the whole composition at the group boundary.
Generated coverage images are cached with the assets and never replace exported SVG data.

This conversion handles self-contained vector paints, including the Games wings' stop-opacity
gradients, presentation attributes, inline styles and CSS color declarations. SVG masks,
filters, patterns, embedded raster images and SVG animations retain the previous path because
their geometric coverage cannot be recovered by stripping paint opacity. CSS variables that
resolve to translucent colors, CSS animations and external resources are not reconstructed.
PNG coverage still uses the existing raster estimate. These cases remain separate limitations;
this correction does not establish pixel-identical Apple rendering.

TypeScript/Vite compile. No automated tests or Apple-device visual comparison were performed
for this follow-up; the Games example above is derived from its SVG and the compositing code.

### Follow-up: Group's translucent body still leaking sharp Group 2 pixels

Separating SVG paint alpha alone did not fix the default Games composition. The upper `Group`
uses an opaque white `2.body.big.svg` with **Layer Opacity 0.6**. `makeCombinedItem` still put
that opacity into both geometry and color. In the body interior, color_layer calculated
`0.6 / 0.6 = 1`, and composite then weighted the entire material by geometric coverage 0.6.
Ignoring shadows/highlights, the result was **0.6 white + 0.4 unblurred receiver**. The Blur pass
sampled the correct lower scene, but none of its result survived the opaque coating there.

Combined geometry now unions the active vector/raster coverage without Layer Opacity. Only
the coating canvas uses Layer Opacity. The same interior therefore becomes **0.6 white + 0.4
blurred receiver**, with geometry coverage 1. Individual lighting uses the same convention:
Layer Opacity is baked into coating alpha, and it no longer fades the completed refracted
surface back over an unblurred receiver. Non-glass layers still use normal draw opacity;
Group Opacity still fades the complete before/after composition once.

Effective hidden or zero-opacity layers are excluded after appearance/platform resolution.
They cannot add invisible glass silhouettes or split Combined runs. Positive-opacity flat
layers continue to split runs so their authored stack order and blend remain intact. Single-
layer cache keys include coating opacity so opacity edits invalidate alpha-dependent shadows.

These are corrections to Refract's material composition model, established from the Games
source and our own pass graph. Apple's exact opacity/highlight and Combined-group routing
remain unverified. TypeScript/Vite compile; no automated tests or device comparison were run.

### Follow-up: shared glyph/container highlight stair steps

The native `glassHighlight_v1` AIR samples encoded distance, computes
`d = (sdfZero - sample.r) * sdfScale - inset`, and sends that signed value to the lobe.
Its inner and outer boundaries use `clamp(fwidth(d), 2^-10, 2) * 0.8330078125` for coverage.
`SimulatedGlass::distance_gradient` offsets its four samples by `abs(dfdx(position.x))` and
`abs(dfdy(position.y))`, i.e. one output-pixel footprint in source coordinates, and normalizes
the nonzero gradient. It does not show a post-highlight Gaussian blur. This is evidence for
these two kernels, not for the complete distance-field generator or every native render path.

The CPU `sdfMethod` getter at `0x1b30c5894` reads parameters byte `0x128`. Exported enum cases
identify Core Animation and RenderBox implementations. The standard initializer at
`0x1b308fb5c..0x1b308fb60` writes 1 to this field; the exact method-tag mapping and distance-field
generation internals have not been reconstructed. Consequently our JFA is still an adapter.

Our old adapter discarded fractional geometric alpha and seeded integer texel centres at
occupied/empty transitions on **both** sides of the support boundary. This produced a displaced
staircase and a two-texel zero-distance band. Normals were conditioned, but highlight distance
still used that raw staircase. The DG pass then discarded outside distance by exporting only
the positive R channel. Both glyph highlights and the container rim share this preparation
path, so both inherited these issues.

The shared adapter now:

- Estimates a contour point from partial coverage and its local gradient, using the unit-square
  edge coverage model from [Stefan Gustavson's EDTAA3](https://github.com/rougier/freetype-gl/blob/master/edtaa3func.c).
  This is our implementation choice, not an algorithm identified in Apple's binary.
- Seeds binary edges separately, without adding displaced integer support seeds next to AA
  texels. Signed-distance classification uses the 50% coverage contour; the original geometric
  alpha remains unchanged for material and highlight coverage.
- Packs seeds as integer 16-pixel tiles plus fractional local coordinates. Direct pixel positions
  in RGBA16F lose fractional precision at large coordinates; splitting the position retains
  subpixel precision without increasing texture count or size. Flood/resolve decode the same
  packing and recognize absent seeds by a negative tile X.
- Exports signed distance in DG.R. Material depth functions clamp their own inside distance,
  while glyph and container highlighters keep the negative side needed by derivative AA.

WGSL and GLSL use the same representation and calculations. The existing one-pixel binomial
normal conditioning and medial-axis gradient attenuation remain local JFA adapters, rather than
recovered Apple behavior. The coverage model approximates a locally straight, box-filtered edge;
curvature, raster sampling, subpixel strokes and JFA nearest-point errors remain limitations.
For a symmetric tiny feature with no gradient, a centre seed preserves its original coverage.
The implementation does not enlarge the highlight profile or blur its output. EDTAA3 notices
are retained in `THIRD_PARTY_NOTICES` and included as a packaged resource.

TypeScript/Vite and all **15** active WGSL passes compile to SPIR-V with Naga. WebGL driver
compilation, device rendering and visual parity have not been verified; no automated tests were
added or run for this follow-up.


### Follow-up: glyph highlight placement and AppStore Combined blur

The previous zero-inset glyph policy is superseded. `glyphHighlightParameters`
now carries the recovered default inset **6 / 0 / 2 / 3** design points and
minimum inset **1 / 0 / 0 / 0** render pixels. The preview adapter uses
`max(minInsetPixels, inset * renderSize / 1024)` and passes it independently of
width to both static and dynamic lobes in WGSL and GLSL (material uniform 68).
Container lobes still use their separate zero-inset profile. Size-class selection,
white-glyph selection, and native thin-stroke adjustment are still pending; this
change does not establish identical placement on every native size or stroke.

AppStore's Group 2 and Group 3 resolve to one Combined glass surface each, both
using `hard-light`. Previously only Normal groups entered the complete-receiver
path. The fallback blended the material, which already included blurred/refracted
receiver pixels, with the sharp receiver again. This bypassed the intended blur
and made increasing Blur insufficient.

A group resolving to one Combined surface now takes the complete-scene path for
any supported blend. Its authored blend is applied between the coating and the
blurred/refracted surface in `composite`, before geometric coverage is applied
once. Receiver shadow remains a separate operation; specular is added afterwards.
Group opacity interpolates the completed scene once, including AppStore Group 3's
0.87 opacity. No icon-name conditions, extra blur passes, textures, or readbacks
are introduced. Flat cover PNGs in AppStore's top Group retain their authored
paint, stacking, and blends; they are intentionally not glass.

`blendParameters.ts` defines Refract-specific coating blend codes (uniform 69), shared by the
WGSL and GLSL implementations. Separable blending and partial-backdrop-alpha
handling follow [W3C Compositing Level 1](https://www.w3.org/TR/compositing-1/#blending).
The plusDarker arithmetic uses the recovered RenderBox alpha-excess subtraction;
these codes are not native enum values. This coating/backdrop stage separation is
our material-graph correction, not a claim that the entire native non-Normal draw
graph has been reconstructed. Groups with multiple draw items (Individual or
interleaved flat/glass runs) retain their existing isolation fallback and are not
covered by this Combined correction.

TypeScript/Vite and all 15 active WGSL passes compile. No automated tests were
added or run. WebGL driver compilation and comparison of the final AppStore and
thin-stroke glyph images with Apple's renderer remain unverified.


### Follow-up: accidental red/blue shadow uniform alias

The initial glyph-inset/Combined-blend change incorrectly reused uniforms 28 and
30, while `shadow_source` still read the entire `shadowCol.xyz` as RGB. Consequently
inset pixels became the Neutral shadow's red component, and a non-Normal coating
blend code became its blue component. This was a Refract packing regression.

The material block now has 18 vec4s (72 floats). `shadowCol.xyz` is restored to
Neutral black; vibrant shadows still take transformed artwork RGB. The appended
`materialExtra` carries glyph inset at 68 and coating blend at 69, independently
of shadow color and its cache key. WGSL, GLSL, glyph uniforms, container-body
uniforms and container-highlight uniforms use the same extended buffer size.
`uniformLayout.ts` centralizes the float/vector count and extra-field indices.
Blur's pass-specific tap packing remains unchanged.
