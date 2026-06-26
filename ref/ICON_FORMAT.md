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
entries verbatim unless the editor intentionally rewrites that property.

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
- **Preview renditions** (7): Default(Light), Dark, Mono, Tinted Light, Tinted Dark, Clear Light,
  Clear Dark. Mono's source appearance = `dark`.

Note: the real Shadow control is **kind + opacity** (no colour well, no radius — the blur radius is
chosen by the renderer from the kind). Specular at the group level is a plain on/off.

---

## 10. Coverage of our reimplementation

**Read + written:** all base properties (§2–§6), root `fill-specializations`, official-generator
axisless default specialization entries, **appearance** specializations (`light` / `dark` /
`tinted`), and editable platform/idiom specializations (`iOS` / `macOS` / `watchOS`). Layer
`image-name-specializations`, `fill-specializations`, and asset mirroring specializations are also
modeled and round-trip.

**Preserved verbatim** (via the original JSON kept per object) but not edited: `features`,
`material`, layer `kind`, `color-space-for-untagged-svg-colors`, etc.

**Not yet edited:** specialization axes outside the current UI model, such as `localization`,
`languageDirection`, and `base`-appearance entries. Unknown non-modeled keys are preserved verbatim,
but modeled specialization arrays may be rewritten when their property is edited.
