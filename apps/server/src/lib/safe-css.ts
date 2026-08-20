const MAX_CUSTOM_CSS_BYTES = 32 * 1024;

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

/** Strip dangerous constructs from editor-supplied theme CSS. */
export function sanitizeCustomCss(input: string): string {
  const css = input.trim();
  if (!css) return "";

  if (Buffer.byteLength(css, "utf-8") > MAX_CUSTOM_CSS_BYTES) {
    throw new Error(`Custom CSS exceeds ${MAX_CUSTOM_CSS_BYTES / 1024} KB limit`);
  }

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(css)) {
      throw new Error("Custom CSS contains disallowed constructs");
    }
  }

  return css;
}
