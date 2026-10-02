// SPDX-License-Identifier: MIT

import { Router, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { requireCapability, requireSession } from "../../middleware/auth.js";
import { userCan } from "../../lib/auth/access-policy.js";
import { auditFromRequest } from "../../lib/security/audit-log.js";
import { clientIp } from "../../lib/security/rate-limit.js";
import { logSafe } from "../../lib/security/log-safe.js";
import { sendServerError } from "../../lib/http/send-error.js";
import { getAiSettings, isAssistantEnabled, isPublicHttpsOrigin, mcpResourceUrl, publicOrigin, saveAiSettings } from "../../lib/ai/ai-settings.js";
import {
  availableProviders,
  CredentialError,
  deleteCredential,
  fetchModels,
  isProviderId,
  listCredentials,
  loadProviderConfig,
  saveCredential,
  scopeFor,
  type CredentialScope,
} from "../../lib/ai/provider-credentials.js";
import { listProviderAdapters, ProviderError, type ChatMessage, type ProviderId } from "../../lib/ai/providers/index.js";
import { getDailyUsage, recordUsage, withinDailyLimit } from "../../lib/ai/usage.js";
import { principalForAssistant } from "../../lib/ai/tools/principal.js";
import { declinedToolMessage, executeConfirmedTool, runAssistantTurn } from "../../lib/ai/assistant/assistant.js";
import { ActionInputSchema, providerErrorMessage, runEditorAction } from "../../lib/ai/assistant/actions.js";

/**
 * Cookie-authenticated AI routes for the admin (#159), mounted at `/api/ai`.
 *
 * Provider keys flow one way: the browser may send a key to store it, and
 * nothing here ever sends one back — only the provider name and last four
 * characters. Every provider call is made by the server.
 */
const router = Router();
router.use(requireSession);

const assistantLimit = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => `ai-assistant:${req.session?.userId ?? clientIp(req)}`,
});

const providerTestLimit = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => `ai-provider-test:${req.session?.userId ?? clientIp(req)}`,
});

function badRequest(res: Response, message: string): void {
  res.status(400).json({ error: message });
}

function providerFailure(res: Response, err: unknown, scope: string): void {
  const mapped = providerErrorMessage(err);
  if (mapped) {
    res.status(mapped.status).json({ error: mapped.message, kind: err instanceof ProviderError ? err.kind : undefined });
    return;
  }
  sendServerError(res, scope, err);
}

/* ------------------------------- settings -------------------------------- */

router.get("/settings", requireCapability("settings:manage"), async (req, res) => {
  try {
    const origin = publicOrigin(req);
    res.json({
      ...(await getAiSettings()),
      mcpUrl: mcpResourceUrl(req),
      origin,
      publicHttps: isPublicHttpsOrigin(origin),
    });
  } catch (err) {
    sendServerError(res, "ai.settings", err);
  }
});

const SettingsSchema = z.object({
  mcpEnabled: z.boolean().optional(),
  assistantEnabled: z.boolean().optional(),
  allowPrivateEndpoints: z.boolean().optional(),
  userDailyLimit: z.number().int().min(1).max(100_000).nullable().optional(),
  mcpRateLimit: z.number().int().min(1).max(100_000).nullable().optional(),
});

router.put("/settings", requireCapability("settings:manage"), async (req, res) => {
  const body = SettingsSchema.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error.issues[0]?.message ?? "Invalid settings");
  try {
    const saved = await saveAiSettings(body.data);
    auditFromRequest(req, "ai.settings_changed", {
      detail: Object.entries(body.data)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(" "),
    });
    res.json(saved);
  } catch (err) {
    sendServerError(res, "ai.settings", err);
  }
});

/* ------------------------------- providers ------------------------------- */

/**
 * `site` credentials need settings:manage; `personal` ones need ai:use and
 * always belong to the caller.
 */
async function resolveScope(req: Request, res: Response): Promise<CredentialScope | null> {
  const session = req.session!;
  if (req.params.scope === "site") {
    if (!(await userCan(session, "settings:manage"))) {
      res.status(403).json({ error: "Forbidden" });
      return null;
    }
    return { kind: "site" };
  }
  if (req.params.scope === "personal") {
    if (!(await userCan(session, "ai:use"))) {
      res.status(403).json({ error: "Forbidden" });
      return null;
    }
    return { kind: "user", userId: session.userId };
  }
  res.status(404).json({ error: "Not found" });
  return null;
}

router.get("/providers/catalog", async (_req, res) => {
  res.json({
    providers: listProviderAdapters().map((adapter) => ({ id: adapter.id, label: adapter.label, defaultBaseUrl: adapter.defaultBaseUrl })),
  });
});

router.get("/providers/:scope", async (req, res) => {
  const scope = await resolveScope(req, res);
  if (!scope) return;
  try {
    res.json({ credentials: await listCredentials(req.session!.siteId, scope) });
  } catch (err) {
    sendServerError(res, "ai.providers", err);
  }
});

const CredentialSchema = z.object({
  apiKey: z.string().max(500).optional(),
  label: z.string().max(120).nullable().optional(),
  baseUrl: z.string().max(500).nullable().optional(),
  organization: z.string().max(120).nullable().optional(),
  project: z.string().max(120).nullable().optional(),
  models: z.array(z.string().max(200)).max(500).optional(),
  defaultModel: z.string().max(200).nullable().optional(),
  enabled: z.boolean().optional(),
});

router.put("/providers/:scope/:provider", async (req, res) => {
  const scope = await resolveScope(req, res);
  if (!scope) return;
  if (!isProviderId(req.params.provider)) return void res.status(404).json({ error: "Unknown provider" });
  const body = CredentialSchema.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error.issues[0]?.message ?? "Invalid provider settings");
  try {
    const { credential, keyReplaced } = await saveCredential({
      siteId: req.session!.siteId,
      scope,
      provider: req.params.provider,
      ...body.data,
      apiKey: body.data.apiKey?.trim() || undefined,
      actorId: req.session!.userId,
    });
    // Never the key: the provider, the scope and whether the key changed.
    auditFromRequest(req, "ai.provider_saved", {
      target: `${scope.kind === "site" ? "site" : "personal"}:${req.params.provider}`,
      detail: keyReplaced ? `key replaced (…${credential.keyLast4})` : "settings changed",
    });
    res.json({ credential });
  } catch (err) {
    if (err instanceof CredentialError) return badRequest(res, err.message);
    sendServerError(res, "ai.providers", err);
  }
});

router.delete("/providers/:scope/:provider", async (req, res) => {
  const scope = await resolveScope(req, res);
  if (!scope) return;
  if (!isProviderId(req.params.provider)) return void res.status(404).json({ error: "Unknown provider" });
  try {
    const removed = await deleteCredential(req.session!.siteId, scope, req.params.provider);
    if (!removed) return void res.status(404).json({ error: "Not found" });
    auditFromRequest(req, "ai.provider_removed", { target: `${scope.kind === "site" ? "site" : "personal"}:${req.params.provider}` });
    res.status(204).end();
  } catch (err) {
    sendServerError(res, "ai.providers", err);
  }
});

/**
 * Test the stored key by listing models, and store the list so the model
 * picker can offer it. Also the "refresh models" action.
 */
router.post("/providers/:scope/:provider/test", providerTestLimit, async (req, res) => {
  const scope = await resolveScope(req, res);
  if (!scope) return;
  if (!isProviderId(req.params.provider)) return void res.status(404).json({ error: "Unknown provider" });
  const provider: ProviderId = req.params.provider;
  try {
    const config = await loadProviderConfig(req.session!.siteId, scope, provider);
    if (!config) return void res.status(404).json({ error: "Save an API key first." });
    const models = await fetchModels(config);
    const { credential } = await saveCredential({ siteId: req.session!.siteId, scope, provider, models, actorId: req.session!.userId });
    res.json({ ok: true, models, credential });
  } catch (err) {
    providerFailure(res, err, "ai.providers");
  }
});

/* ------------------------------- assistant ------------------------------- */

async function assistantGate(req: Request, res: Response): Promise<boolean> {
  if (!(await isAssistantEnabled())) {
    res.status(404).json({ error: "The assistant is not enabled on this site." });
    return false;
  }
  if (!(await userCan(req.session!, "ai:use"))) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

router.get("/assistant/status", async (req, res) => {
  try {
    const session = req.session!;
    const [enabled, allowed] = await Promise.all([isAssistantEnabled(), userCan(session, "ai:use")]);
    if (!enabled || !allowed) return void res.json({ enabled, allowed, providers: [], usage: null });
    const [providers, usage] = await Promise.all([
      availableProviders(session.siteId, session.userId),
      getDailyUsage(session.siteId, session.userId),
    ]);
    res.json({ enabled, allowed, providers, usage });
  } catch (err) {
    sendServerError(res, "ai.assistant", err);
  }
});

const ContentPart = z.union([
  z.object({ type: z.literal("text"), text: z.string().max(100_000) }),
  z.object({ type: z.literal("image"), mediaType: z.enum(["image/jpeg", "image/png", "image/gif", "image/webp"]), data: z.string().max(7_000_000) }),
]);
const ToolCallSchema = z.object({ id: z.string().max(200), name: z.string().max(64), arguments: z.record(z.string(), z.unknown()) });
const MessageSchema = z.union([
  z.object({ role: z.literal("user"), content: z.union([z.string().max(100_000), z.array(ContentPart).max(8)]) }),
  z.object({ role: z.literal("assistant"), content: z.string().max(200_000), toolCalls: z.array(ToolCallSchema).max(20).optional() }),
  z.object({
    role: z.literal("tool"),
    toolCallId: z.string().max(200),
    name: z.string().max(64),
    content: z.string().max(200_000),
    isError: z.boolean().optional(),
  }),
]);
const ModelChoice = {
  source: z.enum(["site", "personal"]),
  provider: z.enum(["anthropic", "openai", "openai-compatible"]),
  model: z.string().min(1).max(200),
};
const ChatSchema = z.object({
  ...ModelChoice,
  messages: z.array(MessageSchema).min(1).max(200),
  context: z.string().max(5_000).optional(),
});

async function configFor(req: Request, source: "site" | "personal", provider: ProviderId) {
  const session = req.session!;
  return loadProviderConfig(session.siteId, scopeFor(source, session.userId), provider);
}

/**
 * Stream one assistant turn as NDJSON events (`text`, `message`,
 * `tool_status`, `confirm`, `usage`, `done`, `error`). Read-only tools run
 * here; writes come back as `confirm` and wait for /assistant/execute.
 */
router.post("/assistant/chat", assistantLimit, async (req, res) => {
  if (!(await assistantGate(req, res))) return;
  const body = ChatSchema.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error.issues[0]?.message ?? "Invalid conversation");
  const session = req.session!;
  try {
    if (!(await withinDailyLimit(session.siteId, session.userId))) {
      return void res.status(429).json({ error: "You have reached today's assistant limit.", kind: "daily_limit" });
    }
    const config = await configFor(req, body.data.source, body.data.provider);
    if (!config) return badRequest(res, "That AI provider is not configured.");
    const principal = await principalForAssistant(session);
    await recordUsage(session.siteId, session.userId, { requests: 1 });

    res.status(200);
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    const write = (event: unknown) => {
      if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
    };

    let input = 0;
    let output = 0;
    try {
      for await (const event of runAssistantTurn({
        principal,
        config,
        model: body.data.model,
        messages: body.data.messages as ChatMessage[],
        context: body.data.context,
        signal: abort.signal,
        meta: { ip: clientIp(req), userAgent: req.get("user-agent") ?? undefined },
      })) {
        if (event.type === "usage") {
          input += event.inputTokens;
          output += event.outputTokens;
        }
        write(event);
      }
    } catch (err) {
      const mapped = providerErrorMessage(err);
      if (!mapped) console.error("[justflows] assistant turn failed", JSON.stringify(logSafe(String(err))));
      write({ type: "error", error: mapped?.message ?? "The assistant failed. Try again.", kind: err instanceof ProviderError ? err.kind : undefined });
    } finally {
      await recordUsage(session.siteId, session.userId, { inputTokens: input, outputTokens: output });
      res.end();
    }
  } catch (err) {
    if (!res.headersSent) providerFailure(res, err, "ai.assistant");
    else res.end();
  }
});

const ExecuteSchema = z.object({ call: ToolCallSchema, approve: z.boolean() });

/** Run (or decline) one write the user reviewed. Returns the tool message to append. */
router.post("/assistant/execute", assistantLimit, async (req, res) => {
  if (!(await assistantGate(req, res))) return;
  const body = ExecuteSchema.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error.issues[0]?.message ?? "Invalid request");
  try {
    if (!body.data.approve) return void res.json({ message: declinedToolMessage(body.data.call) });
    const principal = await principalForAssistant(req.session!);
    const message = await executeConfirmedTool(principal, body.data.call, {
      ip: clientIp(req),
      userAgent: req.get("user-agent") ?? undefined,
    });
    res.json({ message });
  } catch (err) {
    sendServerError(res, "ai.assistant", err);
  }
});

const ActionSchema = ActionInputSchema.extend(ModelChoice);

/** One-click editor actions: a suggestion to review, never a save. */
router.post("/assistant/action", assistantLimit, async (req, res) => {
  if (!(await assistantGate(req, res))) return;
  const body = ActionSchema.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error.issues[0]?.message ?? "Invalid request");
  const session = req.session!;
  try {
    if (!(await withinDailyLimit(session.siteId, session.userId))) {
      return void res.status(429).json({ error: "You have reached today's assistant limit.", kind: "daily_limit" });
    }
    const config = await configFor(req, body.data.source, body.data.provider);
    if (!config) return badRequest(res, "That AI provider is not configured.");
    const principal = await principalForAssistant(session);
    await recordUsage(session.siteId, session.userId, { requests: 1 });
    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) abort.abort();
    });
    const { result, usage } = await runEditorAction(principal, config, body.data.model, body.data, {
      ip: clientIp(req),
      userAgent: req.get("user-agent") ?? undefined,
      signal: abort.signal,
    });
    await recordUsage(session.siteId, session.userId, usage);
    res.json({ result, usage });
  } catch (err) {
    providerFailure(res, err, "ai.assistant");
  }
});

export default router;
