// SPDX-License-Identifier: MIT

// Fetch, gate, download, and stage a Marketplace package.
//
// Shared by the install route, the manual "Update" action, and the unattended
// extension auto-updater so every path applies the same visibility, beta,
// commercial, digest, and signature checks.

import { ARCHIVE_LIMITS, type InstallResult } from "@justflows/installer";
import { assertPackageIsTrusted } from "./package-trust.js";
import { packagesInstalledDir } from "./packages-dir.js";
import {
  MARKETPLACE_ALLOW_BETA_SETTING,
  marketplaceListingIsBeta,
  marketplaceListingIsComingSoon,
  marketplaceListingIsPaid,
  marketplaceListingIsVisible,
} from "./marketplace-catalog.js";
import { getJustflowsVersion } from "../runtime/version.js";
import { getSiteSetting } from "../settings/site-settings.js";

export const JUSTFLOWS_API_BASE = "https://api.justflows.com";

/**
 * A registry that hangs or answers forever is still a dependency failure.
 * Without a deadline the request thread stalled indefinitely, and
 * `await download.arrayBuffer()` buffered the whole body before the installer's
 * 50 MB limit could apply — so the ceiling only ever ran after the memory had
 * already been spent.
 */
export const FETCH_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

export type MarketplacePackageType = "plugin" | "theme";

export interface MarketplaceListing {
  id?: string;
  name?: string;
  version?: string;
  channel?: string;
  pricing?: { type?: string };
  registry?: {
    listed?: boolean;
    free?: boolean;
    commercialMarketplace?: boolean;
    comingSoon?: boolean;
    beta?: boolean;
  };
}

/** A refusal with an HTTP status and a body the admin UI already understands. */
export class MarketplaceRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(typeof body.error === "string" ? body.error : `Marketplace request failed (${status})`);
    this.name = "MarketplaceRequestError";
  }
}

/** Read a response body, aborting once it exceeds `maxBytes`. */
async function readBounded(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`Package exceeds ${Math.floor(maxBytes / 1024 / 1024)} MB limit`);
  }
  if (!response.body) return Buffer.alloc(0);

  const chunks: Buffer[] = [];
  let total = 0;
  // Streamed rather than trusting Content-Length, which a hostile or broken
  // registry can understate or omit entirely.
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      throw new Error(`Package exceeds ${Math.floor(maxBytes / 1024 / 1024)} MB limit`);
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function kindSegment(type: MarketplacePackageType): "plugins" | "themes" {
  return type === "plugin" ? "plugins" : "themes";
}

/** Look up one listing (a pinned version, or the latest). */
export async function fetchMarketplaceListing(
  type: MarketplacePackageType,
  id: string,
  version?: string,
): Promise<MarketplaceListing> {
  const versionSegment = version ? `/versions/${encodeURIComponent(version)}` : "/versions/latest";
  const metaUrl = `${JUSTFLOWS_API_BASE}/v1/marketplace/${kindSegment(type)}/${encodeURIComponent(id)}${versionSegment}`;
  const metaRes = await fetch(metaUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!metaRes.ok) {
    throw new MarketplaceRequestError(metaRes.status, { error: `Listing not found (${id})` });
  }
  return (await metaRes.json()) as MarketplaceListing;
}

/**
 * Enforced on the server, not only in the UI: hidden, coming-soon, commercial,
 * and (unless the site opted in) beta listings are never installed.
 */
export async function assertListingInstallable(
  listing: MarketplaceListing,
  id: string,
  siteId: string | undefined,
): Promise<void> {
  if (!marketplaceListingIsVisible(listing)) {
    throw new MarketplaceRequestError(404, { error: `Listing not found (${id})` });
  }

  if (marketplaceListingIsComingSoon(listing)) {
    throw new MarketplaceRequestError(403, {
      error: "This listing is coming soon and cannot be installed yet.",
    });
  }

  // Beta builds stay uninstallable until an administrator opts the site in
  // under Settings.
  if (marketplaceListingIsBeta(listing)) {
    const allowBeta = siteId
      ? (await getSiteSetting<boolean>(siteId, MARKETPLACE_ALLOW_BETA_SETTING)) === true
      : false;
    if (!allowBeta) {
      throw new MarketplaceRequestError(403, {
        error: "This listing is a beta. Allow beta installs in Settings to install it.",
        code: "beta_disabled",
      });
    }
  }

  if (marketplaceListingIsPaid(listing)) {
    throw new MarketplaceRequestError(402, {
      error: "This listing is commercial. Get it on Justflows.",
      checkoutUrl: "https://justflows.com/marketplace",
    });
  }
}

/**
 * Resolve, gate, download, verify, and extract a Marketplace package into
 * `packages-installed/`. Registering it in the database is the caller's job.
 */
export async function installMarketplacePackage(options: {
  type: MarketplacePackageType;
  id: string;
  version?: string;
  siteId: string | undefined;
}): Promise<InstallResult> {
  const { type, id, version, siteId } = options;
  const listing = await fetchMarketplaceListing(type, id, version);
  await assertListingInstallable(listing, id, siteId);

  const resolvedVersion = version ?? listing.version;
  if (!resolvedVersion) {
    throw new MarketplaceRequestError(400, { error: "Version is required" });
  }

  // Always download via the public API. Registry downloadUrl is an internal
  // path (e.g. /v1/plugins/...) which Node fetch cannot resolve.
  const downloadUrl = `${JUSTFLOWS_API_BASE}/v1/marketplace/${kindSegment(type)}/${encodeURIComponent(id)}/versions/${encodeURIComponent(resolvedVersion)}/download`;
  const download = await fetch(downloadUrl, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!download.ok) {
    throw new MarketplaceRequestError(download.status, { error: "Download failed" });
  }

  const buffer = await readBounded(download, ARCHIVE_LIMITS.maxCompressedBytes);
  const digest = download.headers.get("x-justflows-digest") ?? "";
  const signature = download.headers.get("x-justflows-signature") ?? "";

  const { PackageInstaller } = await import("@justflows/installer");
  const installer = new PackageInstaller();
  // Verified inside the installer, while the package is still staged — see
  // the note on InstallOptions.verify.
  return installer.installFromBuffer(buffer, {
    packagesDir: packagesInstalledDir(),
    justflowsVersion: getJustflowsVersion(),
    source: "marketplace",
    expectedDigest: digest || undefined,
    // Plugins run as code — install each build to its own directory so a
    // reinstall is imported fresh without a process restart.
    revisioned: type === "plugin",
    verify: (manifest, resultDigest) => {
      if (manifest.type !== type) {
        throw new Error(`Package type mismatch (expected ${type})`);
      }
      if (manifest.id !== id) {
        throw new Error(`Package id mismatch (expected ${id})`);
      }
      assertPackageIsTrusted(manifest as unknown as Record<string, unknown>, resultDigest, {
        marketplaceSignature: signature || undefined,
      });
    },
  });
}
