// Pure document operations (doc -> doc), ported from DocumentOps.kt.
import {
  IconDocument, Group, Layer, Fill, newGroup, newLayer, defaultFill, rgba,
  newId,
} from "./types";

const baseName = (file: string) => file.replace(/\.[^.]+$/, "");

export const ICON_ID = -1;

export function sampleDocument(): IconDocument {
  const base = newLayer("Background", {
    isGlass: false,
    fill: { kind: "linearGradient", primaryColor: rgba(0.2, 0.48, 1), secondaryColor: rgba(0.1, 0.26, 0.85), orientationDeg: 90 },
  });
  const glyph = newLayer("Glyph", { isGlass: true, fill: { kind: "solid", primaryColor: rgba(0.95, 0.97, 1), secondaryColor: rgba(0.18, 0.42, 0.95), orientationDeg: 90 } });
  const group = newGroup("Icon", { layers: [base, glyph] });
  return {
    name: "Untitled",
    composition: { groups: [group], fill: { kind: "automatic", primaryColor: rgba(0.36, 0.66, 1), secondaryColor: rgba(0.18, 0.42, 0.95), orientationDeg: 90 } },
    supportedPlatforms: ["iOS", "macOS", "watchOS"], squaresShared: true,
    previewPlatform: "iOS", previewRendition: "Default",
    background: rgba(0.92, 0.92, 0.94, 1), tintColor: rgba(0.2, 0.5, 1), tintStrength: 0, lightAngleDeg: 45,
  };
}

const withGroups = (doc: IconDocument, groups: Group[]): IconDocument =>
  ({ ...doc, composition: { ...doc.composition, groups } });

export function addLayer(doc: IconDocument): IconDocument {
  const groups = [...doc.composition.groups];
  if (groups.length === 0) groups.push(newGroup("Icon"));
  const g = groups[0];
  groups[0] = { ...g, layers: [...g.layers, newLayer(`Layer ${g.layers.length + 1}`)] };
  return withGroups(doc, groups);
}

export function addGroup(doc: IconDocument): IconDocument {
  return withGroups(doc, [...doc.composition.groups, newGroup(`Group ${doc.composition.groups.length + 1}`)]);
}

/** Add imported SVG/PNG assets as new glass layers on top of the first group (drag-drop import). */
export function addImageLayers(doc: IconDocument, fileNames: string[]): IconDocument {
  if (fileNames.length === 0) return doc;
  const groups = [...doc.composition.groups];
  if (groups.length === 0) groups.push(newGroup("Icon"));
  const layers = fileNames.map((n) => newLayer(baseName(n), { imageName: n, isGlass: true, fill: { ...defaultFill(), kind: "none" } }));
  groups[0] = { ...groups[0], layers: [...layers, ...groups[0].layers] };
  return withGroups(doc, groups);
}

export function deleteMember(doc: IconDocument, id: number): IconDocument {
  const groups = doc.composition.groups
    .filter((g) => g.id !== id)
    .map((g) => ({ ...g, layers: g.layers.filter((l) => l.id !== id) }));
  return withGroups(doc, groups);
}

export function selectionAfterDelete(doc: IconDocument, id: number): number {
  const gi = doc.composition.groups.findIndex((g) => g.id === id);
  if (gi >= 0) return doc.composition.groups[gi + 1]?.id ?? doc.composition.groups[gi - 1]?.id ?? ICON_ID;
  for (const g of doc.composition.groups) {
    const li = g.layers.findIndex((l) => l.id === id);
    if (li >= 0) return g.layers[li + 1]?.id ?? g.layers[li - 1]?.id ?? g.id;
  }
  return ICON_ID;
}

export type CopiedMember =
  | { kind: "group"; group: Group }
  | { kind: "layer"; layer: Layer };

const clonePlain = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const copyName = (name: string) => `${name} Copy`;

export function copyMember(doc: IconDocument, id: number): CopiedMember | null {
  const g = findGroup(doc, id);
  if (g) return { kind: "group", group: clonePlain(g) };
  const l = findLayer(doc, id);
  if (l) return { kind: "layer", layer: clonePlain(l) };
  return null;
}

function cloneLayerForPaste(layer: Layer, rename = true): Layer {
  return { ...clonePlain(layer), id: newId(), name: rename ? copyName(layer.name) : layer.name };
}

function cloneGroupForPaste(group: Group): Group {
  const cloned = clonePlain(group);
  return {
    ...cloned,
    id: newId(),
    name: copyName(group.name),
    layers: group.layers.map((l) => cloneLayerForPaste(l, false)),
  };
}

function owningGroupIndex(doc: IconDocument, id: number): number {
  const gi = doc.composition.groups.findIndex((g) => g.id === id);
  if (gi >= 0) return gi;
  return doc.composition.groups.findIndex((g) => g.layers.some((l) => l.id === id));
}

export function pasteMember(doc: IconDocument, member: CopiedMember, selectedId: number): { doc: IconDocument; selectedId: number } {
  const groups = doc.composition.groups.map((g) => ({ ...g, layers: [...g.layers] }));
  if (member.kind === "group") {
    const group = cloneGroupForPaste(member.group);
    const owner = owningGroupIndex(doc, selectedId);
    groups.splice(owner >= 0 ? owner + 1 : groups.length, 0, group);
    return { doc: withGroups(doc, groups), selectedId: group.id };
  }

  if (groups.length === 0) groups.push(newGroup("Icon"));
  const layer = cloneLayerForPaste(member.layer);
  let gi = owningGroupIndex(doc, selectedId);
  if (gi < 0) gi = 0;
  const selectedLayerIndex = groups[gi].layers.findIndex((l) => l.id === selectedId);
  const insertAt = selectedLayerIndex >= 0 ? selectedLayerIndex : 0;
  groups[gi] = { ...groups[gi], layers: [...groups[gi].layers] };
  groups[gi].layers.splice(insertAt, 0, layer);
  return { doc: withGroups(doc, groups), selectedId: layer.id };
}

export function toggleHidden(doc: IconDocument, id: number): IconDocument {
  const groups = doc.composition.groups.map((g) => {
    if (g.id === id) return { ...g, isHidden: !g.isHidden };
    if (g.layers.some((l) => l.id === id))
      return { ...g, layers: g.layers.map((l) => (l.id === id ? { ...l, isHidden: !l.isHidden } : l)) };
    return g;
  });
  return withGroups(doc, groups);
}

export function renameMember(doc: IconDocument, id: number, name: string): IconDocument {
  const trimmed = name.trim();
  if (!trimmed) return doc;
  if (id === ICON_ID) return { ...doc, name: trimmed };
  const groups = doc.composition.groups.map((g) =>
    g.id === id ? { ...g, name: trimmed } : { ...g, layers: g.layers.map((l) => (l.id === id ? { ...l, name: trimmed } : l)) });
  return withGroups(doc, groups);
}

export const replaceGroup = (doc: IconDocument, ng: Group): IconDocument =>
  withGroups(doc, doc.composition.groups.map((g) => (g.id === ng.id ? ng : g)));

export const replaceLayer = (doc: IconDocument, nl: Layer): IconDocument =>
  withGroups(doc, doc.composition.groups.map((g) => ({ ...g, layers: g.layers.map((l) => (l.id === nl.id ? nl : l)) })));

export const setCompositionFill = (doc: IconDocument, fill: Fill): IconDocument =>
  ({ ...doc, composition: { ...doc.composition, fill } });

/** Move a member (group or layer) to a new index within its level (drag-reorder). */
export function moveGroup(doc: IconDocument, from: number, to: number): IconDocument {
  const groups = [...doc.composition.groups];
  if (from < 0 || from >= groups.length) return doc;
  const [m] = groups.splice(from, 1);
  groups.splice(Math.max(0, Math.min(groups.length, to)), 0, m);
  return withGroups(doc, groups);
}

/**
 * Drag-reorder: drop `dragId` before/after `targetId`. Groups reorder among groups;
 * layers reorder within or across groups (dropping on a group header inserts at its top).
 */
export function moveMember(doc: IconDocument, dragId: number, targetId: number, before: boolean): IconDocument {
  if (dragId === targetId) return doc;
  const groups = doc.composition.groups;

  // dragging a group -> reorder among groups, relative to the target's owning group
  const dragGi = groups.findIndex((g) => g.id === dragId);
  if (dragGi >= 0) {
    const owner = groups.find((g) => g.id === targetId || g.layers.some((l) => l.id === targetId));
    if (!owner || owner.id === dragId) return doc;
    const arr = groups.filter((g) => g.id !== dragId);
    let ti = arr.findIndex((g) => g.id === owner.id);
    if (ti < 0) ti = arr.length;
    arr.splice(before ? ti : ti + 1, 0, groups[dragGi]);
    return withGroups(doc, arr);
  }

  // dragging a layer -> remove from source, insert relative to target
  let srcGi = -1, srcLi = -1;
  groups.forEach((g, gi) => { const li = g.layers.findIndex((l) => l.id === dragId); if (li >= 0) { srcGi = gi; srcLi = li; } });
  if (srcGi < 0) return doc;
  const layer = groups[srcGi].layers[srcLi];

  let dstGi = groups.findIndex((g) => g.id === targetId), targetIsHeader = dstGi >= 0;
  if (dstGi < 0) groups.forEach((g, gi) => { if (g.layers.some((l) => l.id === targetId)) dstGi = gi; });
  if (dstGi < 0) return doc;

  const next = groups.map((g) => ({ ...g, layers: [...g.layers] }));
  next[srcGi].layers.splice(srcLi, 1);
  const dst = next[dstGi];
  let at = 0;
  if (!targetIsHeader) {
    let idx = dst.layers.findIndex((l) => l.id === targetId);
    if (idx < 0) idx = dst.layers.length;
    at = before ? idx : idx + 1;
  }
  dst.layers.splice(at, 0, layer);
  return withGroups(doc, next);
}

export function findGroup(doc: IconDocument, id: number): Group | undefined {
  return doc.composition.groups.find((g) => g.id === id);
}
export function findLayer(doc: IconDocument, id: number): Layer | undefined {
  for (const g of doc.composition.groups) { const l = g.layers.find((x) => x.id === id); if (l) return l; }
  return undefined;
}
