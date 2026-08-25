import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { Request, Response } from "express";
import { getJfRoot } from "../jf-root.js";
import { param } from "../params.js";
import { ADMIN_UI_LOCALES } from "./locales.js";
import { flattenCatalog, type MessageCatalog } from "./translate.js";

/** Resolve admin UI JSON catalogs (works with bundle + unbundled dist). */
export function adminCatalogDir(): string {
  const candidates = [
    path.join(getJfRoot(), "apps/server/dist/lib/i18n/admin-catalogs"),
    path.join(getJfRoot(), "apps/server/src/lib/i18n/admin-catalogs"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "en.json"))) return dir;
  }
  return candidates[0]!;
}

export async function loadAdminCatalog(locale: string): Promise<MessageCatalog> {
  const allowed = ADMIN_UI_LOCALES as readonly string[];
  const code = allowed.includes(locale) ? locale : "en";
  const dir = adminCatalogDir();

  async function readCode(target: string): Promise<MessageCatalog> {
    const raw = await fsp.readFile(path.join(dir, `${target}.json`), "utf-8");
    return flattenCatalog(JSON.parse(raw) as Record<string, unknown>);
  }

  try {
    return await readCode(code);
  } catch {
    return readCode("en");
  }
}

/** GET /api/i18n/:locale — admin UI translation bundle. */
export async function serveAdminI18n(req: Request, res: Response): Promise<void> {
  const locale = param(req.params.locale).split("-")[0] ?? "en";
  const allowed = ADMIN_UI_LOCALES as readonly string[];
  const code = allowed.includes(locale) ? locale : "en";

  try {
    const messages = await loadAdminCatalog(code);
    res.json({ locale: code, messages });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}
