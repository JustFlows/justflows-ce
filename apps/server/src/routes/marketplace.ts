// SPDX-License-Identifier: MIT

import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../middleware/auth.js";
import { assertPackageIsTrusted } from "../lib/package-trust.js";
import { packagesInstalledDir } from "../lib/packages-dir.js";

const router = Router();

const JUSTFLOWS_API_BASE = "https://api.justflows.com";

router.get("/", requireRole("administrator"), async (req, res) => {
  try {
    const params = new URLSearchParams();
    for (const key of ["q", "category", "channel", "compatibleWith", "type"] as const) {
      const value = req.query[key];
      if (typeof value === "string" && value) params.set(key, value);
    }
    const qs = params.toString();
    const url = `${JUSTFLOWS_API_BASE}/v1/marketplace${qs ? `?${qs}` : ""}`;
    const upstream = await fetch(url);
    const body = await upstream.text();
    // Always JSON. Echoing the upstream Content-Type would let a compromised or
    // misconfigured registry serve text/html from this site's origin.
    res.status(upstream.status).type("application/json").send(body);
  } catch (err) {
    res.status(503).json({ error: `Marketplace API unavailable: ${String(err)}` });
  }
});

const InstallSchema = z.object({
  type: z.enum(["plugin", "theme"]),
  id: z.string().min(1),
  version: z.string().optional(),
});

router.post("/install", requireRole("administrator"), async (req, res) => {
  try {
    const { type, id, version } = InstallSchema.parse(req.body);
    const versionSegment = version ? `/versions/${encodeURIComponent(version)}` : "/versions/latest";
    const kind = type === "plugin" ? "plugins" : "themes";
    const metaUrl = `${JUSTFLOWS_API_BASE}/v1/marketplace/${kind}/${encodeURIComponent(id)}${versionSegment}`;
    const metaRes = await fetch(metaUrl);
    if (!metaRes.ok) {
      res.status(metaRes.status).json({ error: `Listing not found (${id})` });
      return;
    }
    const listing = (await metaRes.json()) as {
      version?: string;
      channel?: string;
      pricing?: { type?: string };
    };

    if (listing.pricing?.type === "paid" || listing.channel === "commercial") {
      res.status(402).json({
        error: "This listing is commercial. Get it on Justflows.",
        checkoutUrl: "https://justflows.com/marketplace",
      });
      return;
    }

    const resolvedVersion = version ?? listing.version;
    if (!resolvedVersion) {
      res.status(400).json({ error: "Version is required" });
      return;
    }

    // Always download via the public API. Registry downloadUrl is an internal
    // path (e.g. /v1/plugins/...) which Node fetch cannot resolve.
    const downloadUrl = `${JUSTFLOWS_API_BASE}/v1/marketplace/${kind}/${encodeURIComponent(id)}/versions/${encodeURIComponent(resolvedVersion)}/download`;
    const download = await fetch(downloadUrl);
    if (!download.ok) {
      res.status(download.status).json({ error: "Download failed" });
      return;
    }

    const buffer = Buffer.from(await download.arrayBuffer());
    const digest = download.headers.get("x-justflows-digest") ?? "";
    const signature = download.headers.get("x-justflows-signature") ?? "";

    const { PackageInstaller } = await import("@justflows/installer");
    const installer = new PackageInstaller();
    const packagesDir = packagesInstalledDir();
    const result = await installer.installFromBuffer(buffer, {
      packagesDir,
      source: "marketplace",
      expectedDigest: digest || undefined,
    });

    if (result.manifest.type !== type) {
      res.status(400).json({ error: `Package type mismatch (expected ${type})` });
      return;
    }

    assertPackageIsTrusted(
      result.manifest as unknown as Record<string, unknown>,
      result.digest,
      { marketplaceSignature: signature || undefined },
    );

    if (type === "plugin") {
      const { insertPlugin } = await import("../lib/plugins-db.js");
      const siteId = req.session?.siteId;
      if (!siteId) {
        res.status(503).json({ error: "No site found — complete install first" });
        return;
      }
      const plugin = await insertPlugin(siteId, {
        pluginId: result.manifest.id,
        version: result.manifest.version,
        manifest: { ...result.manifest, installedPath: result.installedPath },
        status: "installed",
      });
      res.json({ plugin });
      return;
    }

    const { ensureThemesTable, getSiteId, insertTheme } = await import("../lib/themes-db.js");
    await ensureThemesTable();
    const siteId = await getSiteId();
    if (!siteId) {
      res.status(503).json({ error: "No site found — complete install first" });
      return;
    }
    const manifest = result.manifest as Record<string, unknown>;
    const vars = (manifest.cssVariables ?? manifest.css_variables ?? {}) as Record<string, unknown>;
    const cssVariables: Record<string, string> = {};
    for (const [k, v] of Object.entries(vars)) {
      if (typeof v === "string") cssVariables[k] = v;
    }
    const theme = {
      id: crypto.randomUUID(),
      themeId: result.manifest.id,
      name: result.manifest.name,
      version: result.manifest.version,
      publisher: result.manifest.publisher,
      description: result.manifest.description,
      cssVariables,
      manifest: { ...manifest, installedPath: result.installedPath },
    };
    await insertTheme(siteId, theme);
    res.json({ theme: { ...theme, status: "installed", active: false } });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
