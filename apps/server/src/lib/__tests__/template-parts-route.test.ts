// SPDX-License-Identifier: MIT

import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory footer template part.
let footer: { doc: unknown; draft: unknown } = { doc: null, draft: null };
const clone = (v: unknown) => (v == null ? null : JSON.parse(JSON.stringify(v)));

vi.mock("../template-parts-db.js", () => ({
  getTemplatePartDoc: async (_s: string, _part: string, opts: { draft?: boolean } = {}) =>
    clone(opts.draft ? footer.draft : footer.doc),
  getTemplatePartDocs: async () => ({ doc: clone(footer.doc), draft: clone(footer.draft) }),
  templatePartHasDraft: async () => footer.draft != null,
  saveTemplatePartDraft: async (_s: string, _p: string, doc: unknown) => {
    footer = { ...footer, draft: clone(doc) };
  },
  saveTemplatePartPublished: async (_s: string, _p: string, doc: unknown) => {
    footer = { ...footer, doc: clone(doc) };
  },
  publishTemplatePartDoc: async (_s: string, _p: string, doc: unknown) => {
    footer = { doc: clone(doc), draft: null };
  },
  clearTemplatePartDraftDoc: async () => {
    footer = { ...footer, draft: null };
  },
}));

let themeFooterBlocks: unknown[] | null = null;
vi.mock("../themes-db.js", () => ({
  getSiteId: async () => "site-1",
  getActiveTheme: async () => ({ theme_id: "justflows.sample", manifest: {} }),
  themeInstalledPath: () => null,
}));
vi.mock("../theme-files.js", () => ({
  loadThemeDemoFooter: () => themeFooterBlocks,
}));
vi.mock("../cache-revalidate.js", () => ({ revalidateOnUpdate: async () => {} }));
vi.mock("../../middleware/auth.js", () => ({
  requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
}));

const { templatePartsRouter } = await import("../../routes/reusable-blocks.js");

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/template-parts", templatePartsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  footer = { doc: null, draft: null };
  themeFooterBlocks = null;
});

describe("GET /api/template-parts/footer", () => {
  it("seeds the editor with the theme's demo/footer.json when nothing is customised", async () => {
    themeFooterBlocks = [{ id: "f1", type: "core.html", version: 1, props: { html: "<p>hi</p>" } }];
    const res = await fetch(`${base}/api/template-parts/footer`);
    const body = (await res.json()) as {
      blocks: unknown[];
      draft: unknown[];
      fromThemeDefault?: boolean;
    };
    expect(body.fromThemeDefault).toBe(true);
    expect(body.blocks).toHaveLength(1);
    expect(body.draft).toEqual([]);
  });

  it("returns the stored footer untouched once one is saved", async () => {
    themeFooterBlocks = [{ id: "f1", type: "core.html", version: 1, props: { html: "<p>x</p>" } }];
    footer = {
      doc: { version: 1, blocks: [{ id: "s1", type: "core.paragraph", version: 1, props: {} }] },
      draft: null,
    };
    const res = await fetch(`${base}/api/template-parts/footer`);
    const body = (await res.json()) as { blocks: { type: string }[]; fromThemeDefault?: boolean };
    expect(body.fromThemeDefault).toBeUndefined();
    expect(body.blocks.map((b) => b.type)).toEqual(["core.paragraph"]);
  });

  it("does not seed when the theme ships no footer", async () => {
    themeFooterBlocks = null;
    const res = await fetch(`${base}/api/template-parts/footer`);
    const body = (await res.json()) as { blocks: unknown[]; fromThemeDefault?: boolean };
    expect(body.fromThemeDefault).toBeUndefined();
    expect(body.blocks).toEqual([]);
  });
});
