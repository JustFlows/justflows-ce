// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  buildRetirementServiceWorkerScript,
  buildServiceWorkerScript,
  PWA_OFFLINE_URL,
} from "../../../src/lib/pwa/pwa-service-worker.js";
import { DEFAULT_PWA_SETTINGS, type PwaSettings } from "../../../src/lib/pwa/pwa-settings.js";

const settings: PwaSettings = { ...DEFAULT_PWA_SETTINGS, enabled: true, cacheVersion: 7 };

describe("buildServiceWorkerScript", () => {
  it("embeds the current cache version in the cache name", () => {
    expect(buildServiceWorkerScript(settings)).toContain('"jf-pwa-v7"');
  });

  it("precaches the offline page", () => {
    expect(buildServiceWorkerScript(settings)).toContain(JSON.stringify(PWA_OFFLINE_URL));
  });

  it("never intercepts admin, api, login, or install navigations", () => {
    const script = buildServiceWorkerScript(settings);
    expect(script).toContain("/^\\/(admin|api|login|install)(\\/|$)/");
  });

  it("only calls skipWaiting on an explicit message, never on install", () => {
    const script = buildServiceWorkerScript(settings);
    const installBlock = script.slice(script.indexOf('addEventListener("install"'), script.indexOf('addEventListener("activate"'));
    expect(installBlock).not.toContain("skipWaiting");
    expect(script).toContain('event.data.type === "SKIP_WAITING"');
  });

  it("embeds the configured asset-cache bounds", () => {
    const withCache = { ...settings, assetCache: { enabled: true, maxEntries: 42, maxAgeSeconds: 3600 } };
    const script = buildServiceWorkerScript(withCache);
    expect(script).toContain("ASSET_MAX_ENTRIES = 42");
    expect(script).toContain("ASSET_MAX_AGE_SECONDS = 3600");
    expect(script).toContain("ASSET_CACHE_ENABLED = true");
  });

  it("disables asset caching in the generated script when settings say so", () => {
    const disabled = { ...settings, assetCache: { ...settings.assetCache, enabled: false } };
    expect(buildServiceWorkerScript(disabled)).toContain("ASSET_CACHE_ENABLED = false");
  });
});

describe("buildRetirementServiceWorkerScript", () => {
  it("deletes every pwa cache and unregisters itself", () => {
    const script = buildRetirementServiceWorkerScript();
    expect(script).toContain("caches.delete");
    expect(script).toContain("self.registration.unregister()");
  });
});
