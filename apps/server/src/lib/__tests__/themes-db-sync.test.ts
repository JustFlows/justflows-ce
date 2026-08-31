import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.DB_DRIVER = "postgres";

// A temp themes/ folder with two bundled theme packages plus noise that must be
// ignored (a dotfile dir, and a dir with no manifest).
const themesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "jf-themes-"));
fs.mkdirSync(path.join(themesRoot, "default"));
fs.writeFileSync(
  path.join(themesRoot, "default", "justflows-theme.json"),
  JSON.stringify({ id: "justflows.default", name: "Default", version: "2.0.0" }),
);
fs.mkdirSync(path.join(themesRoot, "sample"));
fs.writeFileSync(
  path.join(themesRoot, "sample", "justflows-theme.json"),
  JSON.stringify({
    id: "justflows.sample",
    name: "Sample",
    version: "1.0.0",
    author: "Justflows Team",
    description: "Sample theme",
    cssVariables: { "--color-primary": "#ff0080", "--bad": 5 },
  }),
);
fs.mkdirSync(path.join(themesRoot, ".git"));
fs.mkdirSync(path.join(themesRoot, "not-a-theme"));

afterAll(() => fs.rmSync(themesRoot, { recursive: true, force: true }));

vi.mock("../theme-files.js", () => ({ themesDir: () => themesRoot }));

// In-memory themes table keyed by (site_id, theme_id).
interface Row {
  id: string;
  site_id: string;
  theme_id: string;
  name: string;
  version: string;
  publisher: string;
  description: string | null;
  status: string;
  css_variables: string;
  manifest: string;
}
const table = new Map<string, Row>();
const rowKey = (site: unknown, themeId: unknown) => `${site}::${themeId}`;

vi.mock("../db.js", () => ({
  getDb: async () => ({
    async query(sql: string, params: unknown[] = []) {
      if (/SELECT id.* FROM themes WHERE site_id = \? AND theme_id = \?/i.test(sql)) {
        const row = table.get(rowKey(params[0], params[1]));
        return row
          ? [{ id: row.id, name: row.name, version: row.version, manifest: row.manifest }]
          : [];
      }
      if (/SELECT id FROM themes WHERE site_id = \? LIMIT 1/i.test(sql)) {
        const first = [...table.values()].find((r) => r.site_id === params[0]);
        return first ? [{ id: first.id }] : [];
      }
      return [];
    },
    async run(sql: string, params: unknown[] = []) {
      if (/^\s*UPDATE themes/i.test(sql)) {
        // params: [name, version, publisher, description, manifest, updatedAt, site, themeId]
        const [name, version, publisher, description, manifest, , site, themeId] =
          params as string[];
        const key = rowKey(site, themeId);
        const prev = table.get(key);
        if (prev) {
          table.set(key, {
            ...prev,
            name,
            version,
            publisher,
            description: description ?? null,
            manifest,
          });
        }
        return;
      }
      if (!/INSERT INTO themes/i.test(sql)) return;
      const [id, site, themeId, name, version, publisher, description, cssVars, manifest] =
        params as string[];
      table.set(rowKey(site, themeId), {
        id,
        site_id: site,
        theme_id: themeId,
        name,
        version,
        publisher,
        description: description ?? null,
        status: "installed",
        css_variables: cssVars,
        manifest,
      });
    },
  }),
}));

const { syncBundledThemes } = await import("../themes-db.js");

const SITE = "site-1";
beforeEach(() => table.clear());

describe("syncBundledThemes", () => {
  it("registers every bundled theme package that isn't in the DB yet", async () => {
    await syncBundledThemes(SITE);

    expect([...table.keys()].sort()).toEqual([
      "site-1::justflows.default",
      "site-1::justflows.sample",
    ]);

    const sample = table.get(rowKey(SITE, "justflows.sample"))!;
    expect(sample.name).toBe("Sample");
    expect(sample.version).toBe("1.0.0");
    expect(sample.status).toBe("installed");
    // publisher falls back to manifest.author, then "Justflows"
    expect(sample.publisher).toBe("Justflows Team");
    expect(sample.description).toBe("Sample theme");
    // only string css vars are kept
    expect(JSON.parse(sample.css_variables)).toEqual({ "--color-primary": "#ff0080" });
    // manifest is stored with a bundledPath pointer
    expect(JSON.parse(sample.manifest).bundledPath).toBe(path.join(themesRoot, "sample"));
  });

  it("refreshes an existing row's metadata from the folder but preserves its state", async () => {
    table.set(rowKey(SITE, "justflows.default"), {
      id: "existing",
      site_id: SITE,
      theme_id: "justflows.default",
      name: "Default",
      version: "1.0.0",
      publisher: "Justflows",
      description: "The official Justflows starter theme",
      status: "active",
      css_variables: '{"--color-primary":"#2563eb"}',
      manifest: "{}",
    });

    await syncBundledThemes(SITE);

    const def = table.get(rowKey(SITE, "justflows.default"))!;
    // admin-owned state stays
    expect(def.id).toBe("existing");
    expect(def.status).toBe("active");
    expect(def.css_variables).toBe('{"--color-primary":"#2563eb"}');
    // folder metadata (incl. a new manifest customize block) flows through
    expect(def.version).toBe("2.0.0");
    expect(JSON.parse(def.manifest).bundledPath).toBe(path.join(themesRoot, "default"));
  });
});
