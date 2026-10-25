// SPDX-License-Identifier: MIT
import type { Plugin } from "vite";

/**
 * React Router wraps the assignment in `try { if (isBrowser) { ... } } catch`.
 * The published build uses either `isBrowser` or `isBrowser2`.
 */
const FINGERPRINT =
  /try\s*\{\s*if\s*\(\s*[A-Za-z_$][\w$]*\s*\)\s*\{\s*window\.__reactRouterVersion\s*=[\s\S]*?\}\s*catch\s*(?:\(\s*[\w$]*\s*\))?\s*\{\s*\}/g;

/** Fallback when a future build assigns the global without that try/catch. */
const ASSIGNMENT = /window\.__reactRouterVersion\s*=\s*["'][^"']*["']\s*;?/g;

/** `react-router v7.18.4` or `react-router-dom v7.18.4` in the license banner. The copyright line stays. */
const VERSION_BANNER = /react-router(-dom)? v\d+\.\d+\.\d+(?:[-+][\w.-]+)?/g;
const HAS_VERSION_BANNER = /react-router(?:-dom)? v\d+\.\d+\.\d+/;

/**
 * Bundlers keep the pnpm path in a chunk comment (`react-router@7.18.4_...`).
 * That comment is added after module transforms.
 */
const PACKAGE_PATH_VERSION = /react-router(-dom)?@\d+\.\d+\.\d+(?:[-+][\w.-]+)?/g;

/**
 * Remove the release number React Router ships for technology scanners.
 * Scanners read `window.__reactRouterVersion`; the same release is also
 * stamped on the license banner that bundlers keep.
 */
export function stripReactRouterVersion(code: string): string {
  const hasPathVersion = code.includes("react-router@") || code.includes("react-router-dom@");
  if (!code.includes("__reactRouterVersion") && !HAS_VERSION_BANNER.test(code) && !hasPathVersion) return code;
  return code
    .replace(FINGERPRINT, "")
    .replace(ASSIGNMENT, "")
    .replace(VERSION_BANNER, "react-router$1")
    .replace(PACKAGE_PATH_VERSION, "react-router$1");
}

function isReactRouterModule(id: string): boolean {
  const file = id.split("?", 1)[0] ?? id;
  return /[\\/]node_modules[\\/]react-router(?:-dom)?[\\/]/.test(file);
}

/**
 * Vite and Rolldown plugin. Dev pre-bundling uses its own Rolldown pipeline,
 * so the client config passes this to both `plugins` and `optimizeDeps`.
 */
export function hideReactRouterVersion(): Plugin {
  return {
    name: "hide-react-router-version",
    transform(code, id) {
      if (!isReactRouterModule(id)) return null;
      const next = stripReactRouterVersion(code);
      if (next === code) return null;
      return { code: next, map: null };
    },
    renderChunk(code) {
      const next = stripReactRouterVersion(code);
      if (next === code) return null;
      return { code: next, map: null };
    },
  };
}
