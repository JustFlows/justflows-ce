// SPDX-License-Identifier: MIT

import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { CORE_RELEASE_PUBLIC_KEYS } from "../extensions/package-trust.js";
import { compareCoreVersions, parseCoreVersion } from "../updates/core-release-check.js";

/**
 * Signed security advisories.
 *
 * The feed is authenticated, not just fetched over TLS: the gateway is a hop this
 * code does not trust to say "nothing is wrong". The envelope is stored as
 * received and verified on every read, so a stored feed goes stale by itself. A
 * tampered, expired, or missing feed is never reported as clear.
 *
 * The URL is hard-coded for the reason given in core-release-check.ts.
 */
const ADVISORIES_URL = "https://api.justflows.com/v1/security/advisories";
const FETCH_TIMEOUT_MS = 10_000;

/** Larger than any plausible feed. Bounds what a bad gateway can make us store. */
export const MAX_ADVISORY_ENVELOPE_BYTES = 256 * 1024;

const SETTING_KEY = "security.advisory_feed";
const SEVERITIES = ["low", "medium", "high", "critical"] as const;

export type AdvisorySeverity = (typeof SEVERITIES)[number];
export type AdvisoryPackageType = "core" | "plugin" | "theme";

export interface AdvisoryRange {
  /** First affected version, inclusive. Null means every earlier version. */
  introduced: string | null;
  /** First unaffected version. Null means no fix exists yet. */
  fixed: string | null;
}

export interface Advisory {
  id: string;
  severity: AdvisorySeverity;
  title: string;
  url: string;
  type: AdvisoryPackageType;
  packageId: string;
  ranges: AdvisoryRange[];
  /** The publisher withdrew these versions. Operators should stop running them. */
  revoked: boolean;
}

export interface AdvisoryFeed {
  sequence: number;
  issuedAt: string;
  expiresAt: string;
  advisories: Advisory[];
}

export interface AdvisoryEnvelope {
  payload: string;
  signature: string;
}

export interface InstalledPackage {
  type: AdvisoryPackageType;
  id: string;
  version: string;
}

export interface AdvisoryMatch {
  advisory: Advisory;
  installedVersion: string;
  fixedVersion: string | null;
}

export type AdvisoryFeedState =
  | { state: "unavailable" }
  | { state: "expired"; feed: AdvisoryFeed }
  | { state: "current"; feed: AdvisoryFeed };

/** Bytes the signature covers. The prefix keeps it from ever matching a release signature. */
export function advisorySignPayload(payload: string): Buffer {
  const digest = createHash("sha256").update(payload, "utf8").digest("hex");
  return Buffer.from(`justflows-advisories\n${digest}`, "utf8");
}

function validRange(value: unknown): value is AdvisoryRange {
  const range = value as AdvisoryRange | null;
  if (!range || typeof range !== "object") return false;
  const version = (item: unknown) => item === null || (typeof item === "string" && parseCoreVersion(item) !== null);
  return version(range.introduced) && version(range.fixed);
}

function validAdvisory(value: unknown): value is Advisory {
  const item = value as Advisory | null;
  return (
    !!item &&
    typeof item === "object" &&
    typeof item.id === "string" &&
    item.id.length > 0 &&
    SEVERITIES.includes(item.severity) &&
    typeof item.title === "string" &&
    typeof item.url === "string" &&
    item.url.startsWith("https://") &&
    (item.type === "core" || item.type === "plugin" || item.type === "theme") &&
    typeof item.packageId === "string" &&
    item.packageId.length > 0 &&
    Array.isArray(item.ranges) &&
    item.ranges.length > 0 &&
    item.ranges.every(validRange) &&
    typeof item.revoked === "boolean"
  );
}

function parseFeed(payload: string): AdvisoryFeed | null {
  try {
    const feed = JSON.parse(payload) as AdvisoryFeed;
    if (!Number.isSafeInteger(feed.sequence) || feed.sequence < 0) return null;
    if (Number.isNaN(Date.parse(feed.issuedAt)) || Number.isNaN(Date.parse(feed.expiresAt))) return null;
    if (!Array.isArray(feed.advisories) || !feed.advisories.every(validAdvisory)) return null;
    return feed;
  } catch {
    return null;
  }
}

function signatureMatches(envelope: AdvisoryEnvelope, publicKeys: readonly string[]): boolean {
  const message = advisorySignPayload(envelope.payload);
  const signature = Buffer.from(envelope.signature, "base64");
  return publicKeys.some((pem) => {
    try {
      return verifySignature(null, message, createPublicKey(pem), signature);
    } catch {
      return false;
    }
  });
}

/** Authenticate an envelope and report whether it is still fresh. */
export function readAdvisoryEnvelope(
  envelope: unknown,
  now = new Date(),
  publicKeys: readonly string[] = CORE_RELEASE_PUBLIC_KEYS,
): AdvisoryFeedState {
  const candidate = envelope as AdvisoryEnvelope | null;
  if (typeof candidate?.payload !== "string" || typeof candidate.signature !== "string") {
    return { state: "unavailable" };
  }
  if (!signatureMatches(candidate, publicKeys)) return { state: "unavailable" };
  const feed = parseFeed(candidate.payload);
  if (!feed) return { state: "unavailable" };
  return { state: Date.parse(feed.expiresAt) > now.getTime() ? "current" : "expired", feed };
}

function rangeContains(range: AdvisoryRange, version: string): boolean {
  const installed = parseCoreVersion(version);
  /** A version this code cannot compare is reported, not assumed safe. */
  if (!installed) return true;
  const introduced = range.introduced ? parseCoreVersion(range.introduced) : null;
  const fixed = range.fixed ? parseCoreVersion(range.fixed) : null;
  if (introduced && compareCoreVersions(installed, introduced) < 0) return false;
  return !fixed || compareCoreVersions(installed, fixed) < 0;
}

/** Advisories that apply to what is installed, most severe first. */
export function matchAdvisories(feed: AdvisoryFeed, installed: readonly InstalledPackage[]): AdvisoryMatch[] {
  const matches: AdvisoryMatch[] = [];
  for (const advisory of feed.advisories) {
    const item = installed.find((pkg) => pkg.type === advisory.type && pkg.id === advisory.packageId);
    if (!item) continue;
    const range = advisory.ranges.find((candidate) => rangeContains(candidate, item.version));
    if (range) matches.push({ advisory, installedVersion: item.version, fixedVersion: range.fixed });
  }
  return matches.sort(
    (a, b) => SEVERITIES.indexOf(b.advisory.severity) - SEVERITIES.indexOf(a.advisory.severity),
  );
}

async function requestEnvelope(): Promise<unknown> {
  const res = await fetch(ADVISORIES_URL, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Advisory feed responded ${res.status}`);
  const text = await res.text();
  if (Buffer.byteLength(text, "utf8") > MAX_ADVISORY_ENVELOPE_BYTES) {
    throw new Error("Advisory feed is too large");
  }
  return JSON.parse(text);
}

/**
 * Whether a fetched envelope may replace the stored one.
 *
 * It must be authentic and not older than what is stored, so a replayed feed
 * cannot hide an advisory. An expired feed is refused too: storing it would
 * replace evidence with nothing newer.
 */
export function shouldStoreEnvelope(
  incoming: unknown,
  stored: unknown,
  now = new Date(),
  publicKeys: readonly string[] = CORE_RELEASE_PUBLIC_KEYS,
): boolean {
  const next = readAdvisoryEnvelope(incoming, now, publicKeys);
  if (next.state !== "current") return false;
  const previous = readAdvisoryEnvelope(stored, now, publicKeys);
  return previous.state === "unavailable" || next.feed.sequence >= previous.feed.sequence;
}

/** Fetch the feed and keep it if it is authentic and current. Failures keep what is stored. */
export async function refreshAdvisoryFeed(siteId: string): Promise<void> {
  const { getSiteSetting, setSiteSetting } = await import("../settings/site-settings.js");
  const incoming = await requestEnvelope();
  const stored = await getSiteSetting<unknown>(siteId, SETTING_KEY);
  if (shouldStoreEnvelope(incoming, stored)) await setSiteSetting(siteId, SETTING_KEY, incoming);
}

/** The stored feed, verified again. Does not touch the network. */
export async function loadAdvisoryFeed(siteId: string): Promise<AdvisoryFeedState> {
  const { getSiteSetting } = await import("../settings/site-settings.js");
  return readAdvisoryEnvelope(await getSiteSetting<unknown>(siteId, SETTING_KEY));
}

const REFRESH_JOB = "security.advisories-refresh";
const BOOT_DELAY_MS = 60_000;

/** Runs shortly after boot, then every six hours. */
export async function startAdvisoryRefreshJob(): Promise<void> {
  const { registerCoreJob } = await import("../jobs/core-jobs.js");
  const { getSiteId } = await import("../settings/site-settings.js");
  registerCoreJob(
    {
      name: REFRESH_JOB,
      schedule: "23 */6 * * *",
      handler: async () => {
        try {
          const siteId = await getSiteId();
          if (siteId) await refreshAdvisoryFeed(siteId);
          return { success: true };
        } catch (err) {
          console.error("[justflows] Advisory feed refresh failed:", String(err).replace(/\n/g, " "));
          return { success: false, message: "Advisory feed refresh failed" };
        }
      },
    },
    { runAfterMs: BOOT_DELAY_MS },
  );
}
