// SPDX-License-Identifier: MIT

/**
 * CSS an editor can type — theme-wide Additional CSS, or the per-block CSS in
 * the page builder — never reaches the browser as written. Two things happen to
 * it: a blocklist rejects constructs that fetch or execute, and block CSS is
 * rewritten so every selector is confined to the block that owns it.
 */

/** A single block's CSS, in characters. Generous for a component, small for a page. */
const MAX_BLOCK_CSS_CHARS = 8 * 1024;

/** Nesting at-rules whose body is itself a list of rules to scope. */
const NESTING_AT_RULES = new Set(["media", "supports", "container", "layer"]);

/** At-rules that are meaningless to scope and are emitted as written. */
const PASSTHROUGH_AT_RULES = new Set(["keyframes", "-webkit-keyframes", "font-face"]);

const BLOCKED_PATTERNS = [
  /@import\b/i,
  /expression\s*\(/i,
  /-moz-binding/i,
  /\bbehavior\s*:/i,
  /javascript\s*:/i,
  /vbscript\s*:/i,
  /url\s*\(\s*['"]?\s*(?:javascript|data|vbscript):/i,
  /<\/style/i,
];

/**
 * Decode CSS escape sequences so the patterns above cannot be stepped around.
 *
 * CSS lets any character in an identifier or at-rule name be written as a
 * backslash escape, and browsers resolve them before matching. Without this,
 * `@\69 mport` and `url(\6a avascript:…)` sail past a literal blocklist while
 * meaning exactly what the blocklist exists to reject.
 *
 * Per CSS Syntax §4.3.7: a backslash followed by 1–6 hex digits, optionally
 * terminated by a single whitespace character; a backslash followed by any
 * other non-newline character is that character literally.
 */
export function decodeCssEscapes(input: string): string {
  return input.replace(/\\(?:([0-9a-fA-F]{1,6})[ \t\n\f\r]?|([^\n\r\f]))/g, (_match, hex, literal) => {
    if (hex) {
      const code = Number.parseInt(hex, 16);
      // Surrogates and out-of-range values map to U+FFFD, as browsers do.
      if (!Number.isFinite(code) || code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        return "�";
      }
      return String.fromCodePoint(code);
    }
    return literal ?? "";
  });
}

/** Remove `/* … *​/` comments, which can otherwise split a blocked keyword. */
export function stripCssComments(input: string): string {
  return input.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, " ");
}

/**
 * Normalise editor CSS to the form a browser will actually see, so the checks
 * below match on meaning rather than on spelling.
 */
export function normalizeCssForChecks(input: string): string {
  return decodeCssEscapes(stripCssComments(input));
}

/** True when the CSS contains a construct that fetches, executes, or escapes. */
export function hasUnsafeCss(css: string): boolean {
  const normalized = normalizeCssForChecks(css);
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(css) || pattern.test(normalized));
}

/**
 * A block's own CSS, cleared for storage. Unusable input yields `""` rather
 * than an exception: one bad block must not fail the save of a whole page.
 */
export function sanitizeBlockCss(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const css = raw.trim();
  if (!css || css.length > MAX_BLOCK_CSS_CHARS) return "";
  return hasUnsafeCss(css) ? "" : css;
}

/** Extra classes an editor typed. Identifier characters only, so nothing escapes the attribute. */
export function sanitizeBlockClassName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .split(/\s+/)
    .map((cls) => cls.replace(/[^A-Za-z0-9_-]/g, ""))
    .filter(Boolean)
    .slice(0, 12)
    .join(" ")
    .slice(0, 200);
}

/** The class that ties a block's markup to its own CSS. Empty when the block has no id. */
export function blockScopeClass(id: unknown): string {
  if (typeof id !== "string") return "";
  const safe = id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  return safe ? `jf-b-${safe}` : "";
}

// ─── Scoping ───────────────────────────────────────────────────────────────

/** Index just past the closing quote of the string starting at `start`. */
function stringEnd(css: string, start: number): number {
  const quote = css[start];
  let i = start + 1;
  while (i < css.length) {
    if (css[i] === "\\") {
      i += 2;
      continue;
    }
    if (css[i] === quote) return i + 1;
    i++;
  }
  return css.length;
}

/** Index just past the `}` matching the `{` at `start`. */
function blockEnd(css: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < css.length) {
    const ch = css[i]!;
    if (ch === '"' || ch === "'") {
      i = stringEnd(css, i);
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return css.length;
}

interface Rule {
  prelude: string;
  body: string;
}

/**
 * Split a stylesheet into its top-level rules, ignoring braces inside strings.
 * `trailing` is whatever followed the last rule — declarations, in practice.
 */
function splitRules(css: string): { rules: Rule[]; trailing: string } {
  const rules: Rule[] = [];
  let prelude = "";
  let i = 0;
  while (i < css.length) {
    const ch = css[i]!;
    if (ch === '"' || ch === "'") {
      const end = stringEnd(css, i);
      prelude += css.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "{") {
      const end = blockEnd(css, i);
      rules.push({ prelude: prelude.trim(), body: css.slice(i + 1, Math.max(i + 1, end - 1)) });
      prelude = "";
      i = end;
      continue;
    }
    prelude += ch;
    i++;
  }
  return { rules, trailing: prelude };
}

/** Split on a separator that is not inside brackets or a string. */
function splitTopLevel(input: string, separator: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === '"' || ch === "'") {
      const end = stringEnd(input, i);
      current += input.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (ch === separator && depth === 0) {
      parts.push(current);
      current = "";
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  parts.push(current);
  return parts;
}

/**
 * Confine a selector list to one block. `&` stands for the block itself, as in
 * nested CSS; a selector that never mentions it is treated as a descendant, so
 * an editor cannot reach outside the block whether they know the convention or
 * not.
 */
function scopeSelectorList(selector: string, scope: string): string {
  return splitTopLevel(selector, ",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (part.includes("&") ? part.split("&").join(scope) : `${scope} ${part}`))
    .join(", ");
}

/**
 * Pull the declarations out of text sitting between rules. A statement at-rule
 * (`@charset "utf-8";`) also ends in a semicolon but is not a declaration and
 * cannot be scoped, so it is dropped rather than pasted into the block.
 */
function collectDeclarations(text: string): string[] {
  return splitTopLevel(text, ";")
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith("@"))
    .map((part) => `${part};`);
}

function scopeRules(css: string, scope: string, depth: number): string {
  if (depth > 8) return "";
  const out: string[] = [];
  const { rules, trailing } = splitRules(css);

  // Declarations written alongside rules — `padding: 2rem; & h2 { … }` — belong
  // to the block itself, the same way they do in nested CSS. They are collected
  // rather than folded into the next selector, which would break it.
  const loose: string[] = [];

  for (const rule of rules) {
    const semicolon = rule.prelude.lastIndexOf(";");
    if (semicolon >= 0) loose.push(...collectDeclarations(rule.prelude.slice(0, semicolon + 1)));
    const prelude = (semicolon >= 0 ? rule.prelude.slice(semicolon + 1) : rule.prelude).trim();
    if (!prelude) continue;

    if (prelude.startsWith("@")) {
      const name = (prelude.slice(1).match(/^[\w-]+/)?.[0] ?? "").toLowerCase();
      if (NESTING_AT_RULES.has(name)) {
        const inner = scopeRules(rule.body, scope, depth + 1);
        if (inner) out.push(`${prelude} {\n${inner}\n}`);
      } else if (PASSTHROUGH_AT_RULES.has(name)) {
        out.push(`${prelude} {${rule.body}}`);
      }
      // Anything else — @import is already blocked, @charset and friends are
      // meaningless here — is dropped rather than guessed at.
      continue;
    }

    const selector = scopeSelectorList(prelude, scope);
    if (selector) out.push(`${selector} {${rule.body}}`);
  }

  loose.push(...collectDeclarations(trailing));

  // Emitted first, so an explicit `& { … }` rule still wins over a loose
  // declaration of the same property.
  if (loose.length > 0) out.unshift(`${scope} {${loose.join(" ")}}`);

  return out.join("\n");
}

/**
 * Rewrite a block's CSS so every rule applies only within that block.
 *
 * Bare declarations (`padding: 2rem`) are wrapped for the block itself; full
 * rules may use `&` for the block and are otherwise scoped as descendants.
 * Returns `""` when there is nothing safe to emit.
 */
export function scopeBlockCss(raw: unknown, scope: string): string {
  const css = sanitizeBlockCss(raw);
  if (!css || !scope) return "";

  const body = stripCssComments(css).trim();
  if (!body) return "";

  const scoped = body.includes("{")
    ? scopeRules(body, scope, 0)
    : `${scope} {${body.replace(/}/g, "")}}`;

  // Last line of defence: nothing may close the <style> element it lands in.
  return scoped.replace(/<\/style/gi, "").trim();
}
