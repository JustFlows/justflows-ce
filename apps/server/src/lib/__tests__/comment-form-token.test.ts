// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCommentFormToken, verifyCommentFormToken } from "../comment-form-token.js";

const item = {
  contentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  siteId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};

afterEach(() => vi.unstubAllEnvs());

describe("comment form token", () => {
  it("roundtrips and reports its issue time", () => {
    vi.stubEnv("APP_SECRET", "a-secret-with-at-least-thirty-two-characters");
    const token = createCommentFormToken(item, 1000);
    expect(verifyCommentFormToken(token, 1001)).toMatchObject({ ...item, issuedAt: 1000 });
  });

  it("expires after 6 hours", () => {
    vi.stubEnv("APP_SECRET", "a-secret-with-at-least-thirty-two-characters");
    const token = createCommentFormToken(item, 1000);
    expect(verifyCommentFormToken(token, 1000 + 6 * 60 * 60_000)).toMatchObject(item);
    expect(verifyCommentFormToken(token, 1000 + 6 * 60 * 60_000 + 1)).toBeNull();
  });

  it("rejects tampering, malformed input, and a changed secret", () => {
    vi.stubEnv("APP_SECRET", "a-secret-with-at-least-thirty-two-characters");
    const token = createCommentFormToken(item);
    expect(verifyCommentFormToken(`x${token}`)).toBeNull();
    expect(verifyCommentFormToken("x".repeat(600))).toBeNull();
    expect(verifyCommentFormToken(undefined)).toBeNull();
    expect(verifyCommentFormToken({})).toBeNull();
    vi.stubEnv("APP_SECRET", "another-secret-with-at-least-thirty-two-characters");
    expect(verifyCommentFormToken(token)).toBeNull();
  });

  it("throws when creating without a usable APP_SECRET, rather than issue a forgeable token", () => {
    vi.stubEnv("APP_SECRET", "");
    expect(() => createCommentFormToken(item)).toThrow();
  });
});
