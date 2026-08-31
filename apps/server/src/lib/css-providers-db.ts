import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";
import { getJfRoot } from "./jf-root.js";
import { runAllMigrations } from "./run-migrations.js";
import { swapCssProviderPackages, getProviderNpmDependencies, cssProvidersInstallDir } from "./css-provider-install.js";
import { getSiteId } from "./themes-db.js";

export interface CssProviderRow {
  id: string;
  site_id: string;
  provider_id: string;
  name: string;
  version: string;
  publisher: string;
  description: string | null;
  status: "installed" | "active" | "inactive" | "error";
  manifest: Record<string, unknown>;
  installed_at: string;
  activated_at: string | null;
  updated_at: string;
}

export interface CssProviderDto {
  id: string;
  provider_id: string;
  name: string;
  version: string;
  description?: string;
  publisher: string;
  status: CssProviderRow["status"];
  active?: boolean;
}

export function cssProvidersDir(): string {
  const rel = process.env.CSS_PROVIDERS_DIR ?? "css-providers";
  return path.isAbsolute(rel) ? rel : path.join(getJfRoot(), rel);
}

export async function ensureCssProvidersTable(): Promise<void> {
  const db = await getDb();
  const driver = process.env.DB_DRIVER as "postgres" | "mysql" | "mariadb";
  await runAllMigrations(db, driver);
}

function now(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

function parseRow(row: CssProviderRow): CssProviderRow {
  return {
    ...row,
    manifest:
      typeof row.manifest === "string"
        ? JSON.parse(row.manifest)
        : row.manifest ?? {},
  };
}

export function providerToDto(row: CssProviderRow): CssProviderDto {
  const manifest = row.manifest ?? {};
  return {
    id: row.provider_id,
    provider_id: row.provider_id,
    name: row.name,
    version: row.version,
    description: row.description ?? undefined,
    publisher: row.publisher,
    status: row.status,
    active: row.status === "active",
  };
}

function readBundledManifest(providerPath: string, folderName: string): Record<string, unknown> | null {
  const manifestPath = path.join(providerPath, "justflows.json");
  if (!fs.existsSync(manifestPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    return {
      ...raw,
      bundledPath: providerPath,
    };
  } catch {
    return null;
  }
}

export async function ensureDefaultCssProvider(siteId: string): Promise<void> {
  const db = await getDb();
  const existing = await db.query<{ id: string }>(
    "SELECT id FROM css_providers WHERE site_id = ? LIMIT 1",
    [siteId],
  );
  if (existing[0]) return;

  const providerId = "justflows.none";
  await db.run(
    `INSERT INTO css_providers
       (id, site_id, provider_id, name, version, publisher, description,
        status, manifest, installed_at, activated_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    [
      randomUUID(),
      siteId,
      providerId,
      "None",
      "1.0.0",
      "Justflows",
      "No external CSS framework — theme styles only",
      JSON.stringify({
        id: providerId,
        type: "css-provider",
        name: "None",
        stylesheets: [],
        scripts: [],
      }),
      now(),
      now(),
      now(),
    ],
  );
}

/** Register bundled CSS providers from css-providers/ when missing from the DB. */
export async function syncBundledCssProviders(siteId: string): Promise<void> {
  const dir = cssProvidersDir();
  if (!fs.existsSync(dir)) return;

  const db = await getDb();
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

    const providerPath = path.join(dir, entry.name);
    const manifest = readBundledManifest(providerPath, entry.name);
    if (!manifest) continue;

    const providerId = String(manifest.id ?? entry.name);
    const existing = await db.query<{ id: string }>(
      "SELECT id FROM css_providers WHERE site_id = ? AND provider_id = ? LIMIT 1",
      [siteId, providerId],
    );
    if (existing[0]) {
      await db.run(
        "UPDATE css_providers SET manifest = ?, name = ?, version = ?, publisher = ?, description = ?, updated_at = ? WHERE site_id = ? AND provider_id = ?",
        [
          JSON.stringify(manifest),
          String(manifest.name ?? entry.name),
          String(manifest.version ?? "1.0.0"),
          String(manifest.publisher ?? "Justflows"),
          typeof manifest.description === "string" ? manifest.description : null,
          now(),
          siteId,
          providerId,
        ],
      );
      continue;
    }

    await db.run(
      `INSERT INTO css_providers
         (id, site_id, provider_id, name, version, publisher, description,
          status, manifest, installed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'installed', ?, ?, ?)`,
      [
        randomUUID(),
        siteId,
        providerId,
        String(manifest.name ?? entry.name),
        String(manifest.version ?? "1.0.0"),
        String(manifest.publisher ?? "Justflows"),
        typeof manifest.description === "string" ? manifest.description : null,
        JSON.stringify(manifest),
        now(),
        now(),
      ],
    );
  }
}

export async function listCssProviders(siteId: string): Promise<CssProviderDto[]> {
  await ensureDefaultCssProvider(siteId);
  await syncBundledCssProviders(siteId);
  const db = await getDb();
  const rows = await db.query<CssProviderRow>(
    "SELECT * FROM css_providers WHERE site_id = ? ORDER BY installed_at DESC",
    [siteId],
  );
  return rows.map((row) => providerToDto(parseRow(row)));
}

export async function getActiveCssProvider(siteId: string): Promise<CssProviderRow | null> {
  await ensureDefaultCssProvider(siteId);
  await syncBundledCssProviders(siteId);
  const db = await getDb();
  const rows = await db.query<CssProviderRow>(
    "SELECT * FROM css_providers WHERE site_id = ? AND status = 'active' LIMIT 1",
    [siteId],
  );
  const provider = rows[0] ? parseRow(rows[0]) : null;
  if (provider) {
    await ensureActiveProviderPackages(provider);
  }
  return provider;
}

async function ensureActiveProviderPackages(provider: CssProviderRow): Promise<void> {
  if (provider.provider_id === "justflows.none") return;

  const deps = getProviderNpmDependencies(provider.manifest);
  if (Object.keys(deps).length === 0) return;

  const nodeModules = path.join(cssProvidersInstallDir(), "node_modules");
  if (fs.existsSync(nodeModules)) return;

  await swapCssProviderPackages(provider.manifest);
}

export async function getCssProviderById(
  siteId: string,
  providerId: string,
): Promise<CssProviderRow | null> {
  const db = await getDb();
  const rows = await db.query<CssProviderRow>(
    "SELECT * FROM css_providers WHERE site_id = ? AND provider_id = ? LIMIT 1",
    [siteId, providerId],
  );
  return rows[0] ? parseRow(rows[0]) : null;
}

export async function insertCssProvider(
  siteId: string,
  provider: {
    providerId: string;
    name: string;
    version: string;
    publisher: string;
    description?: string;
    manifest: Record<string, unknown>;
    status?: CssProviderRow["status"];
  },
): Promise<CssProviderDto> {
  const db = await getDb();
  const id = randomUUID();
  const status = provider.status ?? "installed";

  await db.run(
    `INSERT INTO css_providers
       (id, site_id, provider_id, name, version, publisher, description,
        status, manifest, installed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      siteId,
      provider.providerId,
      provider.name,
      provider.version,
      provider.publisher,
      provider.description ?? null,
      status,
      JSON.stringify(provider.manifest),
      now(),
      now(),
    ],
  );

  return providerToDto(
    parseRow({
      id,
      site_id: siteId,
      provider_id: provider.providerId,
      name: provider.name,
      version: provider.version,
      publisher: provider.publisher,
      description: provider.description ?? null,
      status,
      manifest: provider.manifest,
      installed_at: now(),
      activated_at: null,
      updated_at: now(),
    }),
  );
}

export async function activateCssProvider(siteId: string, providerId: string): Promise<void> {
  const provider = await getCssProviderById(siteId, providerId);
  if (!provider) {
    throw new Error("CSS provider not found");
  }

  await swapCssProviderPackages(provider.manifest);

  const db = await getDb();
  await db.run(
    "UPDATE css_providers SET status = 'inactive', updated_at = ? WHERE site_id = ? AND status = 'active'",
    [now(), siteId],
  );
  await db.run(
    "UPDATE css_providers SET status = 'active', activated_at = ?, updated_at = ? WHERE site_id = ? AND provider_id = ?",
    [now(), now(), siteId, providerId],
  );

  const driver = process.env.DB_DRIVER as "postgres" | "mysql" | "mariadb" | undefined;
  if (driver === "postgres") {
    await db.run(
      `INSERT INTO site_settings (id, site_id, key, value, updated_at)
         VALUES (?, ?, 'active_css_provider', ?, ?)
       ON CONFLICT (site_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      [randomUUID(), siteId, JSON.stringify(providerId), now()],
    );
  } else {
    await db.run(
      `INSERT INTO site_settings (id, site_id, \`key\`, value, updated_at)
         VALUES (?, ?, 'active_css_provider', ?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)`,
      [randomUUID(), siteId, JSON.stringify(providerId), now()],
    );
  }
}

export async function deleteCssProvider(siteId: string, providerId: string): Promise<void> {
  if (providerId === "justflows.none") {
    throw new Error("The default CSS provider cannot be deleted");
  }

  const active = await getActiveCssProvider(siteId);
  if (active?.provider_id === providerId) {
    await activateCssProvider(siteId, "justflows.none");
  }

  const db = await getDb();
  await db.run("DELETE FROM css_providers WHERE site_id = ? AND provider_id = ?", [siteId, providerId]);
}

export async function getCssProvidersSiteId(): Promise<string | null> {
  await ensureCssProvidersTable();
  return getSiteId();
}

export function getProviderInstallPath(manifest: Record<string, unknown>): string | null {
  const installedPath = manifest.installedPath;
  if (typeof installedPath === "string" && installedPath) return installedPath;
  const bundledPath = manifest.bundledPath;
  if (typeof bundledPath === "string" && bundledPath) return bundledPath;
  return null;
}
