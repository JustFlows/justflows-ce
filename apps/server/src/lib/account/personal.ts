// SPDX-License-Identifier: MIT

import { getDb } from "../database/db.js";
import { getTenantContext } from "../tenancy/context.js";

/**
 * A member's personal details kept on their account: for now the date of
 * birth, which plugins read through `ctx.users.find` to check an age
 * (classes, age-restricted products) without asking again. Optional;
 * shown to the member and to administrators, never on a public profile.
 */
export interface PersonalDetails {
  birthDate: string | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date between 1900 and today, or null. */
export function validBirthDate(value: unknown, today: string = new Date().toISOString().slice(0, 10)): string | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !DATE.test(value)) return undefined;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return undefined;
  return value >= "1900-01-01" && value <= today ? value : undefined;
}

/** The account row this site's member may read and change, the same way accountProfile finds it. */
async function ownRow(siteId: string, userId: string): Promise<{ id: string; birth_date: string | null } | null> {
  const db = await getDb();
  const shared = getTenantContext()?.userMode === "shared";
  const rows = await db.query<{ id: string; birth_date: string | null }>(
    shared
      ? `SELECT u.id, u.birth_date FROM users u
         JOIN sites home ON home.id = u.site_id
         JOIN sites current_site ON current_site.tenant_id = home.tenant_id AND current_site.id = ?
         LEFT JOIN site_memberships m ON m.user_id = u.id AND m.site_id = current_site.id
         WHERE u.id = ? AND (u.site_id = current_site.id OR m.user_id IS NOT NULL) LIMIT 1`
      : "SELECT id, birth_date FROM users WHERE site_id = ? AND id = ? LIMIT 1",
    [siteId, userId],
  );
  return rows[0] ?? null;
}

export async function readPersonal(siteId: string, userId: string): Promise<PersonalDetails | null> {
  const row = await ownRow(siteId, userId);
  return row ? { birthDate: row.birth_date || null } : null;
}

/** Save the member's own details. Answers whether anything changed. */
export async function savePersonal(siteId: string, userId: string, details: PersonalDetails): Promise<{ found: boolean; changed: boolean }> {
  const row = await ownRow(siteId, userId);
  if (!row) return { found: false, changed: false };
  if ((row.birth_date || null) === details.birthDate) return { found: true, changed: false };
  const db = await getDb();
  await db.run("UPDATE users SET birth_date = ?, updated_at = ? WHERE id = ?", [details.birthDate, new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, ""), row.id]);
  return { found: true, changed: true };
}
