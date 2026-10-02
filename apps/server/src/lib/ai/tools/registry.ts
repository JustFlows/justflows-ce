// SPDX-License-Identifier: MIT

import type { McpToolDefinition } from "@justflows/sdk";
import { keyCan } from "../../auth/api-keys.js";
import { getRuntimeHooks } from "../../plugins/plugin-runtime.js";
import { auditLog } from "../../security/audit-log.js";
import { logSafe } from "../../security/log-safe.js";
import { runWithAgentOrigin } from "../agent-origin.js";
import { CORE_TOOLS } from "./catalog.js";
import { READ, type AgentTool, type JsonSchemaObject, type ToolCallContext, type ToolOutcome } from "./manage-tool.js";
import { principalCapabilities, type AgentPrincipal } from "./principal.js";

/**
 * Resolve, filter and call agent tools — the one code path behind both MCP
 * `tools/list` / `tools/call` and the assistant.
 *
 * A tool is listed only when the principal currently holds every capability it
 * needs (and, for users & roles tools, only when the key or grant opted in).
 * Calling a tool that is not listed is refused the same way, so filtering is
 * not merely cosmetic; the handler it reaches checks the capability again.
 */

const TOOL_NAME = /^[a-z][a-z0-9_]{2,63}$/;
const MAX_RESULT_CHARS = 100_000;

function pluginTool(definition: McpToolDefinition, coreNames: Set<string>): AgentTool | null {
  if (!definition || typeof definition !== "object") return null;
  if (typeof definition.name !== "string" || !TOOL_NAME.test(definition.name) || coreNames.has(definition.name)) return null;
  if (typeof definition.capability !== "string" || !definition.capability) return null;
  if (typeof definition.handler !== "function") return null;
  const schema = definition.inputSchema;
  const inputSchema: JsonSchemaObject =
    schema && typeof schema === "object" && schema.type === "object"
      ? (schema as JsonSchemaObject)
      : { type: "object", properties: {} };
  const annotations = {
    readOnlyHint: definition.annotations?.readOnlyHint === true,
    destructiveHint: definition.annotations?.destructiveHint === true,
    idempotentHint: definition.annotations?.idempotentHint === true,
  };
  return {
    name: definition.name,
    title: typeof definition.title === "string" ? definition.title.slice(0, 120) : definition.name,
    description: String(definition.description ?? "").slice(0, 2_000),
    inputSchema,
    annotations,
    group: "plugin",
    capabilities: [definition.capability],
    async run(args, ctx): Promise<ToolOutcome> {
      const { principal } = ctx;
      // Per-call re-check; the plugin's handler owns any per-resource checks.
      if (!(await keyCan(principal.key, principal.owner, definition.capability))) {
        return { ok: false, status: 403, error: "Forbidden: this session is not allowed to do that." };
      }
      const capabilities = [...(await principalCapabilities(principal))];
      const data = await definition.handler(args, {
        siteId: principal.owner.siteId,
        userId: principal.owner.userId,
        via: principal.via,
        client: principal.clientName,
        capabilities,
      });
      return { ok: true, data: data ?? { ok: true } };
    },
  };
}

/** Every tool: the core catalog plus anything plugins add through `mcp.tools`. */
export async function allTools(siteId: string): Promise<AgentTool[]> {
  const hooks = getRuntimeHooks();
  if (!hooks.has("mcp.tools")) return CORE_TOOLS;
  const coreNames = new Set(CORE_TOOLS.map((tool) => tool.name));
  let contributed: unknown;
  try {
    contributed = await hooks.applyFilter("mcp.tools", [], { siteId });
  } catch (err) {
    console.error("[justflows] mcp.tools filter failed", JSON.stringify(logSafe(String(err))));
    return CORE_TOOLS;
  }
  const extra = (Array.isArray(contributed) ? contributed : [])
    .map((definition) => pluginTool(definition as McpToolDefinition, coreNames))
    .filter((tool): tool is AgentTool => tool !== null);
  const seen = new Set<string>();
  return [...CORE_TOOLS, ...extra.filter((tool) => (seen.has(tool.name) ? false : (seen.add(tool.name), true)))];
}

/** The tools this principal may see and call right now. */
export async function toolsForPrincipal(principal: AgentPrincipal): Promise<AgentTool[]> {
  const [tools, capabilities] = await Promise.all([allTools(principal.owner.siteId), principalCapabilities(principal)]);
  return tools.filter((tool) => {
    if (tool.group === "users" && !principal.userTools) return false;
    return tool.capabilities.every((capability) => capabilities.has(capability));
  });
}

function typeMatches(expected: unknown, value: unknown): boolean {
  const types = Array.isArray(expected) ? expected : [expected];
  return types.some((type) => {
    switch (type) {
      case "string":
        return typeof value === "string";
      case "integer":
        return typeof value === "number" && Number.isInteger(value);
      case "number":
        return typeof value === "number" && Number.isFinite(value);
      case "boolean":
        return typeof value === "boolean";
      case "array":
        return Array.isArray(value);
      case "object":
        return Boolean(value) && typeof value === "object" && !Array.isArray(value);
      case "null":
        return value === null;
      default:
        return true;
    }
  });
}

/**
 * Shallow argument check against a tool's input schema: required keys, the
 * top-level types and enums, and unknown keys when the schema is closed. The
 * handler validates in depth; this turns the common mistakes into errors a
 * model can fix before a request is made.
 */
export function checkArguments(schema: JsonSchemaObject, args: Record<string, unknown>): string | null {
  for (const key of schema.required ?? []) {
    if (args[key] === undefined) return `Missing required argument "${key}".`;
  }
  for (const [key, value] of Object.entries(args)) {
    const spec = schema.properties[key] as { type?: unknown; enum?: unknown[] } | undefined;
    if (!spec) {
      if (schema.additionalProperties === false) {
        return `Unknown argument "${key}". Allowed: ${Object.keys(schema.properties).join(", ") || "none"}.`;
      }
      continue;
    }
    if (value === undefined) continue;
    if (spec.type !== undefined && !typeMatches(spec.type, value)) {
      return `Argument "${key}" must be ${Array.isArray(spec.type) ? spec.type.join(" or ") : String(spec.type)}.`;
    }
    if (Array.isArray(spec.enum) && !spec.enum.includes(value)) {
      return `Argument "${key}" must be one of ${spec.enum.join(", ")}.`;
    }
  }
  return null;
}

function targetOf(tool: AgentTool, args: Record<string, unknown>): string | null {
  const value = tool.targetArg ? args[tool.targetArg] : undefined;
  return typeof value === "string" || typeof value === "number" ? String(value).slice(0, 255) : null;
}

function audit(tool: AgentTool, args: Record<string, unknown>, ctx: ToolCallContext, outcome: ToolOutcome): void {
  if (tool.annotations.readOnlyHint) return;
  const { principal } = ctx;
  // Never the arguments themselves: they can hold content, passwords or keys.
  const credential =
    principal.kind === "api-key"
      ? `key=${principal.key.id}`
      : principal.kind === "oauth"
        ? `oauth_client=${principal.oauthClientId ?? ""} grant=${principal.id}`
        : "assistant";
  void auditLog({
    siteId: principal.owner.siteId,
    action: "ai.tool_called",
    outcome: outcome.ok ? "success" : "failure",
    actorId: principal.owner.userId,
    actorRole: principal.via,
    target: targetOf(tool, args),
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
    detail: `tool=${tool.name} via=${principal.via} client=${principal.clientName} ${credential}${
      outcome.ok ? "" : ` status=${outcome.status ?? "error"}`
    }`,
  });
}

export interface ToolCallResult extends Pick<AgentTool, "name" | "annotations"> {
  outcome: ToolOutcome;
}

/** Find a tool the principal may call, or explain why not (without leaking which). */
export async function resolveTool(principal: AgentPrincipal, name: string): Promise<AgentTool | null> {
  const tools = await toolsForPrincipal(principal);
  return tools.find((tool) => tool.name === name) ?? null;
}

export async function callTool(
  principal: AgentPrincipal,
  name: string,
  rawArgs: unknown,
  meta: { ip?: string; userAgent?: string } = {},
): Promise<ToolCallResult> {
  const tool = await resolveTool(principal, name);
  if (!tool) {
    return {
      name,
      annotations: READ,
      outcome: { ok: false, status: 403, error: `Tool "${name}" is not available to this session.` },
    };
  }
  const args = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? (rawArgs as Record<string, unknown>) : {};
  const problem = checkArguments(tool.inputSchema, args);
  const ctx: ToolCallContext = { principal, ip: meta.ip, userAgent: meta.userAgent };
  if (problem) return { name, annotations: tool.annotations, outcome: { ok: false, status: 400, error: problem } };

  let outcome: ToolOutcome;
  try {
    outcome = await runWithAgentOrigin({ via: principal.via, client: principal.clientName }, () => tool.run(args, ctx));
  } catch (err) {
    console.error("[justflows] agent tool failed", JSON.stringify(logSafe(`${name}: ${String(err)}`)));
    outcome = { ok: false, status: 500, error: "The tool failed to run." };
  }
  audit(tool, args, ctx, outcome);
  return { name, annotations: tool.annotations, outcome };
}

/** Serialize a tool outcome for a model, capped so one call cannot flood a context window. */
export function outcomeText(outcome: ToolOutcome): string {
  const text = outcome.ok ? JSON.stringify(outcome.data, null, 1) : outcome.error;
  return text.length > MAX_RESULT_CHARS
    ? `${text.slice(0, MAX_RESULT_CHARS)}\n… (truncated; request a smaller page with "limit")`
    : text;
}
