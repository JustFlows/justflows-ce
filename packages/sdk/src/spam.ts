// SPDX-License-Identifier: MIT

/**
 * Input handed to an external spam-scoring service. Kept to what a
 * moderation call actually needs — no revision history, no session data, no
 * secrets. A backend should not persist more of this than its own scoring
 * requires.
 */
export interface SpamCheckInput {
  siteId: string;
  contentId: string;
  ip: string;
  userAgent: string;
  authorName: string;
  authorEmail: string;
  authorUrl: string;
  body: string;
  links: string[];
  isAuthenticated: boolean;
}

export interface SpamCheckResult {
  verdict: "allow" | "spam" | "review";
  /** Optional 0-100 confidence; the host's own thresholds still decide the outcome. */
  score?: number;
  reason?: string;
}

/** Optional external spam-scoring service (Akismet-style). The host remains authoritative. */
export interface SpamCheckBackend {
  id: string;
  check(input: SpamCheckInput): Promise<SpamCheckResult>;
}
