/**
 * Separate vector coverage from paint opacity before generating the glass SDF.
 * Games.icon's wings, for example, have fully covered paths painted with a
 * 0.2–1 alpha gradient. Using that painted alpha as coverage cancels the gradient
 * when color_layer divides out antialiasing coverage.
 *
 * Masks, filters, patterns and embedded rasters need their own coverage model;
 * leave those assets on the existing path rather than changing their silhouettes.
 * This copy is render-only. Export always retains the original SVG.
 */
export function svgCoverageSource(source: string): string | null {
  const doc = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = doc.documentElement;
  if (root.localName !== "svg" || root.namespaceURI !== "http://www.w3.org/2000/svg" || doc.querySelector("parsererror")) return null;
  if (doc.querySelector("mask, filter, pattern, image, foreignObject, animate, animateTransform, animateMotion, set, [mask], [filter]")) return null;

  for (const element of [root, ...root.querySelectorAll<SVGElement>("*")]) {
    // Presentation attributes and inline styles both participate in the cascade.
    // Keep none, paint-server URLs, fill rules, stroke widths and transforms.
    for (const property of PAINT_COLORS) {
      const value = element.getAttribute(property);
      if (value && isSolidColor(value)) element.setAttribute(property, "white");
    }
    if (element instanceof SVGElement) {
      opaquePaint(element.style);
      for (const property of PAINT_OPACITIES) element.style.setProperty(property, "1", "important");
    }
    if (element.localName === "style" && element.textContent) {
      // Parse CSS rather than replacing text: selectors, nested rules, URLs and
      // quoted values must survive unchanged. Imported sheets are not self-contained.
      if (/@import\b/i.test(element.textContent)) return null;
      if (typeof CSSStyleSheet === "undefined" || !CSSStyleSheet.prototype.replaceSync) return null;
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(element.textContent);
      opaqueRules(sheet.cssRules);
      element.textContent = [...sheet.cssRules].map((rule) => rule.cssText).join("\n");
    }
  }
  return new XMLSerializer().serializeToString(root);
}

const PAINT_COLORS = ["fill", "stroke", "stop-color", "color"];
const PAINT_OPACITIES = ["opacity", "fill-opacity", "stroke-opacity", "stop-opacity"];

function isSolidColor(value: string): boolean {
  // CSS variables may resolve to none or a paint server; retain their semantics.
  return !/^(?:var\(|currentcolor$|inherit$|initial$|unset$|revert(?:-layer)?$)/i.test(value.trim())
    && CSS.supports("color", value);
}

function opaquePaint(style: CSSStyleDeclaration) {
  for (const property of PAINT_COLORS) {
    if (isSolidColor(style.getPropertyValue(property))) {
      style.setProperty(property, "white", style.getPropertyPriority(property));
    }
  }
}

function opaqueRules(rules: CSSRuleList) {
  for (const rule of rules) {
    if (rule instanceof CSSStyleRule) opaquePaint(rule.style);
    if ("cssRules" in rule) opaqueRules((rule as CSSGroupingRule).cssRules);
  }
}
