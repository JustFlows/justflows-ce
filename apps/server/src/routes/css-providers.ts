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
import { packagesInstalledDir } from "../lib/packages-dir.js";
import multer from "multer";

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
    res.status(500).json({ error: String(err) });
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

    const result = await installer.installFromBuffer(file.buffer, {
      packagesDir,
      source: "upload",
    });

    if (result.manifest.type !== "css-provider") {
      res.status(400).json({
        error: "Uploaded package is not a CSS provider (manifest.type must be 'css-provider')",
      });
      return;
    }

    if (Array.isArray(result.manifest.scripts) && result.manifest.scripts.length > 0) {
      res.status(400).json({ error: "CSS provider packages may not declare scripts" });
      return;
    }

    assertPackageIsTrusted(result.manifest as unknown as Record<string, unknown>, result.digest);

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

    res.json({ provider });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/:id/activate", requireRole("administrator"), async (req, res) => {
  const session = req.session!;
  const providerId = param(req.params.id);

  try {
    await activateCssProvider(session.siteId, providerId);
    await revalidateOnUpdate("cssProviders");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
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
