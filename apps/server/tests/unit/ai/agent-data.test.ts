// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from "vitest";
import { REDACTED, safeAgentData, safeAgentText } from "../../../src/lib/ai/agent-data.js";

afterEach(() => vi.unstubAllEnvs());

describe("agent data security boundary", () => {
  it("preserves ordinary site content while redacting nested credentials", () => {
    expect(
      safeAgentData({
        title: "Hello",
        fields: { apiKey: "test-key", nested: [{ password_hash: "hash" }] },
      }),
    ).toEqual({
      title: "Hello",
      fields: { apiKey: REDACTED, nested: [{ password_hash: REDACTED }] },
    });
  });
  it("blocks settings rows and JSON encoded plugin results", () => {
    expect(
      safeAgentData([
        { key: "smtp_pass", value: "private" },
        { name: "access_token", value: "private" },
      ]),
    ).toEqual([REDACTED, REDACTED]);
    expect(safeAgentData('{"credential":"private","title":"Hello"}')).toBe(
      JSON.stringify({ credential: REDACTED, title: "Hello" }),
    );
  });
  it.each([
    "DATABASE_URL=postgres://user:password@example.test/db",
    "export SMTP_PASSWORD=private",
    "Read /app/.env.production: contents here",
    "-----BEGIN RSA PRIVATE KEY-----\nprivate",
    "Authorization: Bearer private-token",
    "mysql://user:password@example.test/db",
  ])("blocks sensitive text: %s", (text) => {
    expect(safeAgentText(text)).toBe(REDACTED);
  });
  it("blocks installation secrets under innocuous field names", () => {
    vi.stubEnv("JWT_SECRET", "installation-secret-example");
    expect(safeAgentData({ text: "Here is installation-secret-example" })).toEqual({
      text: REDACTED,
    });
  });
  it("inspects toJSON and fails closed on binary and cyclic output", () => {
    expect(safeAgentData({ toJSON: () => ({ privateKey: "private" }) })).toEqual({
      privateKey: REDACTED,
    });
    expect(safeAgentData(Buffer.from("private"))).toBe(REDACTED);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(safeAgentData(cyclic)).toBe(REDACTED);
  });
});
