// SPDX-License-Identifier: MIT

import type { Request, Response } from "express";
import { createDeviceSession } from "./device-sessions.js";
import { setSessionCookie } from "./session.js";
import { clientIp } from "../security/rate-limit.js";
import { auditContext, auditLog } from "../security/audit-log.js";

export interface SignInAccount {
  id: string;
  /** The site the session is for: the requested site, which in a shared workspace may not be home. */
  site_id: string;
  email: string;
  role: string;
  token_version: number | string | null | undefined;
}

/**
 * Open a device session for an account that has passed every check, and record
 * the sign-in. Returns false when the session could not be stored, in which
 * case no cookie was set. `method` is recorded in the audit detail.
 */
export async function finishSignIn(
  req: Request,
  res: Response,
  account: SignInAccount,
  method: "password" | "passkey",
): Promise<boolean> {
  const sid = await createDeviceSession({
    userId: account.id,
    siteId: account.site_id,
    userAgent: req.get("user-agent"),
    ip: clientIp(req),
  });
  if (!sid) return false;
  setSessionCookie(res, {
    sid,
    userId: account.id,
    siteId: account.site_id,
    role: account.role,
    email: account.email,
    tv: Number(account.token_version ?? 0),
  });
  void auditLog({
    siteId: account.site_id,
    action: "auth.login",
    actorId: account.id,
    actorEmail: account.email,
    actorRole: account.role,
    ...auditContext(req),
    ...(method === "passkey" ? { detail: "passkey" } : {}),
  });
  return true;
}
