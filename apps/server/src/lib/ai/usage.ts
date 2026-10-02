// SPDX-License-Identifier: MIT

import { getDb } from "../database/db.js";
import { getAiUserDailyLimit } from "./ai-settings.js";

/**
 * Per-user daily assistant usage: requests (for the optional daily limit) and
 * tokens (shown to the user). Days are UTC.
 */

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface DailyUsage {
  day: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  limit: number | null;
}

export async function getDailyUsage(siteId: string, userId: string): Promise<DailyUsage> {
  const day = today();
  const [rows, limit] = await Promise.all([
    (await getDb()).query<Record<string, unknown>>(
      "SELECT requests, input_tokens, output_tokens FROM ai_usage_daily WHERE user_id = ? AND usage_day = ? AND site_id = ? LIMIT 1",
      [userId, day, siteId],
    ),
    getAiUserDailyLimit(),
  ]);
  const row = rows[0];
  return {
    day,
    requests: Number(row?.requests ?? 0),
    inputTokens: Number(row?.input_tokens ?? 0),
    outputTokens: Number(row?.output_tokens ?? 0),
    limit,
  };
}

/** Whether the user may make another assistant request today. */
export async function withinDailyLimit(siteId: string, userId: string): Promise<boolean> {
  const usage = await getDailyUsage(siteId, userId);
  return usage.limit === null || usage.requests < usage.limit;
}

export async function recordUsage(
  siteId: string,
  userId: string,
  delta: { requests?: number; inputTokens?: number; outputTokens?: number },
): Promise<void> {
  const db = await getDb();
  const day = today();
  const requests = delta.requests ?? 0;
  const input = delta.inputTokens ?? 0;
  const output = delta.outputTokens ?? 0;
  try {
    const changed = await db.execute(
      "UPDATE ai_usage_daily SET requests = requests + ?, input_tokens = input_tokens + ?, output_tokens = output_tokens + ? WHERE user_id = ? AND usage_day = ?",
      [requests, input, output, userId, day],
    );
    if (changed === 0) {
      await db.run(
        "INSERT INTO ai_usage_daily (site_id, user_id, usage_day, requests, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?, ?)",
        [siteId, userId, day, requests, input, output],
      );
    }
  } catch {
    // A concurrent first insert of the day: retry the update once.
    await db
      .run(
        "UPDATE ai_usage_daily SET requests = requests + ?, input_tokens = input_tokens + ?, output_tokens = output_tokens + ? WHERE user_id = ? AND usage_day = ?",
        [requests, input, output, userId, day],
      )
      .catch(() => undefined);
  }
}
