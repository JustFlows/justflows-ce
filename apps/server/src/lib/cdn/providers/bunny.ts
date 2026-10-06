// SPDX-License-Identifier: MIT

import { CdnProviderError, type CdnConfig, type CdnProviderAdapter } from "./types.js";

const API = "https://api.bunny.net";
const TIMEOUT_MS = 8000;

async function call(key: string, method: "GET" | "POST", path: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: { AccessKey: key, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new CdnProviderError("Bunny.net could not be reached.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new CdnProviderError("Bunny.net rejected the API key.", response.status);
  }
  if (response.status === 404) {
    throw new CdnProviderError("Bunny.net does not know that pull zone.", response.status);
  }
  if (!response.ok) {
    throw new CdnProviderError(`Bunny.net answered ${response.status}.`, response.status);
  }
}

function zoneId(config: CdnConfig): string {
  return config.pullZoneId?.trim() ?? "";
}

/** Bunny.net: purge by URL prefix, or a whole pull zone when its id is set. */
export const bunnyAdapter: CdnProviderAdapter = {
  id: "bunny",
  label: "Bunny.net",
  docsUrl: "https://docs.bunny.net/reference/bunnynet-api-overview",
  signupUrl: "https://bunny.net?ref=eu2g96kbs9",
  fields: [
    {
      id: "apiKey",
      label: "Account API key",
      hint: "Bunny.net → Account settings → API key.",
      secret: true,
      required: true,
      maxLength: 200,
      pattern: /^[A-Za-z0-9-]{8,200}$/,
    },
    {
      id: "pullZoneId",
      label: "Pull zone ID",
      hint: "Optional. Needed to clear the whole pull zone at once.",
      secret: false,
      required: false,
      maxLength: 20,
      pattern: /^\d{1,20}$/,
    },
  ],

  async verify(config) {
    const zone = zoneId(config);
    await call(config.apiKey ?? "", "GET", zone ? `/pullzone/${encodeURIComponent(zone)}` : "/pullzone?page=1&perPage=1");
  },

  async purgeUrls(config, urls) {
    for (const url of urls) {
      await call(config.apiKey ?? "", "POST", `/purge?async=true&url=${encodeURIComponent(url)}`);
    }
  },

  async purgeAll(config) {
    const zone = zoneId(config);
    if (!zone) return false;
    await call(config.apiKey ?? "", "POST", `/pullzone/${encodeURIComponent(zone)}/purgeCache`);
    return true;
  },
};
