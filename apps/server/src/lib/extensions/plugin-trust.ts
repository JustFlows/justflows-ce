// SPDX-License-Identifier: MIT

import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { CORE_RELEASE_PUBLIC_KEYS } from "./package-trust.js";

/**
 * Plugin trust state (justflows-ce#270).
 *
 * Every installed plugin has one of four states:
 *
 * - `verified`: this exact release (id, version, and archive digest) passed the
 *   Justflows review and is listed in the signed attestation feed.
 * - `operator`: a self-hosting administrator trusted this exact digest of their
 *   own build. Never available on a multisite network.
 * - `legacy`: installed before trust states existed and not changed since. It
 *   keeps running as before until the grace deadline.
 * - `unverified`: everything else, including every new install and update that
 *   has no attestation.
 *
 * Verified is read only from the signed feed, never from anything the
 * publisher controls, and it binds one archive digest, so an update starts
 * unverified. The feed is verified again on every read. A missing, tampered, or
 * expired feed verifies nothing (fail closed). A release the signed advisory
 * feed marks as revoked is unverified whatever else applies.
 *
 * Verified means the release passed the review in docs/EXTENSION-REVIEW.md. It
 * is not a guarantee of safety. Until the plugin sandbox ships, every state
 * still runs in the server process; this module records and reports the state.
 */

const ATTESTATIONS_URL = "https://api.justflows.com/v1/security/attestations";
const FETCH_TIMEOUT_MS = 10_000;
export const MAX_ATTESTATION_ENVELOPE_BYTES = 1024 * 1024;
const MAX_ATTESTATIONS = 5000;

export const ATTESTATION_FEED_SETTING_KEY = "security.attestation_feed";
export const PLUGIN_TRUST_SETTING_KEY = "security.plugin_trust";
export const PLUGIN_TRUST_STATES_SETTING_KEY = "security.plugin_trust_states";

/** How long a plugin installed before trust states existed keeps legacy trust. */
export const LEGACY_GRACE_DAYS = 90;
/** Operator-trusted digests kept per installation. */
const MAX_OPERATOR_TRUSTED = 100;

/**
 * Set on a plugin row whenever its package is written by this release or a
 * later one. A row without it was installed before trust states existed and is
 * unchanged since, which is what legacy trust covers.
 */
export const PACKAGE_RECORDED_AT_KEY = "packageRecordedAt";

const PACKAGE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,80}$/;
const DIGEST_RE = /^[a-f0-9]{64}$/;

export type PluginTrustState = "verified" | "operator" | "legacy" | "unverified";

export interface Attestation {
  type: "plugin";
  packageId: string;
  version: string;
  archiveDigest: string;
  /** Which review requirements the release passed, for example "extension-review-1". */
  review: string;
  issuedAt: string;
}

export interface AttestationFeed {
  sequence: number;
  issuedAt: string;
  expiresAt: string;
  attestations: Attestation[];
}

export interface AttestationEnvelope {
  payload: string;
  signature: string;
}

export type AttestationFeedState =
  | { state: "unavailable" }
  | { state: "expired"; feed: AttestationFeed }
  | { state: "current"; feed: AttestationFeed };

/** Bytes the signature covers. The prefix keeps it from matching a release or advisory signature. */
export function attestationSignPayload(payload: string): Buffer {
  const digest = createHash("sha256").update(payload, "utf8").digest("hex");
  return Buffer.from(`justflows-attestations\n${digest}`, "utf8");
}

function validAttestation(value: unknown): value is Attestation {
  const item = value as Attestation | null;
  return (
    !!item &&
    typeof item === "object" &&
    item.type === "plugin" &&
    typeof item.packageId === "string" &&
    PACKAGE_ID_RE.test(item.packageId) &&
    typeof item.version === "string" &&
    VERSION_RE.test(item.version) &&
    typeof item.archiveDigest === "string" &&
    DIGEST_RE.test(item.archiveDigest) &&
    typeof item.review === "string" &&
    item.review.length > 0 &&
    item.review.length <= 100 &&
    typeof item.issuedAt === "string" &&
    !Number.isNaN(Date.parse(item.issuedAt))
  );
}

function parseFeed(payload: string): AttestationFeed | null {
  try {
    const feed = JSON.parse(payload) as AttestationFeed;
    if (!Number.isSafeInteger(feed.sequence) || feed.sequence < 0) return null;
    if (Number.isNaN(Date.parse(feed.issuedAt)) || Number.isNaN(Date.parse(feed.expiresAt))) return null;
    if (!Array.isArray(feed.attestations) || feed.attestations.length > MAX_ATTESTATIONS) return null;
    if (!feed.attestations.every(validAttestation)) return null;
    return feed;
  } catch {
    return null;
  }
}

function signatureMatches(envelope: AttestationEnvelope, publicKeys: readonly string[]): boolean {
  const message = attestationSignPayload(envelope.payload);
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
export function readAttestationEnvelope(
  envelope: unknown,
  now = new Date(),
  publicKeys: readonly string[] = CORE_RELEASE_PUBLIC_KEYS,
): AttestationFeedState {
  const candidate = envelope as AttestationEnvelope | null;
  if (typeof candidate?.payload !== "string" || typeof candidate.signature !== "string") return { state: "unavailable" };
  if (Buffer.byteLength(candidate.payload, "utf8") > MAX_ATTESTATION_ENVELOPE_BYTES) return { state: "unavailable" };
  if (!signatureMatches(candidate, publicKeys)) return { state: "unavailable" };
  const feed = parseFeed(candidate.payload);
  if (!feed) return { state: "unavailable" };
  return { state: Date.parse(feed.expiresAt) > now.getTime() ? "current" : "expired", feed };
}

/** A fetched envelope may replace the stored one only when authentic, current, and not older. */
export function shouldStoreAttestationEnvelope(
  incoming: unknown,
  stored: unknown,
  now = new Date(),
  publicKeys: readonly string[] = CORE_RELEASE_PUBLIC_KEYS,
): boolean {
  const next = readAttestationEnvelope(incoming, now, publicKeys);
  if (next.state !== "current") return false;
  const previous = readAttestationEnvelope(stored, now, publicKeys);
  return previous.state === "unavailable" || next.feed.sequence >= previous.feed.sequence;
}

export interface OperatorTrust {
  packageId: string;
  archiveDigest: string;
  trustedAt: string;
  trustedBy: string;
}

export interface PluginTrustPolicy {
  /** When this installation first ran with trust states. */
  legacySince: string | null;
  operatorTrusted: OperatorTrust[];
}

export function normalizePluginTrustPolicy(raw: unknown): PluginTrustPolicy {
  const value = (raw ?? {}) as Partial<PluginTrustPolicy>;
  const since = typeof value.legacySince === "string" && !Number.isNaN(Date.parse(value.legacySince)) ? value.legacySince : null;
  const trusted = Array.isArray(value.operatorTrusted)
    ? value.operatorTrusted.filter(
        (item): item is OperatorTrust =>
          !!item &&
          typeof item.packageId === "string" &&
          PACKAGE_ID_RE.test(item.packageId) &&
          typeof item.archiveDigest === "string" &&
          DIGEST_RE.test(item.archiveDigest) &&
          typeof item.trustedAt === "string" &&
          typeof item.trustedBy === "string",
      )
    : [];
  return { legacySince: since, operatorTrusted: trusted.slice(0, MAX_OPERATOR_TRUSTED) };
}

export function legacyDeadline(policy: PluginTrustPolicy): string | null {
  if (!policy.legacySince) return null;
  return new Date(Date.parse(policy.legacySince) + LEGACY_GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export interface InstalledPluginIdentity {
  pluginId: string;
  version: string;
  /** Digest of the archive the plugin was installed from. Null for a source checkout or a missing baseline. */
  archiveDigest: string | null;
  /** False for a row installed before trust states existed and unchanged since. */
  recordedSinceTrust: boolean;
}

export interface PluginTrustInput {
  plugin: InstalledPluginIdentity;
  attestations: AttestationFeedState;
  /** The signed advisory feed marks this exact version as revoked. */
  revoked: boolean;
  policy: PluginTrustPolicy;
  /** Operator trust is only honoured on a single-site installation. */
  operatorTrustAllowed: boolean;
  now: Date;
}

export interface PluginTrust {
  state: PluginTrustState;
  /** Why the state applies, for the admin and the audit log. */
  reason:
    | "attested"
    | "operatorTrusted"
    | "legacy"
    | "revoked"
    | "noDigest"
    | "noAttestation"
    | "attestationsUnavailable"
    | "legacyExpired";
  archiveDigest: string | null;
  review?: string;
  legacyUntil?: string;
  trustedAt?: string;
}

/** Decide one plugin's trust state. Pure: reads nothing. */
export function resolvePluginTrust(input: PluginTrustInput): PluginTrust {
  const { plugin, attestations, policy, now } = input;
  const digest = plugin.archiveDigest;
  if (input.revoked) return { state: "unverified", reason: "revoked", archiveDigest: digest };
  if (digest && attestations.state === "current") {
    const match = attestations.feed.attestations.find(
      (item) => item.packageId === plugin.pluginId && item.version === plugin.version && item.archiveDigest === digest,
    );
    if (match) return { state: "verified", reason: "attested", archiveDigest: digest, review: match.review };
  }
  if (digest && input.operatorTrustAllowed) {
    const trusted = policy.operatorTrusted.find((item) => item.packageId === plugin.pluginId && item.archiveDigest === digest);
    if (trusted) return { state: "operator", reason: "operatorTrusted", archiveDigest: digest, trustedAt: trusted.trustedAt };
  }
  const until = legacyDeadline(policy);
  if (!plugin.recordedSinceTrust && until) {
    if (now.getTime() < Date.parse(until)) return { state: "legacy", reason: "legacy", archiveDigest: digest, legacyUntil: until };
    return { state: "unverified", reason: "legacyExpired", archiveDigest: digest, legacyUntil: until };
  }
  if (!digest) return { state: "unverified", reason: "noDigest", archiveDigest: null };
  return {
    state: "unverified",
    reason: attestations.state === "current" ? "noAttestation" : "attestationsUnavailable",
    archiveDigest: digest,
  };
}

/* ------------------------------------------------------------------------- */
/* Storage and the feed                                                       */
/* ------------------------------------------------------------------------- */

/** The installation's main site holds installation-wide trust records. */
async function trustSiteId(): Promise<string | null> {
  const { installationRootSiteId } = await import("../tenancy/registry.js");
  const root = await installationRootSiteId().catch(() => null);
  if (root) return root;
  const { getSiteId } = await import("../settings/site-settings.js");
  return (await getSiteId()) ?? null;
}

/** Read and write the installation-wide records on the installation database. */
async function onInstallation<T>(fn: (siteId: string) => Promise<T>): Promise<T | null> {
  const siteId = await trustSiteId();
  if (!siteId) return null;
  const { getControlDb, runWithDatabase } = await import("../database/db.js");
  const control = await getControlDb();
  return runWithDatabase(control, () => fn(siteId));
}

export async function getPluginTrustPolicy(): Promise<PluginTrustPolicy> {
  const { getSiteSetting } = await import("../settings/site-settings.js");
  return (await onInstallation(async (siteId) => normalizePluginTrustPolicy(await getSiteSetting(siteId, PLUGIN_TRUST_SETTING_KEY)))) ?? normalizePluginTrustPolicy(null);
}

async function savePluginTrustPolicy(policy: PluginTrustPolicy): Promise<void> {
  const { setSiteSetting } = await import("../settings/site-settings.js");
  const saved = await onInstallation(async (siteId) => {
    await setSiteSetting(siteId, PLUGIN_TRUST_SETTING_KEY, policy);
    return true;
  });
  if (!saved) throw new Error("No site is installed yet");
}

/** Start the legacy grace period the first time this installation runs with trust states. */
export async function ensureLegacyTrustStarted(now = new Date()): Promise<void> {
  const policy = await getPluginTrustPolicy();
  if (policy.legacySince) return;
  await savePluginTrustPolicy({ ...policy, legacySince: now.toISOString() });
}

export async function loadAttestationFeed(): Promise<AttestationFeedState> {
  const { getSiteSetting } = await import("../settings/site-settings.js");
  return (await onInstallation(async (siteId) => readAttestationEnvelope(await getSiteSetting<unknown>(siteId, ATTESTATION_FEED_SETTING_KEY)))) ?? { state: "unavailable" };
}

async function requestEnvelope(): Promise<unknown> {
  const res = await fetch(ATTESTATIONS_URL, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Attestation feed responded ${res.status}`);
  const text = await res.text();
  if (Buffer.byteLength(text, "utf8") > MAX_ATTESTATION_ENVELOPE_BYTES) throw new Error("Attestation feed is too large");
  return JSON.parse(text);
}

/** Fetch the feed and keep it if it is authentic, current, and not older. Failures keep what is stored. */
export async function refreshAttestationFeed(): Promise<void> {
  const { getSiteSetting, setSiteSetting } = await import("../settings/site-settings.js");
  const incoming = await requestEnvelope();
  await onInstallation(async (siteId) => {
    const stored = await getSiteSetting<unknown>(siteId, ATTESTATION_FEED_SETTING_KEY);
    if (shouldStoreAttestationEnvelope(incoming, stored)) await setSiteSetting(siteId, ATTESTATION_FEED_SETTING_KEY, incoming);
  });
}

const REFRESH_JOB = "security.attestations-refresh";

/** Starts the legacy grace period, then refreshes the feed every six hours. */
export async function startPluginTrustJobs(): Promise<void> {
  await ensureLegacyTrustStarted().catch((err) => {
    console.error("[justflows] Plugin trust could not start its grace period:", String(err).replace(/\n/g, " "));
  });
  const { registerCoreJob } = await import("../jobs/core-jobs.js");
  registerCoreJob(
    {
      name: REFRESH_JOB,
      schedule: "37 */6 * * *",
      handler: async () => {
        try {
          await refreshAttestationFeed();
          return { success: true };
        } catch (err) {
          console.error("[justflows] Attestation feed refresh failed:", String(err).replace(/\n/g, " "));
          return { success: false, message: "Attestation feed refresh failed" };
        }
      },
    },
    { runAfterMs: 90_000 },
  );
}

/** Operator trust is for one self-hosted site: never on a multisite network. */
export async function operatorTrustAllowed(): Promise<boolean> {
  const { multisiteEnabled } = await import("../tenancy/multisite.js");
  return !multisiteEnabled() && process.env.JF_OPERATOR_TRUST !== "off";
}

export class OperatorTrustRefusedError extends Error {}

/** Trust, or stop trusting, the installed digest of one plugin. */
export async function setOperatorTrust(input: { pluginId: string; archiveDigest: string; trusted: boolean; actor: string }): Promise<void> {
  if (!(await operatorTrustAllowed())) throw new OperatorTrustRefusedError("Trusting your own build is not available on this installation");
  if (!PACKAGE_ID_RE.test(input.pluginId) || !DIGEST_RE.test(input.archiveDigest)) throw new OperatorTrustRefusedError("Invalid package");
  const policy = await getPluginTrustPolicy();
  const others = policy.operatorTrusted.filter((item) => !(item.packageId === input.pluginId && item.archiveDigest === input.archiveDigest));
  if (input.trusted && others.length >= MAX_OPERATOR_TRUSTED) throw new OperatorTrustRefusedError("Too many trusted builds");
  const operatorTrusted = input.trusted
    ? [...others, { packageId: input.pluginId, archiveDigest: input.archiveDigest, trustedAt: new Date().toISOString(), trustedBy: input.actor.slice(0, 254) }]
    : others;
  await savePluginTrustPolicy({ ...policy, operatorTrusted });
}

export interface PluginTrustRow extends PluginTrust {
  pluginId: string;
  version: string;
}

/** The plugin's recorded package identity, when its baseline matches the row. */
async function identityOf(row: { plugin_id: string; version: string; manifest: Record<string, unknown> }): Promise<InstalledPluginIdentity> {
  const dir = typeof row.manifest.installedPath === "string" ? row.manifest.installedPath : null;
  let archiveDigest: string | null = null;
  if (dir) {
    const { readInstalledPackageIdentity } = await import("../security/extension-integrity.js");
    const identity = await readInstalledPackageIdentity(dir).catch(() => null);
    if (identity && identity.packageType === "plugin" && identity.packageId === row.plugin_id && identity.version === row.version) {
      archiveDigest = identity.archiveDigest;
    }
  }
  return {
    pluginId: row.plugin_id,
    version: row.version,
    archiveDigest,
    recordedSinceTrust: typeof row.manifest[PACKAGE_RECORDED_AT_KEY] === "string",
  };
}

/** Every plugin on a site with its trust state. */
export async function listPluginTrust(siteId: string, now = new Date()): Promise<PluginTrustRow[]> {
  const { getDb } = await import("../database/db.js");
  const db = await getDb();
  const rows = await db.query<{ plugin_id: string; version: string; manifest: unknown }>(
    "SELECT plugin_id, version, manifest FROM plugins WHERE site_id = ? ORDER BY plugin_id",
    [siteId],
  );
  const [policy, attestations, allowed, revokedIds] = await Promise.all([
    getPluginTrustPolicy(),
    loadAttestationFeed(),
    operatorTrustAllowed(),
    revokedPluginVersions(siteId, rows.map((row) => ({ id: row.plugin_id, version: row.version }))),
  ]);
  const result: PluginTrustRow[] = [];
  for (const row of rows) {
    const manifest = typeof row.manifest === "string" ? (safeJson(row.manifest) ?? {}) : ((row.manifest ?? {}) as Record<string, unknown>);
    const plugin = await identityOf({ plugin_id: row.plugin_id, version: row.version, manifest });
    const trust = resolvePluginTrust({
      plugin,
      attestations,
      revoked: revokedIds.has(`${row.plugin_id}@${row.version}`),
      policy,
      operatorTrustAllowed: allowed,
      now,
    });
    result.push({ pluginId: row.plugin_id, version: row.version, ...trust });
  }
  return result;
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Plugin versions the current signed advisory feed revokes. Unknown feed state revokes nothing. */
async function revokedPluginVersions(siteId: string, plugins: Array<{ id: string; version: string }>): Promise<Set<string>> {
  try {
    const { loadAdvisoryFeed, matchAdvisories } = await import("../security/security-advisories.js");
    const feed = await loadAdvisoryFeed(siteId);
    if (feed.state !== "current") return new Set();
    const matches = matchAdvisories(feed.feed, plugins.map((plugin) => ({ type: "plugin" as const, id: plugin.id, version: plugin.version })));
    return new Set(matches.filter((match) => match.advisory.revoked).map((match) => `${match.advisory.packageId}@${match.installedVersion}`));
  } catch {
    return new Set();
  }
}

/**
 * Record each plugin's state and audit every change. Returns the changes so a
 * caller can report them. A first observation is recorded without an audit.
 */
export async function recordTrustTransitions(
  siteId: string,
  rows: readonly PluginTrustRow[],
): Promise<Array<{ pluginId: string; from: PluginTrustState; to: PluginTrustState; reason: string }>> {
  const { getSiteSetting, setSiteSetting } = await import("../settings/site-settings.js");
  const previous = ((await getSiteSetting<Record<string, PluginTrustState>>(siteId, PLUGIN_TRUST_STATES_SETTING_KEY)) ?? {}) as Record<string, PluginTrustState>;
  const next: Record<string, PluginTrustState> = {};
  const changes: Array<{ pluginId: string; from: PluginTrustState; to: PluginTrustState; reason: string }> = [];
  for (const row of rows) {
    next[row.pluginId] = row.state;
    const before = previous[row.pluginId];
    if (before && before !== row.state) changes.push({ pluginId: row.pluginId, from: before, to: row.state, reason: row.reason });
  }
  if (JSON.stringify(previous) !== JSON.stringify(next)) await setSiteSetting(siteId, PLUGIN_TRUST_STATES_SETTING_KEY, next);
  if (changes.length) {
    const { auditLog } = await import("../security/audit-log.js");
    for (const change of changes) {
      void auditLog({
        siteId,
        action: "extension.trust_changed",
        target: change.pluginId,
        detail: `${change.from} -> ${change.to} (${change.reason})`,
      });
    }
  }
  return changes;
}
