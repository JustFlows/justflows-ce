// SPDX-License-Identifier: MIT

import { BLOCK_ANIMATION_CSS } from "./animation-css.js";

export const ENTRANCE_EFFECTS = [
  "none",
  "fade",
  "fade-up",
  "fade-down",
  "fade-left",
  "fade-right",
  "slide-up",
  "slide-down",
  "slide-left",
  "slide-right",
  "zoom-in",
  "zoom-out",
  "bounce",
  "flip-x",
  "flip-y",
  "rotate",
  "blur",
] as const;

export const HOVER_EFFECTS = ["none", "grow", "shrink", "lift", "glow", "tilt", "brighten"] as const;
export const TAP_EFFECTS = ["none", "press", "pulse"] as const;
export const ANIMATION_TRIGGERS = ["load", "in-view"] as const;
export const ANIMATION_EASINGS = ["ease-out", "ease-in", "ease-in-out", "linear", "spring"] as const;

export type EntranceEffect = (typeof ENTRANCE_EFFECTS)[number];
export type HoverEffect = (typeof HOVER_EFFECTS)[number];
export type TapEffect = (typeof TAP_EFFECTS)[number];
export type AnimationTrigger = (typeof ANIMATION_TRIGGERS)[number];
export type AnimationEasing = (typeof ANIMATION_EASINGS)[number];

export interface BlockAnimation {
  entrance: EntranceEffect;
  trigger: AnimationTrigger;
  duration: number;
  delay: number;
  easing: AnimationEasing;
  once: boolean;
  hover: HoverEffect;
  tap: TapEffect;
}

export const DEFAULT_BLOCK_ANIMATION: BlockAnimation = {
  entrance: "none",
  trigger: "in-view",
  duration: 0.6,
  delay: 0,
  easing: "ease-out",
  once: true,
  hover: "none",
  tap: "none",
};

export type MotionVariant = Record<string, string | number>;

export const ENTRANCE_VARIANTS: Record<Exclude<EntranceEffect, "none">, { from: MotionVariant; to: MotionVariant }> = {
  fade: { from: { opacity: 0 }, to: { opacity: 1 } },
  "fade-up": { from: { opacity: 0, y: 28 }, to: { opacity: 1, y: 0 } },
  "fade-down": { from: { opacity: 0, y: -28 }, to: { opacity: 1, y: 0 } },
  "fade-left": { from: { opacity: 0, x: 28 }, to: { opacity: 1, x: 0 } },
  "fade-right": { from: { opacity: 0, x: -28 }, to: { opacity: 1, x: 0 } },
  "slide-up": { from: { y: 48 }, to: { y: 0 } },
  "slide-down": { from: { y: -48 }, to: { y: 0 } },
  "slide-left": { from: { x: 48 }, to: { x: 0 } },
  "slide-right": { from: { x: -48 }, to: { x: 0 } },
  "zoom-in": { from: { opacity: 0, scale: 0.92 }, to: { opacity: 1, scale: 1 } },
  "zoom-out": { from: { opacity: 0, scale: 1.08 }, to: { opacity: 1, scale: 1 } },
  bounce: { from: { opacity: 0, y: 40 }, to: { opacity: 1, y: 0 } },
  "flip-x": { from: { opacity: 0, rotateX: 70 }, to: { opacity: 1, rotateX: 0 } },
  "flip-y": { from: { opacity: 0, rotateY: 70 }, to: { opacity: 1, rotateY: 0 } },
  rotate: { from: { opacity: 0, rotate: -12 }, to: { opacity: 1, rotate: 0 } },
  blur: { from: { opacity: 0, filter: "blur(12px)" }, to: { opacity: 1, filter: "blur(0px)" } },
};

export const HOVER_VARIANTS: Record<Exclude<HoverEffect, "none">, MotionVariant> = {
  grow: { scale: 1.04 },
  shrink: { scale: 0.97 },
  lift: { y: -6 },
  glow: { boxShadow: "0 12px 28px rgba(15,23,42,0.16)" },
  tilt: { rotate: 2 },
  brighten: { filter: "brightness(1.08)" },
};

export const TAP_VARIANTS: Record<Exclude<TapEffect, "none">, MotionVariant> = {
  press: { scale: 0.97 },
  pulse: { scale: 1.04 },
};

function includes<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n * 100) / 100));
}

/** Coerce stored JSON into a safe animation config. Unknown values become defaults. */
export function parseBlockAnimation(raw: unknown): BlockAnimation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_BLOCK_ANIMATION };
  }
  const input = raw as Record<string, unknown>;
  return {
    entrance: includes(ENTRANCE_EFFECTS, input["entrance"]) ? input["entrance"] : DEFAULT_BLOCK_ANIMATION.entrance,
    trigger: includes(ANIMATION_TRIGGERS, input["trigger"]) ? input["trigger"] : DEFAULT_BLOCK_ANIMATION.trigger,
    duration: clampNumber(input["duration"], DEFAULT_BLOCK_ANIMATION.duration, 0.15, 2.5),
    delay: clampNumber(input["delay"], DEFAULT_BLOCK_ANIMATION.delay, 0, 2),
    easing: includes(ANIMATION_EASINGS, input["easing"]) ? input["easing"] : DEFAULT_BLOCK_ANIMATION.easing,
    once: typeof input["once"] === "boolean" ? input["once"] : DEFAULT_BLOCK_ANIMATION.once,
    hover: includes(HOVER_EFFECTS, input["hover"]) ? input["hover"] : DEFAULT_BLOCK_ANIMATION.hover,
    tap: includes(TAP_EFFECTS, input["tap"]) ? input["tap"] : DEFAULT_BLOCK_ANIMATION.tap,
  };
}

export function isActiveAnimation(anim: BlockAnimation): boolean {
  return anim.entrance !== "none" || anim.hover !== "none" || anim.tap !== "none";
}

/** Drop default values so stored block JSON stays small. */
export function compactBlockAnimation(anim: BlockAnimation): Record<string, unknown> | undefined {
  if (!isActiveAnimation(anim)) return undefined;
  const out: Record<string, unknown> = {};
  if (anim.entrance !== "none") out["entrance"] = anim.entrance;
  if (anim.entrance !== "none" && anim.trigger !== DEFAULT_BLOCK_ANIMATION.trigger) out["trigger"] = anim.trigger;
  if (anim.duration !== DEFAULT_BLOCK_ANIMATION.duration) out["duration"] = anim.duration;
  if (anim.delay !== DEFAULT_BLOCK_ANIMATION.delay) out["delay"] = anim.delay;
  if (anim.easing !== DEFAULT_BLOCK_ANIMATION.easing) out["easing"] = anim.easing;
  if (anim.once !== DEFAULT_BLOCK_ANIMATION.once) out["once"] = anim.once;
  if (anim.hover !== "none") out["hover"] = anim.hover;
  if (anim.tap !== "none") out["tap"] = anim.tap;
  return out;
}

export function sanitizeAnimationProp(raw: unknown): Record<string, unknown> | undefined {
  return compactBlockAnimation(parseBlockAnimation(raw));
}

function replaceAttr(attrs: string, name: string, merge: (current: string) => string): string {
  const needle = ` ${name}=`;
  const start = attrs.indexOf(needle);
  if (start < 0) return `${attrs} ${name}="${merge("")}"`;
  const quoteAt = start + needle.length;
  const quote = attrs[quoteAt];
  if (quote !== '"' && quote !== "'") return `${attrs} ${name}="${merge("")}"`;
  const end = attrs.indexOf(quote, quoteAt + 1);
  if (end < 0) return `${attrs} ${name}="${merge("")}"`;
  const current = attrs.slice(quoteAt + 1, end);
  return attrs.slice(0, start) + ` ${name}="${merge(current)}"` + attrs.slice(end + 1);
}

function collapseSpaces(value: string): string {
  let out = "";
  let pendingSpace = false;
  for (const char of value.trim()) {
    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      pendingSpace = out.length > 0;
    } else {
      if (pendingSpace) out += " ";
      out += char;
      pendingSpace = false;
    }
  }
  return out;
}

export function injectRootAttrs(html: string, className: string, styleVars: string, dataAttrs: string): string {
  if (!className && !styleVars && !dataAttrs) return html;
  let leadingLength = 0;
  while (leadingLength < html.length && " \t\n\r".includes(html[leadingLength]!)) leadingLength++;
  const leading = html.slice(0, leadingLength);
  const rest = html.slice(leading.length);
  if (rest[0] !== "<" || !rest[1] || !/[a-zA-Z]/.test(rest[1])) {
    const wrapper = [
      className ? ` class="${className}"` : "",
      styleVars ? ` style="${styleVars}"` : "",
      dataAttrs ? ` ${dataAttrs}` : "",
    ].join("");
    return `${leading}<div${wrapper}>${html.trim()}</div>`;
  }
  let tagEnd = 2;
  while (tagEnd < rest.length && /[a-zA-Z0-9:-]/.test(rest[tagEnd]!)) tagEnd++;
  const openEnd = rest.indexOf(">", tagEnd);
  if (openEnd < 0) return `${leading}<div>${html.trim()}</div>`;
  const tag = rest.slice(1, tagEnd);
  let attrs = rest.slice(tagEnd, openEnd);
  const after = rest.slice(openEnd + 1);
  const trimmedAttrs = attrs.trimEnd();
  const selfClosing = trimmedAttrs.endsWith("/");
  if (selfClosing) attrs = trimmedAttrs.slice(0, -1);

  if (className) {
    attrs = replaceAttr(attrs, "class", (current) => collapseSpaces([current, className].filter(Boolean).join(" ")));
  }
  if (styleVars) {
    attrs = replaceAttr(attrs, "style", (current) => {
      const trimmed = current.trim();
      const base = trimmed.endsWith(";") ? trimmed.slice(0, -1) : trimmed;
      return base ? `${base};${styleVars}` : styleVars;
    });
  }
  if (dataAttrs) attrs = `${attrs} ${dataAttrs}`;
  const close = selfClosing ? " /" : "";
  return `${leading}<${tag}${attrs}${close}>${after}`;
}

function token(prefix: string, value: string): string {
  return `${prefix}${value}`;
}

/** Apply animation classes/data attributes to a block's root HTML element. */
export function withBlockAnimation(html: string, props: unknown): string {
  if (!html.trim()) return html;
  const record = props && typeof props === "object" && !Array.isArray(props) ? (props as Record<string, unknown>) : {};
  const anim = parseBlockAnimation(record["animation"]);
  if (!isActiveAnimation(anim)) return html;

  const classes = ["jf-anim"];
  if (anim.entrance !== "none") {
    classes.push(token("jf-anim-e-", anim.entrance));
    classes.push(anim.trigger === "in-view" ? "jf-anim--wait" : "jf-anim--play");
  }
  if (anim.hover !== "none") classes.push(token("jf-anim-h-", anim.hover));
  if (anim.tap !== "none") classes.push(token("jf-anim-t-", anim.tap));
  classes.push(token("jf-anim-ease-", anim.easing));

  const data: string[] = [];
  if (anim.entrance !== "none") {
    data.push(`data-jf-anim="${anim.trigger}"`);
    if (anim.trigger === "in-view") data.push(`data-jf-anim-once="${anim.once ? "1" : "0"}"`);
  }

  const styleVars = `--jf-anim-duration:${anim.duration}s;--jf-anim-delay:${anim.delay}s`;
  return injectRootAttrs(html, classes.join(" "), styleVars, data.join(" "));
}

export function blockAnimationCss(): string {
  return BLOCK_ANIMATION_CSS;
}
