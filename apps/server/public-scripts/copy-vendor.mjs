// SPDX-License-Identifier: MIT

import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copies self-hosted third-party static assets (currently: KaTeX's CSS and
 * webfonts, for inline math formulas) into public/vendor/ (repo root) so
 * server.ts's existing static middleware can serve them — no CDN, matching
 * the self-hosted-only stance of the rest of the app's static assets.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const vendorDir = path.join(here, "../../../public/vendor");

const katexDist = path.dirname(fileURLToPath(import.meta.resolve("katex/dist/katex.min.css")));
const katexOut = path.join(vendorDir, "katex");
rmSync(katexOut, { recursive: true, force: true });
mkdirSync(katexOut, { recursive: true });
cpSync(path.join(katexDist, "katex.min.css"), path.join(katexOut, "katex.min.css"));
cpSync(path.join(katexDist, "fonts"), path.join(katexOut, "fonts"), { recursive: true });

console.log("[public-scripts] copied katex.min.css + fonts to public/vendor/katex/");
