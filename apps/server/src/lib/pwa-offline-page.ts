// SPDX-License-Identifier: MIT

import type { PwaSettings } from "./pwa-settings.js";

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * The precached offline fallback shown on a failed navigation once the
 * service worker has completed one successful online initialization. Kept
 * small and self-contained (no external stylesheet, one optional image) so
 * it can be precached in full at `install` time.
 */
export function buildOfflinePageHtml(settings: PwaSettings): string {
  const title = esc(settings.offline.title || settings.appName || "You're offline");
  const message = esc(
    settings.offline.message || "Check your connection and try again.",
  );
  const themeColor = esc(settings.themeColor || "#111111");
  const image = settings.offline.imageUrl
    ? `<img src="${esc(settings.offline.imageUrl)}" alt="" width="96" height="96">`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="${themeColor}">
<title>${title}</title>
<style>
  html,body{height:100%;margin:0}
  body{display:flex;align-items:center;justify-content:center;background:#f5f5f5;color:#111;font:16px/1.5 system-ui,sans-serif}
  main{max-width:28rem;padding:2rem;text-align:center}
  img{margin-bottom:1rem}
  h1{font-size:1.25rem;margin:0 0 .5rem}
  p{margin:0 0 1.25rem;color:#444}
  button{font:inherit;padding:.6rem 1.25rem;border:0;border-radius:.4rem;background:${themeColor};color:#fff;cursor:pointer}
  button:focus-visible{outline:2px solid ${themeColor};outline-offset:2px}
  @media (prefers-color-scheme: dark){
    body{background:#111;color:#eee}
    p{color:#aaa}
  }
</style>
</head>
<body>
<main>
${image}
<h1>${title}</h1>
<p>${message}</p>
<button type="button" onclick="location.reload()">Retry</button>
</main>
</body>
</html>
`;
}
