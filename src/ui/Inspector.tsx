import { useStore, ICON_ID } from "../state/store";
import { replaceGroup, replaceLayer, setCompositionFillSpec, findGroup, findLayer } from "../model/document";
import {
  Group, Layer, GroupSpec, LayerSpec, Lighting, ShadowKind, FillKind, Fill, BlendMode, IconDocument, Platform,
  Appearance, APPEARANCES, slotOf, blendDisplay, resolveGroup, resolveLayer, resolveCompositionFill, PLATFORMS, allLayers,
} from "../model/types";
import { Section, Row, Toggle, Pct, ValueChip, Select, Variation, ColorWell } from "./widgets";
import type { ChromePlatform } from "./WindowChrome";

const BLENDS: BlendMode[] = ["normal", "plus-lighter", "plus-darker", "multiply", "screen", "overlay", "soft-light", "hard-light", "darken", "lighten"];
const fromBlendLabel = (s: string) => BLENDS.find((b) => blendDisplay(b) === s) ?? "normal";

type Upd = (fn: (d: IconDocument) => IconDocument) => void;

export function Inspector({ chromePlatform }: { chromePlatform: ChromePlatform }) {
  const doc = useStore((s) => s.doc);
  const id = useStore((s) => s.selectedId);
  const update = useStore((s) => s.update) as Upd;
  const appearance = useStore((s) => s.appearance);
  const setAppearance = useStore((s) => s.setAppearance);
  const slot = slotOf(appearance);

  const appearanceVar = (
    <Variation value={appearance} options={APPEARANCES} onChange={(v) => setAppearance(v as Appearance)} />
  );
  const platformOptions = doc.supportedPlatforms.includes(doc.previewPlatform)
    ? doc.supportedPlatforms
    : [doc.previewPlatform, ...doc.supportedPlatforms];
  const platformVar = (
    <Variation
      value={doc.previewPlatform}
      options={platformOptions}
      onChange={(v) => update((d) => ({ ...d, previewPlatform: v as Platform }))}
    />
  );

  const group = findGroup(doc, id);
  const layer = findLayer(doc, id);
  const hasTopDrag = chromePlatform !== "mac";
  const assetOptions = Array.from(new Set(allLayers(doc).map((l) => l.imageName).filter(Boolean) as string[]));

  return (
    <div className="relative z-10 w-[300px] shrink-0 border-l border-[color:var(--line)] flex flex-col panel-surface">
      {hasTopDrag && <div className="h-11 shrink-0 pr-[138px]" data-tauri-drag-region />}
      <div className="flex-1 overflow-y-auto">
        {id === ICON_ID && <IconInspector doc={doc} update={update} appearanceVar={appearanceVar} appearance={appearance} />}
        {group && <GroupInspector g={group} slot={slot} platform={doc.previewPlatform} update={update} appearanceVar={appearanceVar} compositionVar={platformVar} />}
        {layer && <LayerInspector l={layer} slot={slot} platform={doc.previewPlatform} update={update} appearanceVar={appearanceVar} compositionVar={platformVar} assetOptions={assetOptions} />}
        {id !== ICON_ID && !group && !layer && <div className="p-4 text-[12px] text-[color:var(--tx-3)]">Select a member</div>}
      </div>
    </div>
  );
}

function IconInspector({ doc, update, appearanceVar, appearance }: { doc: IconDocument; update: Upd; appearanceVar: React.ReactNode; appearance: Appearance }) {
  const slot = slotOf(appearance);
  const f = resolveCompositionFill(doc.composition, slot);
  const setFill = (fill: Fill) => update((d) => setCompositionFillSpec(d, slot, fill));
  return (
    <>
      <Section title="Color" variation={appearanceVar}>
        <FillEditor fill={f} onChange={setFill} />
      </Section>
      {appearance === "Mono" && (
        <Section title="Tint">
          <Row label="Tint background"><Toggle on={doc.tintStrength > 0} onChange={(v) => update((d) => ({ ...d, tintStrength: v ? 1 : 0 }))} /></Row>
          {doc.tintStrength > 0 && <Row label="Color"><ColorWell color={doc.tintColor} onChange={(c) => update((d) => ({ ...d, tintColor: c }))} /></Row>}
        </Section>
      )}
      <Section title="Platforms">
        <PlatformsEditor doc={doc} update={update} />
      </Section>
    </>
  );
}

const FILL_OPTIONS = ["Automatic", "Solid", "Gradient", "Auto Gradient", "None"];
const fillLabel = (f: Fill) =>
  f.kind === "solid" ? "Solid" : f.kind === "linearGradient" ? "Gradient" : f.kind === "automaticGradient" ? "Auto Gradient" : f.kind === "none" ? "None" : "Automatic";
const fillKind = (label: string): FillKind =>
  label === "Solid" ? "solid" : label === "Gradient" ? "linearGradient" : label === "Auto Gradient" ? "automaticGradient" : label === "None" ? "none" : "automatic";

function FillEditor({ fill, onChange }: { fill: Fill; onChange: (fill: Fill) => void }) {
  return (
    <>
      <Row label="Fill"><Select value={fillLabel(fill)} options={FILL_OPTIONS} onChange={(label) => onChange({ ...fill, kind: fillKind(label) })} /></Row>
      {fill.kind === "solid" && <Row label="Color"><ColorWell color={fill.primaryColor} onChange={(c) => onChange({ ...fill, primaryColor: c })} /></Row>}
      {fill.kind === "automaticGradient" && <Row label="Color"><ColorWell color={fill.primaryColor} onChange={(c) => onChange({ ...fill, primaryColor: c })} /></Row>}
      {fill.kind === "linearGradient" && (<>
        <Row label="Primary"><ColorWell color={fill.primaryColor} onChange={(c) => onChange({ ...fill, primaryColor: c })} /></Row>
        <Row label="Secondary"><ColorWell color={fill.secondaryColor} onChange={(c) => onChange({ ...fill, secondaryColor: c })} /></Row>
        <Row label="Angle"><ValueChip value={Math.round(fill.orientationDeg)} unit="deg" onChange={(n) => onChange({ ...fill, orientationDeg: n })} /></Row>
      </>)}
    </>
  );
}

const PLAT_LIST: Platform[] = ["iOS", "macOS", "watchOS"];
function PlatformsEditor({ doc, update }: { doc: IconDocument; update: Upd }) {
  const toggle = (p: Platform) => update((d) => {
    const on = d.supportedPlatforms.includes(p);
    let ps = on ? d.supportedPlatforms.filter((x) => x !== p) : [...d.supportedPlatforms, p];
    if (ps.length === 0) ps = [p];
    return { ...d, supportedPlatforms: ps };
  });
  return (
    <>
      <Row label="iOS, macOS">
        <Select value={doc.squaresShared ? "Shared" : "Unique"} options={["Shared", "Unique"]}
          onChange={(v) => update((d) => ({ ...d, squaresShared: v === "Shared" }))} />
      </Row>
      <Row label="RTL Mirror">
        <Toggle
          on={!!doc.composition.implicitAssetMirroring}
          onChange={(v) => update((d) => ({ ...d, composition: { ...d.composition, implicitAssetMirroring: v } }))}
        />
      </Row>
      {PLAT_LIST.map((p) => (
        <Row key={p} label={PLATFORMS[p].displayName}>
          <Toggle on={doc.supportedPlatforms.includes(p)} onChange={() => toggle(p)} />
        </Row>
      ))}
    </>
  );
}

function GroupInspector({ g, slot, platform, update, appearanceVar, compositionVar }: { g: Group; slot: string | null; platform: Platform; update: Upd; appearanceVar: React.ReactNode; compositionVar: React.ReactNode }) {
  const eg = resolveGroup(g, slot);
  const cg = resolveGroup(g, null, platform);
  const apply = (spec: (s: GroupSpec) => GroupSpec, base: (g: Group) => Group) =>
    update((d) => replaceGroup(d, slot == null ? base(g) : { ...g, specs: { ...g.specs, [slot]: spec(g.specs[slot] ?? {}) } }));
  const applyPlatform = (spec: (s: GroupSpec) => GroupSpec) =>
    update((d) => replaceGroup(d, { ...g, specs: { ...g.specs, [platform]: spec(g.specs[platform] ?? {}) } }));

  return (
    <>
      <Section title="Color" variation={appearanceVar}>
        <Row label="Opacity"><Pct value={eg.opacity} onChange={(v) => apply((s) => ({ ...s, opacity: v }), (x) => ({ ...x, opacity: v }))} /></Row>
        <Row label="Blend Mode"><Select value={blendDisplay(eg.blendMode)} options={BLENDS.map(blendDisplay)} onChange={(n) => { const b = fromBlendLabel(n); apply((s) => ({ ...s, blendMode: b }), (x) => ({ ...x, blendMode: b })); }} /></Row>
      </Section>

      <Section title="Liquid Glass" variation={appearanceVar}>
        <Row label="Mode"><Select value={eg.lighting === "individual" ? "Individual" : "Combined"} options={["Individual", "Combined"]} onChange={(n) => { const lg: Lighting = n === "Individual" ? "individual" : "combined"; apply((s) => ({ ...s, lighting: lg }), (x) => ({ ...x, lighting: lg })); }} /></Row>
        <Row label="Specular"><Toggle on={eg.specular.enabled} onChange={(v) => apply((s) => ({ ...s, specularEnabled: v }), (x) => ({ ...x, specular: { ...x.specular, enabled: v } }))} /></Row>
        <Row label="Blur">
          {eg.blurMaterial.enabled && <Pct value={eg.blurMaterial.strength} onChange={(v) => { const nb = { ...eg.blurMaterial, strength: v }; apply((s) => ({ ...s, blurMaterial: nb }), (x) => ({ ...x, blurMaterial: nb })); }} />}
          <Toggle on={eg.blurMaterial.enabled} onChange={(v) => { const nb = { ...eg.blurMaterial, enabled: v }; apply((s) => ({ ...s, blurMaterial: nb }), (x) => ({ ...x, blurMaterial: nb })); }} />
        </Row>
        <Row label="Translucency">
          {eg.translucency.enabled && <Pct value={eg.translucency.value} onChange={(v) => { const nt = { ...eg.translucency, value: v }; apply((s) => ({ ...s, translucency: nt }), (x) => ({ ...x, translucency: nt })); }} />}
          <Toggle on={eg.translucency.enabled} onChange={(v) => { const nt = { ...eg.translucency, enabled: v }; apply((s) => ({ ...s, translucency: nt }), (x) => ({ ...x, translucency: nt })); }} />
        </Row>
        <Row label="Shadow">
          {eg.shadow.enabled && <Select value={shadowLabel(eg.shadow.kind)} options={["Automatic", "Neutral", "Layer Color"]} onChange={(n) => { const ns = { ...eg.shadow, kind: shadowKind(n) }; apply((s) => ({ ...s, shadow: ns }), (x) => ({ ...x, shadow: ns })); }} />}
          {eg.shadow.enabled && <Pct value={eg.shadow.opacity} onChange={(v) => { const ns = { ...eg.shadow, opacity: v }; apply((s) => ({ ...s, shadow: ns }), (x) => ({ ...x, shadow: ns })); }} />}
          <Toggle on={eg.shadow.enabled} onChange={(v) => { const ns = { ...eg.shadow, enabled: v }; apply((s) => ({ ...s, shadow: ns }), (x) => ({ ...x, shadow: ns })); }} />
        </Row>
        {eg.specular.enabled && <Row label="Highlight"><Pct value={Math.min(1, g.specular.height / 60)} onChange={(v) => update((d) => replaceGroup(d, { ...g, specular: { ...g.specular, height: Math.max(1, Math.min(60, v * 60)) } }))} /></Row>}
      </Section>

      <Section title="Composition" variation={compositionVar}>
        <Row label="Visible"><Toggle on={!cg.isHidden} onChange={(v) => applyPlatform((s) => ({ ...s, isHidden: !v }))} /></Row>
        <Row label="RTL Mirror"><Toggle on={!!cg.mirrorInRTL} onChange={(v) => applyPlatform((s) => ({ ...s, mirrorInRTL: v }))} /></Row>
        <Layout pos={cg.position} scale={cg.scale} onPos={(p) => applyPlatform((s) => ({ ...s, position: p }))} onScale={(sc) => applyPlatform((s) => ({ ...s, scale: sc }))} />
      </Section>
    </>
  );
}

function LayerInspector({ l, slot, platform, update, appearanceVar, compositionVar, assetOptions }: { l: Layer; slot: string | null; platform: Platform; update: Upd; appearanceVar: React.ReactNode; compositionVar: React.ReactNode; assetOptions: string[] }) {
  const el = resolveLayer(l, slot);
  const cl = resolveLayer(l, null, platform);
  const apply = (spec: (s: LayerSpec) => LayerSpec, base: (l: Layer) => Layer) =>
    update((d) => replaceLayer(d, slot == null ? base(l) : { ...l, specs: { ...l.specs, [slot]: spec(l.specs[slot] ?? {}) } }));
  const applyPlatform = (spec: (s: LayerSpec) => LayerSpec) =>
    update((d) => replaceLayer(d, { ...l, specs: { ...l.specs, [platform]: spec(l.specs[platform] ?? {}) } }));
  const imageValue = el.imageName ?? "None";
  const imageOptions = ["None", ...assetOptions];
  if (imageValue !== "None" && !imageOptions.includes(imageValue)) imageOptions.splice(1, 0, imageValue);
  return (
    <>
      <Section title="Color" variation={appearanceVar}>
        <Row label="Image"><Select value={imageValue} options={imageOptions} onChange={(n) => { const imageName = n === "None" ? null : n; apply((s) => ({ ...s, imageName }), (x) => ({ ...x, imageName })); }} /></Row>
        <FillEditor fill={el.fill} onChange={(fill) => apply((s) => ({ ...s, fill }), (x) => ({ ...x, fill }))} />
        <Row label="Opacity"><Pct value={el.opacity} onChange={(v) => apply((s) => ({ ...s, opacity: v }), (x) => ({ ...x, opacity: v }))} /></Row>
        <Row label="Blend Mode"><Select value={blendDisplay(el.blendMode)} options={BLENDS.map(blendDisplay)} onChange={(n) => { const b = fromBlendLabel(n); apply((s) => ({ ...s, blendMode: b }), (x) => ({ ...x, blendMode: b })); }} /></Row>
      </Section>
      <Section title="Liquid Glass" variation={appearanceVar}>
        <Row label="Glass"><Toggle on={el.isGlass} onChange={(v) => apply((s) => ({ ...s, isGlass: v }), (x) => ({ ...x, isGlass: v }))} /></Row>
      </Section>
      <Section title="Composition" variation={compositionVar}>
        <Row label="Visible"><Toggle on={!cl.isHidden} onChange={(v) => applyPlatform((s) => ({ ...s, isHidden: !v }))} /></Row>
        <Row label="RTL Mirror"><Toggle on={!!cl.mirrorInRTL} onChange={(v) => applyPlatform((s) => ({ ...s, mirrorInRTL: v }))} /></Row>
        <Layout pos={cl.position} scale={cl.scale} onPos={(p) => applyPlatform((s) => ({ ...s, position: p }))} onScale={(sc) => applyPlatform((s) => ({ ...s, scale: sc }))} />
      </Section>
    </>
  );
}

function Layout({ pos, scale, onPos, onScale }: { pos: { x: number; y: number }; scale: number; onPos: (p: { x: number; y: number }) => void; onScale: (s: number) => void }) {
  return (
    <div className="flex flex-col gap-1.5 py-1">
      <Row label="Layout">
        <ValueChip value={Math.round(pos.x)} unit="pt" onChange={(n) => onPos({ ...pos, x: n })} />
        <ValueChip value={Math.round(pos.y)} unit="pt" onChange={(n) => onPos({ ...pos, y: n })} />
      </Row>
      <div className="flex justify-end">
        <ValueChip value={Math.round(scale * 100)} unit="%" onChange={(n) => onScale(Math.max(0, n) / 100)} />
      </div>
    </div>
  );
}

const shadowLabel = (k: ShadowKind) => (k === "automatic" ? "Automatic" : k === "layerColor" ? "Layer Color" : "Neutral");
const shadowKind = (s: string): ShadowKind => (s === "Automatic" ? "automatic" : s === "Layer Color" ? "layerColor" : "neutral");
