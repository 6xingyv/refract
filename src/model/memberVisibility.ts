import { resolveGroup, resolveLayer, type Group, type Layer } from "./types";

/** Visibility and opacity have separate overrides; neither implies the other. */
export function visibilityPropertySlot(
  member: Group | Layer, property: "isHidden" | "opacity", slot: string | null, platform?: string,
): string | null {
  if (platform && member.specs[platform]?.[property] != null) return platform;
  return slot && member.specs[slot]?.[property] != null ? slot : null;
}

export interface MemberVisibility {
  hidden: boolean;
  opacity: number;
  visible: boolean;
  badge?: "Hidden" | "0%" | "Parent";
  description: string;
}

/** Shared UI projection of the compositor's hidden/opacity checks, including the parent group. */
export function resolveMemberVisibility(
  member: Group | Layer, slot: string | null, platform: string, parent?: Group,
): MemberVisibility {
  const effective = member.kind === "group" ? resolveGroup(member, slot, platform) : resolveLayer(member, slot, platform);
  const state = { hidden: effective.isHidden, opacity: effective.opacity };
  const source = (property: "isHidden" | "opacity") =>
    visibilityPropertySlot(member, property, slot, platform) ?? "base";
  if (parent) {
    const parentState = resolveMemberVisibility(parent, slot, platform);
    if (!parentState.visible) return {
      ...state, visible: false, badge: "Parent", description: `${parent.name}: ${parentState.description}`,
    };
  }
  if (state.hidden) return { ...state, visible: false, badge: "Hidden", description: `Hidden (${source("isHidden")})` };
  if (state.opacity <= 0) return { ...state, visible: false, badge: "0%", description: `Opacity 0% (${source("opacity")})` };
  return { ...state, visible: true, description: `Visible · opacity ${Math.round(state.opacity * 100)}% (${source("opacity")})` };
}
