import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { requireRole, requireSession } from "../middleware/auth.js";
import { param } from "../lib/params.js";
import {
  activateCssProvider,
  deleteCssProvider,
  getCssProvidersSiteId,
  insertCssProvider,
  listCssProviders,
} from "../lib/css-providers-db.js";
import { resolveAssetFilePath } from "../lib/css-providers-files.js";
import { revalidateOnUpdate } from "../lib/cache-revalidate.js";
import { assertPackageIsTrusted } from "../lib/package-trust.js";
import { sendPackageInstallError } from "../lib/package-install-error.js";
import { packagesInstalledDir } from "../lib/packages-dir.js";
import { auditFromRequest } from "../lib/audit-log.js";
import multer from "multer";
import { sendServerError } from "../lib/send-error.js";
import { getJustflowsVersion } from "../lib/version.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.get("/", requireSession, async (req, res) => {
  const session = req.session!;

  try {
    const siteId = await getCssProvidersSiteId();
    if (!siteId) {
      res.json({ providers: [] });
      return;
    }

    const providers = await listCssProviders(session.siteId);
    res.json({ providers });
  } catch (err) {
    sendServerError(res, "css-providers", err);
  }
});

router.post("/", requireRole("administrator"), upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }
    if (!file.originalname.endsWith(".jfpkg") && !file.originalname.endsWith(".zip")) {
      res.status(400).json({ error: "Only .jfpkg files are accepted" });
      return;
    }

    const { PackageInstaller } = await import("@justflows/installer");
    const installer = new PackageInstaller();
    const packagesDir = packagesInstalledDir();

    // Every check runs inside the installer, while the package is still staged
    // — see the note on InstallOptions.verify. The scripts rule belongs here
    // too: a provider declaring scripts was rejected only after its files had
    // been written into the directory the public asset route reads from.
    const result = await installer.installFromBuffer(file.buffer, {
      packagesDir,
      justflowsVersion: getJustflowsVersion(),
      source: "upload",
      verify: (manifest, digest) => {
        if (manifest.type !== "css-provider") {
          throw new Error(
            "Uploaded package is not a CSS provider (manifest.type must be 'css-provider')",
          );
        }
        if (Array.isArray(manifest.scripts) && manifest.scripts.length > 0) {
          throw new Error("CSS provider packages may not declare scripts");
        }
        assertPackageIsTrusted(manifest as unknown as Record<string, unknown>, digest);
      },
    });

    const siteId = await getCssProvidersSiteId();
    if (!siteId) {
      res.status(503).json({ error: "No site found — complete install first" });
      return;
    }

    const provider = await insertCssProvider(siteId, {
      providerId: result.manifest.id,
      name: result.manifest.name,
      version: result.manifest.version,
      publisher: result.manifest.publisher,
      description: result.manifest.description,
      manifest: {
        ...result.manifest,
        installedPath: result.installedPath,
      },
      status: "installed",
    });

    auditFromRequest(req, "css_provider.installed", {
      target: result.manifest.id,
      detail: `version=${result.manifest.version}`,
    });
    res.json({ provider });
  } catch (err) {
    sendPackageInstallError(res, err);
  }
});

router.post("/:id/activate", requireRole("administrator"), async (req, res) => {
  const session = req.session!;
  const providerId = param(req.params.id);

  try {
    await activateCssProvider(session.siteId, providerId);
    auditFromRequest(req, "css_provider.activated", { target: providerId });
    await revalidateOnUpdate("cssProviders");
    res.json({ ok: true });
  } catch (err) {
    sendServerError(res, "css-providers", err);
  }
});

router.delete("/:id", requireRole("administrator"), async (req, res) => {
  const session = req.session!;
  const providerId = param(req.params.id);

  try {
    await deleteCssProvider(session.siteId, providerId);
    await revalidateOnUpdate("cssProviders");
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

/** Public static assets for the active CSS provider (not under /api). */
export const cssProviderAssetsRouter = Router();

cssProviderAssetsRouter.get("/*file", async (req, res) => {
  try {
    const fileParam = req.params.file;
    const relativePath = Array.isArray(fileParam) ? fileParam.join("/") : String(fileParam ?? "");
    if (!relativePath) {
      res.status(400).send("Missing asset path");
      return;
    }

    const filePath = resolveAssetFilePath(relativePath);
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).send("Asset not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    if (ext !== ".css") {
      res.status(403).send("Only CSS assets may be served");
      return;
    }

    const types: Record<string, string> = {
      ".css": "text/css; charset=utf-8",
    };

    res.setHeader("Content-Type", types[ext] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.sendFile(path.resolve(filePath));
  } catch (err) {
    console.error("[justflows] css provider asset failed:", err);
    res.status(500).type("text/plain").send("Internal server error");
  }
});

export default router;
