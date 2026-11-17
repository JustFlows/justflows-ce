// SPDX-License-Identifier: MIT

import { Router } from "express";
import { z } from "zod";
import { getDb } from "../../lib/database/db.js";
import { verifyPassword } from "../../lib/auth/password.js";
import { exportPersonalData, summarizePersonalData } from "../../lib/auth/personal-data.js";
import { addressConfirmed, cancelErasureRequest, createErasureRequest, openErasureRequest, redeemAddressConfirmation, selfServiceSettings, sendAddressConfirmation } from "../../lib/auth/data-requests.js";
import { accountDataPageUrl } from "../../lib/account/pages.js";
import { consumeRateLimit } from "../../lib/security/rate-limit.js";
import { sendServerError } from "../../lib/http/send-error.js";

/**
 * A signed-in member's own data, behind `/api/account/data` (the "Your data"
 * account page). Mounted on the account API, which already requires a
 * session, marks every answer private, and limits reads. Each member reaches
 * only their own account; there is no id to change.
 */
export const accountDataRouter = Router();

const slow = () => new Promise((resolve) => setTimeout(resolve, 300 + Math.random() * 200));

type Member = { email: string; displayName: string; passwordHash: string };

/** The account as stored now: its address may have changed since the session began. */
async function memberOf(siteId: string, userId: string): Promise<Member | null> {
  const db = await getDb();
  const rows = await db.query<{ password_hash: string; email: string; display_name: string | null; username: string }>(
    "SELECT password_hash, email, display_name, username FROM users WHERE id = ? AND site_id = ? LIMIT 1", [userId, siteId]);
  const user = rows[0];
  return user ? { email: String(user.email), displayName: user.display_name || user.username, passwordHash: user.password_hash } : null;
}

const CONFIRM_FIRST = { error: "Confirm your email address first.", code: "confirm_address" };

/** What the page shows: which actions the site offers, an open request, and (when asked) how much is held. */
accountDataRouter.get("/", async (req, res) => {
  const session = req.session!;
  try {
    const member = await memberOf(session.siteId, session.userId);
    const [settings, request, confirmed] = await Promise.all([
      selfServiceSettings(session.siteId),
      openErasureRequest(session.siteId, session.userId),
      member ? addressConfirmed(session.userId, member.email) : Promise.resolve(false),
    ]);
    /**
     * Counting asks every plugin, which also finds guest records by address,
     * so only once the address is confirmed, when the page shows it, and never
     * more than a few times a minute.
     */
    const summary = confirmed && req.query.summary === "1" && consumeRateLimit(`account-data:summary:${session.userId}`, 10, 60_000)
      ? await summarizePersonalData(session.siteId, session.userId, { userId: session.userId, role: session.role })
      : null;
    res.json({
      confirmed,
      email: member?.email ?? session.email,
      download: settings.download,
      erasure: settings.erasure,
      request: request ? { id: request.id, requestedAt: request.requestedAt, dueAt: request.dueAt } : null,
      summary,
    });
  } catch (err) {
    sendServerError(res, "account-data", err);
  }
});

/** A copy of everything held about the member, the same export an administrator gets. */
accountDataRouter.get("/export", async (req, res) => {
  const session = req.session!;
  try {
    if (!(await selfServiceSettings(session.siteId)).download) {
      res.status(403).json({ error: "This site does not offer downloads here. Contact the site to ask for your data." });
      return;
    }
    const member = await memberOf(session.siteId, session.userId);
    if (!member || !(await addressConfirmed(session.userId, member.email))) {
      res.status(403).json(CONFIRM_FIRST);
      return;
    }
    if (!consumeRateLimit(`account-data:export:${session.userId}`, 5, 60 * 60 * 1000)) {
      res.status(429).json({ error: "You downloaded your data a few times already. Try again in an hour." });
      return;
    }
    const data = await exportPersonalData(session.siteId, { userId: session.userId }, { userId: session.userId, role: session.role });
    if (!data) {
      res.status(404).json({ error: "Your account was not found." });
      return;
    }
    res.setHeader("Content-Disposition", `attachment; filename="your-data-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(data);
  } catch (err) {
    sendServerError(res, "account-data", err);
  }
});

const RequestSchema = z.object({
  /** Asked again, so a borrowed session cannot have an account removed. */
  password: z.string().min(1).max(256),
  note: z.string().trim().max(2000).optional(),
});

accountDataRouter.post("/erasure-request", async (req, res) => {
  const session = req.session!;
  const body = RequestSchema.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: "Enter your password to confirm." });
    return;
  }
  try {
    if (!consumeRateLimit(`account-data:erasure:${session.userId}`, 10, 15 * 60 * 1000)) {
      res.status(429).json({ error: "Too many attempts. Try again later." });
      return;
    }
    const user = await memberOf(session.siteId, session.userId);
    if (!user || !(await verifyPassword(body.data.password, user.passwordHash))) {
      await slow();
      /** 403, not 401: the session is fine, and the page treats 401 as "signed out". */
      res.status(403).json({ error: "Password is incorrect" });
      return;
    }
    const result = await createErasureRequest(session.siteId, { userId: session.userId, email: user.email, displayName: user.displayName }, body.data.note || null);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(result.created ? 201 : 200).json({ request: { id: result.request.id, requestedAt: result.request.requestedAt, dueAt: result.request.dueAt } });
  } catch (err) {
    sendServerError(res, "account-data", err);
  }
});

accountDataRouter.delete("/erasure-request", async (req, res) => {
  const session = req.session!;
  try {
    const cancelled = await cancelErasureRequest(session.siteId, session.userId);
    if (!cancelled) {
      res.status(404).json({ error: "You have no open request." });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    sendServerError(res, "account-data", err);
  }
});

/** Mail a link that confirms the member reads their account's address. */
accountDataRouter.post("/confirm-address", async (req, res) => {
  const session = req.session!;
  try {
    if (!consumeRateLimit(`account-data:confirm:${session.userId}`, 3, 60 * 60 * 1000)) {
      res.status(429).json({ error: "We sent a few emails already. Check your inbox, or try again in an hour." });
      return;
    }
    const [member, pageUrl] = await Promise.all([memberOf(session.siteId, session.userId), accountDataPageUrl(session.siteId)]);
    if (!member || !pageUrl) {
      res.status(404).json({ error: "This site has no Your data page." });
      return;
    }
    if (!(await sendAddressConfirmation(session.siteId, { userId: session.userId, email: member.email, displayName: member.displayName }, pageUrl))) {
      res.status(502).json({ error: "The email could not be sent. Try again later." });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    sendServerError(res, "account-data", err);
  }
});

/** The link from that email, opened while signed in to the same account. */
accountDataRouter.post("/confirm-address/verify", async (req, res) => {
  const session = req.session!;
  const token = z.string().min(10).max(2000).safeParse(req.body?.token);
  try {
    const member = token.success ? await memberOf(session.siteId, session.userId) : null;
    if (!member || !consumeRateLimit(`account-data:verify:${session.userId}`, 10, 15 * 60 * 1000)
      || !(await redeemAddressConfirmation(token.data!, { siteId: session.siteId, userId: session.userId, email: member.email }))) {
      res.status(400).json({ error: "This link does not work any more, or belongs to another account. Send a new one." });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    sendServerError(res, "account-data", err);
  }
});
