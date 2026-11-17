// SPDX-License-Identifier: MIT

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getDb } from "../database/db.js";
import { toIsoTimestamp } from "../content/content-api.js";
import { auditLog } from "../security/audit-log.js";
import { getSiteSetting, setSiteSetting } from "../settings/site-settings.js";
import { addressReference, erasePersonalData, type ErasureResult } from "./personal-data.js";
import { deleteUser, type UserAdminActor } from "./users-admin.js";
import { getUserPreference, setUserPreference } from "./user-preferences.js";

/**
 * Members' own data requests (GDPR Art. 15 and 17), from the "Your data"
 * account page. A download is answered at once. A removal is a request: an
 * administrator reviews it under Users → Data requests and either completes
 * it (core and every plugin erase what the law lets them, and the account is
 * deleted) or declines it with a reason the member is told. The law gives a
 * month to answer, so each request carries a due date.
 *
 * Both are site settings the server enforces, so a site can offer either,
 * both, or neither; the block's own switches can only hide what is offered.
 */

export const SELF_DOWNLOAD_SETTING = "privacy_self_download";
export const SELF_ERASURE_SETTING = "privacy_self_erasure";
/** Days an administrator has to answer a removal request. */
export const ERASURE_DUE_DAYS = 30;

export interface SelfServiceSettings {
  download: boolean;
  erasure: boolean;
}

/** Both are on unless the site turned them off: access and erasure are rights, not extras. */
export async function selfServiceSettings(siteId: string): Promise<SelfServiceSettings> {
  const [download, erasure] = await Promise.all([
    getSiteSetting<unknown>(siteId, SELF_DOWNLOAD_SETTING).catch(() => null),
    getSiteSetting<unknown>(siteId, SELF_ERASURE_SETTING).catch(() => null),
  ]);
  return { download: download !== false, erasure: erasure !== false };
}

export async function saveSelfServiceSettings(siteId: string, next: Partial<SelfServiceSettings>): Promise<SelfServiceSettings> {
  if (typeof next.download === "boolean") await setSiteSetting(siteId, SELF_DOWNLOAD_SETTING, next.download);
  if (typeof next.erasure === "boolean") await setSiteSetting(siteId, SELF_ERASURE_SETTING, next.erasure);
  return selfServiceSettings(siteId);
}

/**
 * Proof the member reads the mailbox of their account's address. Accounts
 * are made without verifying the address, and plugins also find guest
 * records by address (a booking or order placed before the account existed),
 * so anyone who signs up with somebody else's address would otherwise see,
 * download, or have removed that person's guest records. The member confirms
 * once per address through a signed link; a changed address needs a new one.
 */
export const ADDRESS_CONFIRMED_PREFERENCE = "privacy.confirmed_address";
const CONFIRM_TTL_MS = 24 * 60 * 60 * 1000;

function signingKey(): string {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 32) throw new Error("Address confirmation is unavailable");
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update("justflows:data-address:v1:").update(payload).digest("base64url");
}

export function addressConfirmationToken(siteId: string, userId: string, email: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ s: siteId, u: userId, a: addressReference(email), x: now + CONFIRM_TTL_MS })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Accept a link only for the signed-in member it was sent to, at the address the account still has. */
export async function redeemAddressConfirmation(token: string, member: { siteId: string; userId: string; email: string }, now = Date.now()): Promise<boolean> {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  let claims: { s?: unknown; u?: unknown; a?: unknown; x?: unknown };
  try { claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as typeof claims; } catch { return false; }
  if (claims.s !== member.siteId || claims.u !== member.userId || claims.a !== addressReference(member.email) || typeof claims.x !== "number" || claims.x < now) return false;
  await setUserPreference(member.userId, ADDRESS_CONFIRMED_PREFERENCE, { address: addressReference(member.email), at: new Date(now).toISOString() });
  void auditLog({ siteId: member.siteId, action: "privacy.address_confirmed", actorId: member.userId, actorRole: null, target: member.userId });
  return true;
}

export async function addressConfirmed(userId: string, email: string): Promise<boolean> {
  const stored = await getUserPreference<{ address?: unknown }>(userId, ADDRESS_CONFIRMED_PREFERENCE).catch(() => null);
  return stored?.address === addressReference(email);
}

/** Mail the member a link to their Your data page that confirms the address. */
export async function sendAddressConfirmation(siteId: string, member: { userId: string; email: string; displayName: string }, pageUrl: string): Promise<boolean> {
  const { emailSiteOrigin } = await import("../email/email-asset-url.js");
  const origin = await emailSiteOrigin(siteId);
  if (!origin) return false;
  const link = `${origin}${pageUrl}?confirm=${encodeURIComponent(addressConfirmationToken(siteId, member.userId, member.email))}`;
  if (process.env.NODE_ENV === "development") console.log(`\n[dev] data address confirmation for ${member.email}:\n      ${link}\n`);
  const { sendTemplateMail } = await import("../email/mail.js");
  const result = await sendTemplateMail({ to: member.email, key: "core.email-verification", values: { display_name: member.displayName || member.email, action_url: link, expiration: "24 hours" } });
  return result.ok;
}

export type DataRequestStatus = "pending" | "completed" | "declined" | "cancelled";

export interface DataRequest {
  id: string;
  kind: "erasure";
  userId: string | null;
  /** The member's address while the request is open; empty once handled. */
  email: string;
  /** The account's current name, while it exists. */
  displayName: string | null;
  status: DataRequestStatus;
  note: string | null;
  outcome: string | null;
  requestedAt: string;
  dueAt: string;
  handledAt: string | null;
  handledBy: string | null;
}

type Row = Record<string, unknown>;

function sqlTime(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "");
}

function fromRow(row: Row, names: Map<string, string>): DataRequest {
  const userId = row.user_id ? String(row.user_id) : null;
  return {
    id: String(row.id),
    kind: "erasure",
    userId,
    email: String(row.email ?? ""),
    displayName: userId ? names.get(userId) ?? null : null,
    status: String(row.status) as DataRequestStatus,
    note: row.note ? String(row.note) : null,
    outcome: row.outcome ? String(row.outcome) : null,
    requestedAt: toIsoTimestamp(row.requested_at) ?? "",
    dueAt: toIsoTimestamp(row.due_at) ?? "",
    handledAt: toIsoTimestamp(row.handled_at),
    handledBy: row.handled_by ? String(row.handled_by) : null,
  };
}

async function namesOf(siteId: string, rows: Row[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((row) => row.user_id).filter(Boolean).map(String))];
  if (!ids.length) return new Map();
  const db = await getDb();
  const users = await db.query<{ id: string; display_name: string | null; username: string }>(
    `SELECT id, display_name, username FROM users WHERE site_id = ? AND id IN (${ids.map(() => "?").join(", ")})`, [siteId, ...ids]);
  return new Map(users.map((user) => [String(user.id), user.display_name || user.username]));
}

/** The member's open removal request, if any. */
export async function openErasureRequest(siteId: string, userId: string): Promise<DataRequest | null> {
  const db = await getDb();
  const rows = await db.query<Row>("SELECT * FROM data_requests WHERE site_id = ? AND user_id = ? AND status = 'pending' ORDER BY requested_at DESC LIMIT 1", [siteId, userId]);
  return rows[0] ? fromRow(rows[0], new Map()) : null;
}

export async function listDataRequests(siteId: string, scope: "open" | "handled"): Promise<DataRequest[]> {
  const db = await getDb();
  const rows = scope === "open"
    ? await db.query<Row>("SELECT * FROM data_requests WHERE site_id = ? AND status = 'pending' ORDER BY due_at ASC, id ASC LIMIT 200", [siteId])
    : await db.query<Row>("SELECT * FROM data_requests WHERE site_id = ? AND status <> 'pending' ORDER BY handled_at DESC, id DESC LIMIT 100", [siteId]);
  const names = await namesOf(siteId, rows);
  return rows.map((row) => fromRow(row, names));
}

export async function countOpenDataRequests(siteId: string): Promise<number> {
  const db = await getDb();
  const rows = await db.query<{ n: number | string }>("SELECT COUNT(*) AS n FROM data_requests WHERE site_id = ? AND status = 'pending'", [siteId]);
  return Number(rows[0]?.n ?? 0);
}

async function mailMember(to: string, key: string, values: Record<string, string>): Promise<void> {
  if (!to) return;
  try {
    const { sendTemplateMail } = await import("../email/mail.js");
    await sendTemplateMail({ to, key, values });
  } catch (err) {
    console.error("Data request email failed:", err);
  }
}

async function mailAdministrators(siteId: string, title: string, message: string): Promise<void> {
  try {
    const [{ getGeneralSettings }, { sendTemplateMail }] = await Promise.all([import("../settings/general-settings.js"), import("../email/mail.js")]);
    const to = (await getGeneralSettings(siteId)).adminEmail;
    if (to) await sendTemplateMail({ to, key: "core.admin-notification", values: { title, message } });
  } catch (err) {
    console.error("Data request notice failed:", err);
  }
}

const dateOf = (iso: string) => iso.slice(0, 10);

export type CreateResult = { ok: true; request: DataRequest; created: boolean } | { ok: false; status: number; error: string };

/**
 * A member asks for their data to be removed. Asking again while a request is
 * open returns that request; the member and the site's administrator are told.
 */
export async function createErasureRequest(siteId: string, member: { userId: string; email: string; displayName: string }, note: string | null): Promise<CreateResult> {
  if (!(await selfServiceSettings(siteId)).erasure) return { ok: false, status: 403, error: "This site does not take removal requests here. Contact the site to ask." };
  if (!(await addressConfirmed(member.userId, member.email))) return { ok: false, status: 403, error: "Confirm your email address first." };
  const open = await openErasureRequest(siteId, member.userId);
  if (open) return { ok: true, request: open, created: false };
  const now = new Date();
  const due = new Date(now.getTime() + ERASURE_DUE_DAYS * 24 * 60 * 60 * 1000);
  const id = randomUUID();
  const db = await getDb();
  await db.run(
    "INSERT INTO data_requests (id, site_id, kind, user_id, email, address_ref, status, note, requested_at, due_at) VALUES (?, ?, 'erasure', ?, ?, ?, 'pending', ?, ?, ?)",
    [id, siteId, member.userId, member.email.toLowerCase(), addressReference(member.email), note, sqlTime(now), sqlTime(due)],
  );
  const request = (await openErasureRequest(siteId, member.userId))!;
  void auditLog({ siteId, action: "privacy.request_created", actorId: member.userId, actorRole: null, target: member.userId, detail: `erasure request ${id}, due ${dateOf(request.dueAt)}` });
  await mailMember(member.email, "core.data-request-received", { display_name: member.displayName || member.email, due_date: dateOf(request.dueAt) });
  await mailAdministrators(siteId, "New data removal request", `${member.displayName || "A member"} asked for their data to be removed. Handle it under Users → Data requests by ${dateOf(request.dueAt)}.`);
  return { ok: true, request, created: true };
}

/** The member changed their mind before it was handled. */
export async function cancelErasureRequest(siteId: string, userId: string): Promise<boolean> {
  const open = await openErasureRequest(siteId, userId);
  if (!open) return false;
  const db = await getDb();
  await db.run("UPDATE data_requests SET status = 'cancelled', email = '', handled_at = ?, handled_by = ? WHERE id = ? AND site_id = ? AND status = 'pending'", [sqlTime(new Date()), userId, open.id, siteId]);
  void auditLog({ siteId, action: "privacy.request_cancelled", actorId: userId, actorRole: null, target: userId, detail: `erasure request ${open.id}` });
  return true;
}

async function pendingById(siteId: string, id: string): Promise<Row | null> {
  const db = await getDb();
  const rows = await db.query<Row>("SELECT * FROM data_requests WHERE id = ? AND site_id = ? LIMIT 1", [id, siteId]);
  return rows[0] ?? null;
}

/** A short, address-free summary of what an erasure did, kept with the request. */
export function outcomeSummary(result: ErasureResult, accountDeleted: boolean): string {
  const parts = [
    accountDeleted ? "Account deleted." : "No account to delete.",
    `Comments anonymised: ${result.commentsAnonymised}.`,
    ...result.plugins.map((part) => part.ok
      ? `${part.label}: ${Object.values(part.counts).reduce((sum, n) => sum + n, 0)} removed${part.kept.length ? `; kept by law ${part.kept.map((item) => `${item.count} ${item.kind} until ${dateOf(item.until)}`).join(", ")}` : ""}.`
      : `${part.label}: failed (${part.error ?? "unknown error"}).`),
  ];
  return parts.join(" ").slice(0, 4000);
}

export type HandleResult =
  | { ok: true; request: DataRequest; erasure?: ErasureResult }
  | { ok: false; status: number; error: string };

/**
 * Carry out a removal request: erase in core and every plugin (each keeps what
 * the law requires and says so), then delete the account. A plugin that fails
 * leaves the request open, so it can be completed again once it answers; what
 * was already erased stays erased.
 */
export async function completeErasureRequest(siteId: string, id: string, actor: UserAdminActor): Promise<HandleResult> {
  const row = await pendingById(siteId, id);
  if (!row) return { ok: false, status: 404, error: "Request not found." };
  if (row.status !== "pending") return { ok: false, status: 409, error: "This request was already handled." };
  const userId = row.user_id ? String(row.user_id) : null;
  const email = String(row.email ?? "");
  const db = await getDb();
  const account = userId
    ? (await db.query<{ role: string; display_name: string | null }>("SELECT role, display_name FROM users WHERE id = ? AND site_id = ? LIMIT 1", [userId, siteId]))[0] ?? null
    : null;
  if (account?.role === "administrator") return { ok: false, status: 409, error: "This person is an administrator. Change their role first; an administrator's account is not removed this way." };
  if (userId && userId === actor.userId) return { ok: false, status: 409, error: "You cannot complete your own removal request. Ask another administrator." };

  const target = account && userId ? { userId } : { email };
  const erasure = await erasePersonalData(siteId, target, null, { userId: actor.userId, role: actor.role });
  if (!erasure) return { ok: false, status: 404, error: "Nothing was found to erase." };
  if (erasure.plugins.some((part) => !part.ok)) {
    await db.run("UPDATE data_requests SET outcome = ? WHERE id = ? AND site_id = ?", [outcomeSummary(erasure, false), id, siteId]);
    return { ok: false, status: 502, error: `Not every part of the site could erase its data: ${erasure.plugins.filter((part) => !part.ok).map((part) => part.label).join(", ")}. What could be erased was erased; try again to finish.` };
  }

  let deleted = false;
  if (account && userId) {
    const removed = await deleteUser(userId, actor);
    if (removed.status !== 200) return { ok: false, status: removed.status, error: String((removed.body as { error?: string }).error ?? "The account could not be deleted.") };
    deleted = true;
  }
  const outcome = outcomeSummary(erasure, deleted);
  await db.run("UPDATE data_requests SET status = 'completed', email = '', outcome = ?, handled_at = ?, handled_by = ? WHERE id = ? AND site_id = ? AND status = 'pending'", [outcome, sqlTime(new Date()), actor.userId, id, siteId]);
  void auditLog({ siteId, action: "privacy.request_completed", actorId: actor.userId, actorRole: actor.role, target: userId ?? `guest:${String(row.address_ref)}`, detail: `erasure request ${id}` });
  const kept = erasure.plugins.flatMap((part) => part.kept.map((item) => `${part.label}: ${item.count} ${item.kind}, until ${dateOf(item.until)}`));
  await mailMember(email, "core.data-request-completed", {
    display_name: account?.display_name || email,
    kept: kept.length ? kept.join("; ") : "Nothing.",
  });
  const request = fromRow((await pendingById(siteId, id))!, new Map());
  return { ok: true, request, erasure };
}

/** Decline with a reason the member is sent, for example a legal claim still open. */
export async function declineErasureRequest(siteId: string, id: string, actor: UserAdminActor, reason: string): Promise<HandleResult> {
  const row = await pendingById(siteId, id);
  if (!row) return { ok: false, status: 404, error: "Request not found." };
  if (row.status !== "pending") return { ok: false, status: 409, error: "This request was already handled." };
  const db = await getDb();
  const userId = row.user_id ? String(row.user_id) : null;
  const account = userId ? (await db.query<{ display_name: string | null }>("SELECT display_name FROM users WHERE id = ? AND site_id = ? LIMIT 1", [userId, siteId]))[0] ?? null : null;
  const email = String(row.email ?? "");
  await db.run("UPDATE data_requests SET status = 'declined', email = '', outcome = ?, handled_at = ?, handled_by = ? WHERE id = ? AND site_id = ? AND status = 'pending'", [reason, sqlTime(new Date()), actor.userId, id, siteId]);
  void auditLog({ siteId, action: "privacy.request_declined", actorId: actor.userId, actorRole: actor.role, target: userId ?? `guest:${String(row.address_ref)}`, detail: `erasure request ${id}` });
  await mailMember(email, "core.data-request-declined", { display_name: account?.display_name || email, reason });
  return { ok: true, request: fromRow((await pendingById(siteId, id))!, new Map()) };
}
