// SPDX-License-Identifier: MIT

/**
 * Per-block spacing, sizing and alignment.
 *
 * Values are written as declarations on the block's own root element rather
 * than as custom properties behind a stylesheet rule, so only what an editor
 * actually set is emitted and nothing has to override the theme's own padding
 * to get there. Spacing is expressed in scale steps (`var(--space-5)`) so the
 * theme can pull every block in at once on a small screen.
 */

/** Scale steps an editor can pick, mapped to the tokens the theme defines. */
export const SPACE_STEPS = ["", "0", "1", "2", "3", "4", "5", "6", "7", "8"] as const;
export type SpaceStep = (typeof SPACE_STEPS)[number];

export const ALIGN_SELF = ["", "start", "center", "end", "stretch"] as const;
export const TEXT_ALIGN = ["", "left", "center", "right"] as const;
export const WIDTH_PRESETS = ["", "narrow", "content", "wide", "full"] as const;
export const RADIUS_PRESETS = ["", "none", "sm", "md", "lg", "pill"] as const;
export const SHADOW_PRESETS = ["", "none", "sm", "md"] as const;

const WIDTH_VALUES: Record<string, string> = {
  narrow: "34rem",
  content: "var(--max-width)",
  wide: "var(--max-width-wide)",
  full: "100%",
};

const RADIUS_VALUES: Record<string, string> = {
  none: "0",
  sm: "var(--radius-sm)",
  md: "var(--radius-md)",
  lg: "var(--radius-lg)",
  pill: "999px",
};

const SHADOW_VALUES: Record<string, string> = {
  none: "none",
  sm: "var(--shadow-sm)",
  md: "var(--shadow-md)",
};

export interface BlockStyle {
  padTop: SpaceStep;
  padBottom: SpaceStep;
  padX: SpaceStep;
  marginTop: SpaceStep;
  marginBottom: SpaceStep;
  width: string;
  minHeight: number;
  alignSelf: string;
  textAlign: string;
  radius: string;
  shadow: string;
}

export const DEFAULT_BLOCK_STYLE: BlockStyle = {
  padTop: "", padBottom: "", padX: "",
  marginTop: "", marginBottom: "",
  width: "", minHeight: 0, alignSelf: "", textAlign: "", radius: "", shadow: "",
};

function pick<T extends string>(raw: unknown, allowed: readonly T[]): T {
  return typeof raw === "string" && (allowed as readonly string[]).includes(raw) ? (raw as T) : ("" as T);
}

function clampInt(raw: unknown, min: number, max: number): number {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isFinite(n)) return 0;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Coerce stored JSON into a style. Anything unrecognised becomes "unset". */
export function parseBlockStyle(raw: unknown): BlockStyle {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_BLOCK_STYLE };
  const input = raw as Record<string, unknown>;
  return {
    padTop: pick(input["padTop"], SPACE_STEPS),
    padBottom: pick(input["padBottom"], SPACE_STEPS),
    padX: pick(input["padX"], SPACE_STEPS),
    marginTop: pick(input["marginTop"], SPACE_STEPS),
    marginBottom: pick(input["marginBottom"], SPACE_STEPS),
    width: pick(input["width"], WIDTH_PRESETS),
    minHeight: clampInt(input["minHeight"], 0, 100),
    alignSelf: pick(input["alignSelf"], ALIGN_SELF),
    textAlign: pick(input["textAlign"], TEXT_ALIGN),
    radius: pick(input["radius"], RADIUS_PRESETS),
    shadow: pick(input["shadow"], SHADOW_PRESETS),
  };
}

export function isDefaultBlockStyle(style: BlockStyle): boolean {
  return (
    !style.padTop && !style.padBottom && !style.padX &&
    !style.marginTop && !style.marginBottom &&
    !style.width && style.minHeight === 0 &&
    !style.alignSelf && !style.textAlign && !style.radius && !style.shadow
  );
}

/** Drop unset values so stored block JSON stays small. */
export function compactBlockStyle(style: BlockStyle): Record<string, unknown> | undefined {
  if (isDefaultBlockStyle(style)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(style)) {
    if (value === "" || value === 0) continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function sanitizeBlockStyleProp(raw: unknown): Record<string, unknown> | undefined {
  if (raw === undefined || raw === null) return undefined;
  return compactBlockStyle(parseBlockStyle(raw));
}

function space(step: SpaceStep): string {
  return step === "0" ? "0" : `var(--space-${step})`;
}

/** The declarations for a style, ready to merge into a `style` attribute. */
export function blockStyleDeclarations(style: BlockStyle): string {
  const out: string[] = [];
  if (style.padTop) out.push(`padding-top:${space(style.padTop)}`);
  if (style.padBottom) out.push(`padding-bottom:${space(style.padBottom)}`);
  if (style.padX) out.push(`padding-left:${space(style.padX)}`, `padding-right:${space(style.padX)}`);
  if (style.marginTop) out.push(`margin-top:${space(style.marginTop)}`);
  if (style.marginBottom) out.push(`margin-bottom:${space(style.marginBottom)}`);
  if (style.width) {
    out.push(`max-width:${WIDTH_VALUES[style.width] ?? "100%"}`);
    // A width means nothing without saying where the slack goes.
    if (style.width !== "full") out.push("margin-left:auto", "margin-right:auto");
  }
  if (style.minHeight > 0) out.push(`min-height:${style.minHeight}vh`);
  if (style.alignSelf) out.push(`justify-self:${style.alignSelf}`, `align-self:${style.alignSelf}`);
  if (style.textAlign) out.push(`text-align:${style.textAlign}`);
  if (style.radius) out.push(`border-radius:${RADIUS_VALUES[style.radius] ?? "0"}`);
  if (style.shadow) out.push(`box-shadow:${SHADOW_VALUES[style.shadow] ?? "none"}`);
  return out.join(";");
}
