// SPDX-License-Identifier: MIT

import type { PluginHttpRequest, PluginHttpResponse, PluginHttpSession } from "@justflows/sdk";
import type { RegisteredPluginRoute } from "@justflows/plugin-api";
import { getEffectiveAccess } from "../../auth/access-policy.js";
import { keyHolds, pluginCapabilityIds } from "../../auth/api-keys.js";
import { getPluginLoader } from "../../plugins/plugin-runtime.js";
import { pluginActiveForRequest, pluginRouteRateBucket } from "../../plugins/plugin-http.js";
import { consumeRateLimit } from "../../security/rate-limit.js";
import { outcomeOf, READ, type AgentTool, type JsonSchemaObject, type ToolOutcome } from "./manage-tool.js";
import type { AgentPrincipal } from "./principal.js";

/**
 * Plugin routes offered to agents with the `mcp` route option.
 *
 * Each opted-in route becomes one tool. Calling it runs the route's own
 * handler in-process with the agent's session, so the plugin's checks,
 * validation and side effects are the ones its admin pages and API already
 * use; there is no second implementation to drift. The host adds what the
 * HTTP dispatcher would: the plugin must be active on the site, the session
 * must hold the tool's capability, and the route's rate limit applies (per
 * agent instead of per IP).
 */

const PATH_PARAM = /:([A-Za-z0-9_]+)/g;

function pathParams(path: string): string[] {
  return [...path.matchAll(PATH_PARAM)].map((match) => match[1]!);
}

function inputSchemaFor(route: RegisteredPluginRoute): JsonSchemaObject {
  const declared = route.mcp?.inputSchema as JsonSchemaObject | undefined;
  const params = pathParams(route.path);
  const properties: Record<string, unknown> = { ...(declared?.properties ?? {}) };
  for (const name of params) {
    properties[name] ??= { type: "string", description: `The ${name} in the route path.` };
  }
  const required = [...new Set([...params, ...(declared?.required ?? [])])];
  return {
    ...(declared ?? {}),
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
  };
}

/** The session a plugin handler sees for this agent: what it may do right now. */
async function sessionFor(principal: AgentPrincipal): Promise<PluginHttpSession> {
  const { owner } = principal;
  const [access, plugin] = await Promise.all([getEffectiveAccess(owner.userId, owner.siteId, owner.role), pluginCapabilityIds()]);
  const role = principal.kind === "assistant" ? owner.role : "api-key";
  return {
    userId: owner.userId,
    siteId: owner.siteId,
    role,
    roles: principal.kind === "assistant" ? access.roles : [role],
    email: "",
    capabilities: access.capabilities.filter((capability) => keyHolds(principal.key, capability, plugin)),
    scopes: access.policy.scopes ?? {},
  };
}

function messageOf(body: unknown): unknown {
  // Structured plugin errors: { error: { code, message } }.
  const error = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return { error: (error as { message: string }).message };
  }
  return body;
}

function outcomeOfResponse(response: PluginHttpResponse): ToolOutcome {
  const status = response.status ?? 200;
  if (response.file || Buffer.isBuffer(response.body)) {
    return status < 400
      ? { ok: true, data: { ok: true, note: "This tool answers with a file, which is not passed to agents." } }
      : outcomeOf(status, null);
  }
  let body: unknown = response.body;
  if (typeof response.body === "string") {
    try {
      body = JSON.parse(response.body);
    } catch {
      body = response.body.slice(0, 2_000);
    }
  }
  return outcomeOf(status, status >= 400 ? messageOf(body) : body);
}

export function routeTool(route: RegisteredPluginRoute): AgentTool | null {
  const tool = route.mcp;
  if (!tool) return null;
  const params = pathParams(route.path);
  const readOnly = tool.annotations?.readOnlyHint ?? route.method === "GET";
  return {
    name: tool.name,
    title: tool.title ?? tool.name,
    description: tool.description,
    inputSchema: inputSchemaFor(route),
    annotations: readOnly
      ? READ
      : {
          readOnlyHint: false,
          destructiveHint: tool.annotations?.destructiveHint ?? route.method === "DELETE",
          idempotentHint: tool.annotations?.idempotentHint ?? (route.method === "PUT" || route.method === "DELETE"),
        },
    group: "plugin",
    capabilities: [tool.capability],
    targetArg: params[0],
    async run(args, ctx): Promise<ToolOutcome> {
      if (!pluginActiveForRequest(route.pluginId)) return { ok: false, status: 404, error: "Not found: this plugin is not active here." };
      const session = await sessionFor(ctx.principal);
      if (!session.capabilities.includes(tool.capability)) {
        return { ok: false, status: 403, error: "Forbidden: this session is not allowed to do that." };
      }
      const ceiling = pluginRouteRateBucket(route);
      if (ceiling && !consumeRateLimit(`${ceiling.bucket}:agent:${ctx.principal.id}`, ceiling.limit, ceiling.windowMs)) {
        return { ok: false, status: 429, error: "Rate limited: wait a minute and try again." };
      }

      const values: Record<string, string> = {};
      let path = route.path;
      for (const name of params) {
        const value = args[name];
        if (value === undefined || value === null || value === "") return { ok: false, status: 400, error: `"${name}" is required.` };
        values[name] = String(value);
        path = path.replace(`:${name}`, encodeURIComponent(String(value)));
      }
      const rest = Object.fromEntries(Object.entries(args).filter(([key]) => !params.includes(key)));
      const asQuery = route.method === "GET" || route.method === "DELETE";
      const query: Record<string, string> = {};
      if (asQuery) {
        for (const [key, value] of Object.entries(rest)) {
          if (value === undefined || value === null) continue;
          query[key] = typeof value === "object" ? JSON.stringify(value) : String(value);
        }
      }
      const { getDefaultLocale } = await import("../../i18n/languages-db.js");
      const request: PluginHttpRequest = {
        method: route.method,
        path,
        query,
        params: values,
        body: asQuery ? undefined : rest,
        headers: { "content-type": "application/json", "user-agent": `justflows-${ctx.principal.via}` },
        session,
        locale: await getDefaultLocale().catch(() => "en"),
      };
      const response = await route.handler(request);
      const outcome = outcomeOfResponse(response ?? {});
      if (outcome.ok && response?.revalidate === true && route.method !== "GET") {
        void import("../../cache/cache-revalidate.js")
          .then((m) => m.revalidateOnUpdate("plugin", { siteId: session.siteId }))
          .catch(() => undefined);
      }
      return outcome;
    },
  };
}

/** Tools for every opted-in route of the plugins active on this request's site. */
export function pluginRouteTools(): AgentTool[] {
  const routes = getPluginLoader()?.httpRouter.list() ?? [];
  return routes
    .filter((route) => route.mcp && pluginActiveForRequest(route.pluginId))
    .map(routeTool)
    .filter((tool): tool is AgentTool => tool !== null);
}
