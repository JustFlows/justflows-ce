// SPDX-License-Identifier: MIT

import { getDb } from "./db.js";
import { getSiteSetting, setSiteSetting } from "./site-settings.js";
import { revalidateOnUpdate } from "./cache-revalidate.js";
import {
  DEFAULT_PAGE_HEADER,
  NO_HEADER_REF,
  PAGE_HEADER_FIELD,
  PAGE_HEADER_REF_FIELD,
  parsePageHeader,
  type PageHeaderConfig,
} from "./page-header.js";
import {
  getSiteHeaderLibrary,
  publishSiteHeaderLibrary,
  type SiteHeaderEntry,
  type SiteHeaderLibrary,
} from "./site-header.js";

/**
 * One-time conversion of per-page headers (`fields.jfHeader`) into the site
 * header library. Runs at boot, guarded by a flag so it happens exactly once.
 *
 * There is no schema change to hang a SQL migration on, and portable JSON
 * dedup / UUID / deep-equality across postgres+mysql+mariadb in raw SQL is
 * impractical — hence a JS backfill.
 *
 * Safety: a page only gets a `jfHeaderRef` when its parsed header actually
 * differs from the built-in default; the legacy `jfHeader` value is left in
 * place for one release (the renderer ignores it); each row is handled in its
 * own try/catch; the flag is only set after a clean pass, so a failed run
 * retries rather than half-applying.
 */

const MIGRATED_FLAG = "site_header_migrated";

/** Deterministic — `parsePageHeader` always emits keys in `DEFAULT_PAGE_HEADER` order. */
function headerFingerprint(header: PageHeaderConfig): string {
  return JSON.stringify(header);
}

const DEFAULT_FINGERPRINT = headerFingerprint(parsePageHeader(undefined));

function seedDefaultEntry(): SiteHeaderEntry {
  return {
    id: crypto.randomUUID(),
    name: "Site header",
    base: { ...DEFAULT_PAGE_HEADER, blocks: [] },
    overrides: {},
    updatedAt: new Date().toISOString(),
  };
}

function parseFields(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* fall through */
    }
  }
  return {};
}

export async function backfillSiteHeaderLibrary(siteId: string): Promise<void> {
  if (await getSiteSetting<unknown>(siteId, MIGRATED_FLAG)) return;

  const existing = await getSiteHeaderLibrary(siteId, false);
  if (existing.entries.length > 0 && existing.defaultId) {
    await setSiteSetting(siteId, MIGRATED_FLAG, true);
    return;
  }

  const db = await getDb();
  const defaultEntry = seedDefaultEntry();
  const library: SiteHeaderLibrary = {
    version: 1,
    defaultId: defaultEntry.id,
    entries: [defaultEntry],
  };

  // fingerprint -> entry id, so identical custom headers collapse to one entry.
  const byFingerprint = new Map<string, string>([[DEFAULT_FINGERPRINT, defaultEntry.id]]);
  let converted = 0;
  let customEntries = 0;

  const rows = await db.query<{ id: string; title: string | null; fields: unknown }>(
    "SELECT id, title, fields FROM content",
  );

  for (const row of rows) {
    try {
      const fields = parseFields(row.fields);
      if (!(PAGE_HEADER_FIELD in fields)) continue;
      if (typeof fields[PAGE_HEADER_REF_FIELD] === "string" && fields[PAGE_HEADER_REF_FIELD]) continue;

      const header = parsePageHeader(fields[PAGE_HEADER_FIELD]);
      const fingerprint = headerFingerprint(header);
      if (fingerprint === DEFAULT_FINGERPRINT) continue; // follows the site default already

      // A page that hid its header maps to "no header", not a hidden library entry.
      if (!header.visible) {
        await db.run("UPDATE content SET fields = ? WHERE id = ?", [
          JSON.stringify({ ...fields, [PAGE_HEADER_REF_FIELD]: NO_HEADER_REF }),
          row.id,
        ]);
        converted += 1;
        continue;
      }

      let entryId = byFingerprint.get(fingerprint);
      if (!entryId) {
        customEntries += 1;
        const name =
          customEntries === 1 && row.title?.trim()
            ? `${row.title.trim()} header`.slice(0, 120)
            : `Header ${customEntries}`;
        const entry: SiteHeaderEntry = {
          id: crypto.randomUUID(),
          name,
          base: header,
          overrides: {},
          updatedAt: new Date().toISOString(),
        };
        library.entries.push(entry);
        entryId = entry.id;
        byFingerprint.set(fingerprint, entryId);
      }

      const nextFields = { ...fields, [PAGE_HEADER_REF_FIELD]: entryId };
      await db.run("UPDATE content SET fields = ? WHERE id = ?", [
        JSON.stringify(nextFields),
        row.id,
      ]);
      converted += 1;
    } catch (err) {
      console.error(`[justflows] header backfill: skipped content ${row.id}:`, err);
    }
  }

  await publishSiteHeaderLibrary(siteId, library);
  await setSiteSetting(siteId, MIGRATED_FLAG, true);
  if (converted > 0) await revalidateOnUpdate("content");
  console.log(
    `[justflows] header library backfill: ${library.entries.length} header(s), ${converted} page(s) linked.`,
  );
}
