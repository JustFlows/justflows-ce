// SPDX-License-Identifier: MIT
import { describe, expect, it, vi, beforeEach } from "vitest";
import { PluginHttpRouter } from "@justflows/plugin-api";
import type { PluginHttpRequest } from "@justflows/sdk";

const state = vi.hoisted(() => ({
  capabilities: [] as string[],
  router: null as unknown,
}));
vi.mock("../../../src/lib/auth/access-policy.js", () => ({
  availableCapabilityDefinitions: async () => [
    { id: "content:read", pluginId: null },
    { id: "users:manage", pluginId: null },
    { id: "products:read", pluginId: "acme.shop" },
    { id: "products:update", pluginId: "acme.shop" },
  ],
  getEffectiveAccess: async () => ({ roleId: "administrator", roles: ["administrator"], capabilities: state.capabilities, policy: { scopes: {} } }),
}));
vi.mock("../../../src/lib/plugins/plugin-runtime.js", () => ({
  getPluginLoader: () => ({ httpRouter: state.router }),
  getRuntimeHooks: () => ({ has: () => false, applyFilter: async (_name: string, value: unknown) => value }),
}));
vi.mock("../../../src/lib/i18n/languages-db.js", () => ({ getDefaultLocale: async () => "en" }));
vi.mock("../../../src/lib/ai/tools/dispatch.js", () => ({ dispatchManageApi: vi.fn() }));
const audit = vi.hoisted(() => vi.fn(async (_entry: { action: string; detail?: string }) => {}));
vi.mock("../../../src/lib/security/audit-log.js", () => ({ auditLog: audit }));

const { callTool, toolsForPrincipal } = await import("../../../src/lib/ai/tools/registry.js");
const { syntheticKey } = await import("../../../src/lib/ai/tools/principal.js");
const { currentDelegate } = await import("../../../src/lib/security/delegated-call.js");
import type { AgentPrincipal } from "../../../src/lib/ai/tools/principal.js";

function principal(keyCapabilities: string[]): AgentPrincipal {
  const owner = { userId: "u1", siteId: "s1", role: "administrator" };
  return {
    kind: "api-key",
    id: "key-1",
    clientName: "Claude",
    key: syntheticKey({ id: "key-1", name: "Claude", owner, capabilities: keyCapabilities }),
    owner,
    userTools: false,
    via: "mcp",
  };
}

const seen: PluginHttpRequest[] = [];
const delegates: Array<string | undefined> = [];

beforeEach(() => {
  seen.length = 0;
  delegates.length = 0;
  audit.mockClear();
  state.capabilities = ["content:read", "site:admin", "users:manage", "products:read", "products:update"];
  const router = new PluginHttpRouter();
  router.register("acme.shop", "GET", "products", async (req) => {
    seen.push(req);
    delegates.push(currentDelegate()?.kind);
    return { body: { products: [], q: req.query["search"] ?? null } };
  }, {
    mcp: { name: "acme_products_list", description: "List products.", capability: "products:read", inputSchema: { type: "object", properties: { search: { type: "string" } } } },
  });
  router.register("acme.shop", "PUT", "products/:id", async (req) => {
    seen.push(req);
    if (!req.session?.capabilities.includes("products:update")) return { status: 403, body: { error: "Forbidden" } };
    if (req.body && (req.body as { price?: unknown }).price === "bad") return { status: 400, body: { error: { code: "invalid_request", message: "Enter a valid price." } } };
    return { body: { id: req.params["id"], saved: req.body } };
  }, {
    mcp: { name: "acme_products_save", description: "Save a product.", capability: "products:update", inputSchema: { type: "object", properties: { price: { type: "string" } } } },
  });
  // Not offered to agents: no `mcp` option.
  router.register("acme.shop", "DELETE", "products/:id", async () => ({ body: { ok: true } }));
  state.router = router;
});

describe("plugin routes offered as MCP tools", () => {
  it("lists only routes that opted in, with path parameters as required arguments", async () => {
    const tools = (await toolsForPrincipal(principal(["content:read", "site:admin"]))).filter((tool) => tool.group === "plugin");
    expect(tools.map((tool) => tool.name).sort()).toEqual(["acme_products_list", "acme_products_save"]);
    const save = tools.find((tool) => tool.name === "acme_products_save")!;
    expect(save.inputSchema.required).toEqual(["id"]);
    expect(save.annotations.readOnlyHint).toBe(false);
    expect(tools.find((tool) => tool.name === "acme_products_list")!.annotations.readOnlyHint).toBe(true);
  });

  it("runs the route's own handler with the agent's session, params, query and body", async () => {
    const p = principal(["content:read", "site:admin"]);
    const list = await callTool(p, "acme_products_list", { search: "tee" });
    expect(list.outcome).toEqual({ ok: true, data: { products: [], q: "tee" } });
    const save = await callTool(p, "acme_products_save", { id: "p 1", price: "9" });
    expect(save.outcome).toEqual({ ok: true, data: { id: "p 1", saved: { price: "9" } } });
    expect(seen[1]).toMatchObject({ method: "PUT", path: "/ext/acme.shop/products/p%201", params: { id: "p 1" } });
    expect(seen[1]!.session).toMatchObject({ userId: "u1", role: "api-key" });
    expect(seen[1]!.session!.capabilities).toEqual(["content:read", "site:admin", "products:read", "products:update"]);
    expect(audit.mock.calls.map(([entry]) => entry.detail)).toEqual([expect.stringContaining("tool=acme_products_save")]);
  });

  it("runs plugin code as delegated work, so platform operations refuse", async () => {
    await callTool(principal(["site:admin"]), "acme_products_list", {});
    expect(delegates).toEqual(["mcp"]);
  });

  it("hides plugin tools from a key without site:admin or the capability itself", async () => {
    const p = principal(["content:read"]);
    expect((await toolsForPrincipal(p)).some((tool) => tool.group === "plugin")).toBe(false);
    expect((await callTool(p, "acme_products_save", { id: "x" })).outcome).toMatchObject({ ok: false, status: 403 });
    expect(seen).toHaveLength(0);
  });

  it("lets a key that ticked one plugin capability use only that tool", async () => {
    const tools = await toolsForPrincipal(principal(["products:read"]));
    expect(tools.filter((tool) => tool.group === "plugin").map((tool) => tool.name)).toEqual(["acme_products_list"]);
  });

  it("never gives the agent more than the owner has now", async () => {
    state.capabilities = ["content:read", "site:admin", "products:read"];
    const tools = await toolsForPrincipal(principal(["content:read", "site:admin"]));
    expect(tools.filter((tool) => tool.group === "plugin").map((tool) => tool.name)).toEqual(["acme_products_list"]);
  });

  it("passes structured plugin errors to the model as their message", async () => {
    const result = await callTool(principal(["site:admin"]), "acme_products_save", { id: "x", price: "bad" });
    expect(result.outcome).toEqual({ ok: false, status: 400, error: "Enter a valid price." });
  });

  it("drops a plugin's tools when its routes are removed", async () => {
    (state.router as PluginHttpRouter).removePlugin("acme.shop");
    expect((await toolsForPrincipal(principal(["site:admin"]))).some((tool) => tool.group === "plugin")).toBe(false);
  });
});

describe("mcp route option", () => {
  const ok = { name: "acme_x", description: "Do x.", capability: "products:read" };
  it.each([
    ["a bad name", { ...ok, name: "Acme-X" }],
    ["no description", { ...ok, description: " " }],
    ["no capability", { ...ok, capability: "" }],
    ["a schema that is not an object", { ...ok, inputSchema: { type: "array" } }],
  ])("refuses %s", (_name, mcp) => {
    expect(() => new PluginHttpRouter().register("acme.shop", "GET", "x", async () => ({}), { mcp })).toThrow();
  });

  it("refuses a tool name another route already uses", () => {
    const router = new PluginHttpRouter();
    router.register("acme.shop", "GET", "x", async () => ({}), { mcp: ok });
    expect(() => router.register("other.plugin", "GET", "y", async () => ({}), { mcp: ok })).toThrow(/already used/);
  });

  it("refuses an upload route", () => {
    expect(() => new PluginHttpRouter().register("acme.shop", "POST", "x", async () => ({}), { mcp: ok, binaryBody: { maxBytes: 10 } })).toThrow();
  });
});

describe("plugin API site boundary", () => {
  it.each([{ siteId: "s2" }, { site_id: "s2" }, { data: { tenantId: "t2" } }])("refuses a foreign target before plugin code runs: %j", async (args) => {
    const result = await callTool(principal(["site:admin"]), "acme_products_list", args);
    expect(result.outcome).toMatchObject({ ok: false, status: 403 });
    expect(seen).toHaveLength(0);
  });
  it("filters credentials returned by a plugin API handler", async () => {
    (state.router as PluginHttpRouter).register("acme.shop", "GET", "private", async () => ({ body: { nested: { apiKey: "do-not-return" } } }), { mcp: { name: "acme_private", description: "Test private output.", capability: "products:read" } });
    expect(JSON.stringify(await callTool(principal(["site:admin"]), "acme_private", {}))).not.toContain("do-not-return");
  });
});
