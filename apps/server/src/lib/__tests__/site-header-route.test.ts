import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const parts = new Map<string, { doc: unknown; draft: unknown }>();
const revalidated: string[] = [];
let role = "administrator";

const clone = (v: unknown) => (v == null ? null : JSON.parse(JSON.stringify(v)));
const rowFor = (part: string) => parts.get(part) ?? { doc: null, draft: null };

vi.mock("../template-parts-db.js", () => ({
  getTemplatePartDoc: async (_s: string, part: string, opts: { draft?: boolean } = {}) =>
    clone(opts.draft ? rowFor(part).draft : rowFor(part).doc),
  getTemplatePartDocs: async (_s: string, part: string) => ({
    doc: clone(rowFor(part).doc),
    draft: clone(rowFor(part).draft),
  }),
  templatePartHasDraft: async (_s: string, part: string) => rowFor(part).draft != null,
  saveTemplatePartDraft: async (_s: string, part: string, doc: unknown) => {
    parts.set(part, { ...rowFor(part), draft: clone(doc) });
  },
  saveTemplatePartPublished: async (_s: string, part: string, doc: unknown) => {
    parts.set(part, { ...rowFor(part), doc: clone(doc) });
  },
  publishTemplatePartDoc: async (_s: string, part: string, doc: unknown) => {
    parts.set(part, { doc: clone(doc), draft: null });
  },
  clearTemplatePartDraftDoc: async (_s: string, part: string) => {
    parts.set(part, { ...rowFor(part), draft: null });
  },
  seedTemplatePartRow: async (_s: string, part: string, doc: unknown, draft: unknown) => {
    parts.set(part, { doc: clone(doc), draft: clone(draft) });
  },
}));
vi.mock("../themes-db.js", () => ({ getSiteId: async () => "site-1" }));
vi.mock("../cache-revalidate.js", () => ({
  revalidateOnUpdate: async (kind: string) => {
    revalidated.push(kind);
  },
}));
vi.mock("../i18n/languages-db.js", () => ({
  getActiveLocaleCodes: async () => ["en-US", "nl-NL"],
  getDefaultLocale: async () => "en-US",
}));
vi.mock("../header-templates.js", () => ({
  listHeaderTemplates: async () => [
    { id: "acme.demo:hero", name: "Hero header", source: "acme.demo" },
  ],
}));
vi.mock("../../middleware/auth.js", () => ({
  requireRole: (...roles: string[]) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (roles.includes(role)) return next();
    res.status(403).json({ error: "forbidden" });
  },
}));

const { default: siteHeaderRoutes } = await import("../../routes/site-header.js");

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/headers", siteHeaderRoutes);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(() => r(null))));
beforeEach(() => {
  parts.clear();
  revalidated.length = 0;
  role = "administrator";
});

const entry = { id: "h1", name: "Main", base: {}, overrides: { "fr-FR": { sticky: false } } };

async function req(method: string, path: string, body?: unknown) {
  const res = await fetch(base + "/api/headers" + path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

describe("/api/headers", () => {
  it("PUT draft saves without publishing or revalidating", async () => {
    const r = await req("PUT", "/", { library: { defaultId: "h1", entries: [entry] }, draft: true });
    expect(r.status).toBe(200);
    expect(rowFor("header").draft).not.toBeNull();
    expect(rowFor("header").doc).toBeNull();
    expect(revalidated).toEqual([]);
  });

  it("PUT publish writes the published copy, drops inactive locale overrides, and revalidates", async () => {
    const r = await req("PUT", "/", { library: { defaultId: "h1", entries: [entry] }, draft: false });
    expect(r.status).toBe(200);
    expect(rowFor("header").doc).not.toBeNull();
    expect(revalidated).toEqual(["theme"]);
    const stored = rowFor("header").doc as { entries: { overrides: object }[] };
    expect(stored.entries[0]!.overrides).toEqual({}); // fr-FR is not an active locale
  });

  it("GET / returns published + draft", async () => {
    await req("PUT", "/", { library: { defaultId: "h1", entries: [entry] }, draft: false });
    const r = await req("GET", "/");
    expect(r.status).toBe(200);
    expect((r.body.library as { entries: unknown[] }).entries).toHaveLength(1);
    expect(r.body.draft).toBeNull();
  });

  it("GET /options lists entries with the default flag", async () => {
    await req("PUT", "/", {
      library: { defaultId: "h1", entries: [entry, { id: "h2", name: "Alt", base: {}, overrides: {} }] },
      draft: false,
    });
    const r = await req("GET", "/options");
    expect(r.body).toEqual({
      defaultId: "h1",
      items: [
        { id: "h1", name: "Main", isDefault: true },
        { id: "h2", name: "Alt", isDefault: false },
      ],
      templates: [{ id: "acme.demo:hero", name: "Hero header", source: "acme.demo" }],
    });
  });

  it("rejects writes from a read-only role", async () => {
    role = "author";
    expect((await req("PUT", "/", { library: {}, draft: true })).status).toBe(403);
    expect((await req("GET", "/options")).status).toBe(200); // reads stay open to content roles
  });
});
