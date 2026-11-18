// SPDX-License-Identifier: MIT
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAccessibility } from "@justflows/blocks";

/**
 * Accessibility checks in the management API (justflows-ce#313): the same
 * issues as the builder for the same document, behind the same read check as
 * the document.
 */

process.env.APP_SECRET = "test-secret-that-is-at-least-32-characters-long";
process.env.DB_DRIVER = "postgres";

const BLOCKS = [
  { id: "h", type: "core.heading", version: 1, props: { text: "Intro", level: 4 } },
  { id: "img", type: "core.image", version: 1, props: { src: "/uploads/a.png", alt: "" } },
  { id: "btn", type: "core.button", version: 1, props: { label: "", url: "/contact" } },
  { id: "gal", type: "acme.gallery", version: 1, props: { title: "Secret draft caption" } },
];

const state = vi.hoisted(() => ({ allow: true, footerDraft: [] as unknown[], footer: [] as unknown[], rowBlocks: "[]" }));

vi.mock("../../../../src/lib/auth/api-keys.js", () => ({
  keyCan: async () => state.allow,
}));
vi.mock("../../../../src/lib/database/db.js", () => ({
  getDb: async () => ({
    query: async () => [{ id: "c1", type: "page", title: "Home", slug: "home", locale: "en", status: "published", version: 3, author_id: "u2", blocks: state.rowBlocks }],
    run: async () => undefined,
  }),
}));
vi.mock("../../../../src/lib/auth/access-policy.js", () => ({
  getEffectiveAccess: async () => ({ roleId: "administrator", capabilities: [], policy: { scopes: {} } }),
}));
vi.mock("../../../../src/lib/rendering/template-parts.js", async (original) => ({
  ...(await original<typeof import("../../../../src/lib/rendering/template-parts.js")>()),
  getTemplatePart: async (_site: string, _part: string, draft: boolean) => (draft ? state.footerDraft : state.footer),
}));

const content = (await import("../../../../src/routes/manage-api/content.js")).default;
const design = (await import("../../../../src/routes/manage-api/design.js")).default;

let server: Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.apiKey = { id: "key-1", scope: {}, allowedIps: [], allowedOrigins: [] } as never;
    req.apiKeyOwner = { userId: "u1", siteId: "s1", role: "administrator" };
    next();
  });
  app.use("/api/manage/v1/content", content);
  app.use("/api/manage/v1", design);
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/manage/v1`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  state.allow = true;
  state.rowBlocks = JSON.stringify({ version: 1, blocks: BLOCKS });
  state.footer = [];
  state.footerDraft = [];
});

type Report = { issues: Array<{ code: string; severity: string; blockId: string; blockType: string; field?: string; message: string }>; counts: Record<string, number>; note: string; version?: string };

describe("GET /content/:id/accessibility", () => {
  it("returns the builder's issues for the entry, with messages and the disclaimer", async () => {
    const res = await fetch(`${base}/content/c1/accessibility`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Report;
    const builder = checkAccessibility(BLOCKS, { isOpaqueType: (type) => !type.startsWith("core.") });
    expect(body.issues.map((i) => `${i.code}:${i.blockId}:${i.severity}`).sort()).toEqual(builder.map((i) => `${i.code}:${i.blockId}:${i.severity}`).sort());
    expect(body.issues[0]?.severity).toBe("error");
    expect(body.counts).toEqual({ error: 1, warning: 2, unavailable: 1 });
    expect(body.issues.find((i) => i.code === "heading-skip")?.message).toBe("Heading level jumps from 1 to 4. Skipped levels make the page outline hard to follow.");
    expect(body.issues.find((i) => i.code === "image-alt")).toMatchObject({ blockType: "core.image", field: "alt" });
    expect(body.note).toMatch(/don't prove a page is accessible/);
  });

  it("reports plugin blocks as not checked, without their content", async () => {
    const text = await (await fetch(`${base}/content/c1/accessibility`)).text();
    expect(JSON.parse(text).issues).toContainEqual(expect.objectContaining({ code: "content-unchecked", severity: "unavailable", blockType: "acme.gallery" }));
    expect(text).not.toContain("Secret draft caption");
  });

  it("words the messages in another admin language on request", async () => {
    const body = (await (await fetch(`${base}/content/c1/accessibility?lang=nl`)).json()) as Report;
    const english = (await (await fetch(`${base}/content/c1/accessibility`)).json()) as Report;
    expect(body.issues.find((i) => i.code === "image-alt")?.message).not.toBe(english.issues.find((i) => i.code === "image-alt")?.message);
  });

  it("returns nothing for an entry the key cannot read", async () => {
    state.allow = false;
    const res = await fetch(`${base}/content/c1/accessibility`);
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).not.toMatch(/image-alt|issues/);
  });
});

describe("GET /template-parts/:part/accessibility", () => {
  it("checks the draft when there is one, else what is published", async () => {
    state.footer = [BLOCKS[1]];
    state.footerDraft = [BLOCKS[2]];
    const draft = (await (await fetch(`${base}/template-parts/footer/accessibility`)).json()) as Report;
    expect(draft.version).toBe("draft");
    expect(draft.issues.map((i) => i.blockId)).toEqual(["btn"]);
    const published = (await (await fetch(`${base}/template-parts/footer/accessibility?version=published`)).json()) as Report;
    expect(published.version).toBe("published");
    expect(published.issues.map((i) => i.blockId)).toEqual(["img"]);
  });

  it("needs content:read and a known part", async () => {
    expect((await fetch(`${base}/template-parts/sidebar/accessibility`)).status).toBe(404);
    state.allow = false;
    expect((await fetch(`${base}/template-parts/footer/accessibility`)).status).toBe(403);
  });
});

describe("GET /templates/:slug/accessibility", () => {
  it("refuses an unknown template and a key without content:read", async () => {
    expect((await fetch(`${base}/templates/Not%20a%20slug!/accessibility`)).status).toBe(404);
    state.allow = false;
    expect((await fetch(`${base}/templates/page/accessibility`)).status).toBe(403);
  });
});
