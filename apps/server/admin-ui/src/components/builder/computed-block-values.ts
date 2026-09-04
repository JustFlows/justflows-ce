export interface ComputedBlockValues {
  background: string;
  textColor: string;
  accent: string;
  opacity: string;
  minHeight: string;
  maxWidth: string;
  maxHeight: string;
  textAlign: string;
  radius: string;
  shadow: string;
}

export function cssColorToHex(value: string): string {
  const hex = value.trim().match(/^#([0-9a-f]{6})$/i);
  if (hex) return `#${hex[1]!.toLowerCase()}`;
  const rgb = value.match(/^rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)(?:\D+([\d.]+))?\s*\)$/i);
  if (!rgb || (rgb[4] !== undefined && Number(rgb[4]) === 0)) return "";
  return `#${[rgb[1], rgb[2], rgb[3]]
    .map((part) => Math.min(255, Number(part)).toString(16).padStart(2, "0"))
    .join("")}`;
}

export function firstCssColor(value: string): string {
  for (const match of value.matchAll(/#[0-9a-f]{6}|rgba?\([^)]*\)/gi)) {
    const color = cssColorToHex(match[0]);
    if (color) return color;
  }
  return "";
}

export function readComputedBlockValues(element: Element): ComputedBlockValues {
  const style = getComputedStyle(element);
  const accent =
    style.getPropertyValue("--jf-block-accent").trim() ||
    style.getPropertyValue("--color-primary").trim();
  return {
    background: cssColorToHex(style.backgroundColor) || firstCssColor(style.backgroundImage),
    textColor: cssColorToHex(style.color),
    accent: cssColorToHex(accent),
    opacity: `${Math.round(Number(style.opacity || 1) * 100)}%`,
    minHeight: style.minHeight === "0px" ? "" : style.minHeight,
    maxWidth: style.maxWidth === "none" ? "" : style.maxWidth,
    maxHeight: style.maxHeight === "none" ? "" : style.maxHeight,
    textAlign: style.textAlign,
    radius: style.borderRadius === "0px" ? "" : style.borderRadius,
    shadow: style.boxShadow === "none" ? "" : style.boxShadow,
  };
}
