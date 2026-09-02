// SPDX-License-Identifier: MIT

import { createInterface } from "node:readline/promises";
import { pbkdf2 as pbkdf2Cb, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { apiPost } from "../api.js";
import { connectDirect } from "../direct-db.js";

const pbkdf2 = promisify(pbkdf2Cb);

/**
 * Minimum length the install wizard and the server's password policy enforce.
 * Repeated here because `reset-password` writes straight to the database and
 * never passes through the server's validation.
 */
const MIN_PASSWORD_LENGTH = 12;

/** PBKDF2-SHA256, `$pbkdf2$<iterations>$<salt>$<hex>` — identical to the server's format. */
async function hashPassword(password: string): Promise<string> {
  const iterations = 600_000;
  const salt = randomBytes(16).toString("hex");
  const key = await pbkdf2(password, salt, iterations, 32, "sha256");
  return `$pbkdf2$${iterations}$${salt}$${key.toString("hex")}`;
}

function nowSql(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

interface Flags {
  email?: string;
  password?: string;
  site?: string;
}

function parseFlags(args: string[]): Flags {
  const flags: Flags = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if ((arg === "--email" || arg === "-e") && next) {
      flags.email = next;
      i += 1;
    } else if ((arg === "--password" || arg === "-p") && next) {
      flags.password = next;
      i += 1;
    } else if ((arg === "--site" || arg === "-s") && next) {
      flags.site = next;
      i += 1;
    }
  }
  return flags;
}

export async function userCommand(args: string[]): Promise<void> {
  const [sub, ...rest] = args;

  if (sub === "create") {
    await createUser();
    return;
  }

  if (sub === "reset-password") {
    await resetPassword(parseFlags(rest));
    return;
  }

  console.log("Usage: justflows user <create|reset-password>");
}

async function createUser(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log("\nCreate a new Justflows user\n");
    const email = await rl.question("Email: ");
    const username = await rl.question("Username: ");
    const displayName = await rl.question("Display name: ");
    const password = await rl.question("Password (min 12 chars): ");
    const role = await rl.question(
      "Role [administrator/editor/author/contributor/subscriber] (default: subscriber): ",
    );

    await apiPost("/api/users", {
      email,
      username,
      displayName,
      password,
      role: role.trim() || "subscriber",
    });

    console.log(`\n✓ User created: ${email}`);
  } finally {
    rl.close();
  }
}

/**
 * Offline password reset — the documented fallback for issue #93 when outgoing
 * mail is not configured, or the only administrator is locked out and cannot
 * receive an emailed link.
 *
 *   justflows user reset-password --email you@example.com
 *   justflows user reset-password --email you@example.com --password 'a long new one'
 *   justflows user reset-password --email you@example.com --site <site-id>
 *
 * With no --password a strong one is generated and printed once. Every session
 * for the account is revoked and any pending email reset links are invalidated,
 * exactly as the web flow does. Run it from the install directory; it reads the
 * server's `.env` and has no network surface.
 */
async function resetPassword(flags: Flags): Promise<void> {
  if (!flags.email) {
    console.error(
      "Usage: justflows user reset-password --email <address> [--password <password>] [--site <site-id>]",
    );
    process.exitCode = 1;
    return;
  }

  const email = flags.email.toLowerCase().trim();
  const generated = flags.password === undefined;
  const password = flags.password ?? randomBytes(18).toString("base64url");

  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    process.exitCode = 1;
    return;
  }

  const { db } = await connectDirect();
  try {
    const users = await db.query<{ id: string; site_id: string; email: string; role: string }>(
      flags.site
        ? "SELECT id, site_id, email, role FROM users WHERE email = ? AND site_id = ? LIMIT 2"
        : "SELECT id, site_id, email, role FROM users WHERE email = ? LIMIT 2",
      flags.site ? [email, flags.site] : [email],
    );

    if (users.length === 0) {
      console.error(`No account found for ${email}${flags.site ? ` on site ${flags.site}` : ""}.`);
      process.exitCode = 1;
      return;
    }
    if (users.length > 1) {
      console.error(`${email} exists on more than one site. Re-run with --site <site-id>.`);
      process.exitCode = 1;
      return;
    }

    const account = users[0]!;
    await db.run("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ? AND site_id = ?", [
      await hashPassword(password),
      nowSql(),
      account.id,
      account.site_id,
    ]);
    // Revoke every session: token_version is the server's only revocation lever.
    await db.run(
      "UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = ? AND site_id = ?",
      [account.id, account.site_id],
    );
    // Drop any pending emailed reset links so one cannot be used afterwards.
    try {
      await db.run("DELETE FROM password_resets WHERE user_id = ? AND site_id = ?", [
        account.id,
        account.site_id,
      ]);
    } catch {
      // password_resets predates 0017 — nothing to clear.
    }

    console.log(
      `\n✓ Password reset for ${account.email} (${account.role}) on site ${account.site_id}.\n` +
        "  All sessions were signed out and pending email reset links were invalidated.",
    );
    if (generated) console.log(`\n  New password: ${password}\n`);
  } finally {
    await db.close().catch(() => undefined);
  }
}
