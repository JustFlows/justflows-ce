// SPDX-License-Identifier: MIT

import { z } from "zod";
import { disposableEmailDomains } from "./disposable-email-domains.js";

const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const entrySchema = z.string().trim().toLowerCase().max(320).refine(
  (entry) => entry.includes("@") ? z.string().email().safeParse(entry).success : domainPattern.test(entry),
  "Use an email address or a domain such as example.com (no wildcards).",
);
export const SignupEmailPolicySchema = z.object({
  blockDisposable: z.boolean(),
  allowListedOnly: z.boolean(),
  allow: z.array(entrySchema).max(1000).transform((entries) => [...new Set(entries)]),
  block: z.array(entrySchema).max(1000).transform((entries) => [...new Set(entries)]),
}).refine((policy) => !policy.allowListedOnly || policy.allow.length > 0, {
  message: "Add at least one allowed email address or domain before enabling allow listed only.",
});
export type SignupEmailPolicy = z.infer<typeof SignupEmailPolicySchema>;
export function defaultSignupEmailPolicy(): SignupEmailPolicy {
  return { blockDisposable: false, allowListedOnly: false, allow: [], block: [] };
}

// Domain entries include subdomains, with a dot boundary to avoid suffix lookalikes.
function matches(entries: ReadonlySet<string>, email: string, domain: string): boolean {
  if (entries.has(email)) return true;
  let candidate = domain;
  while (candidate.includes(".")) {
    if (entries.has(candidate)) return true;
    candidate = candidate.slice(candidate.indexOf(".") + 1);
  }
  return false;
}
export function signupEmailAllowed(email: string, policy: SignupEmailPolicy): boolean {
  const normalized = email.trim().toLowerCase();
  if (!z.string().email().safeParse(normalized).success) return false;
  const domain = normalized.slice(normalized.lastIndexOf("@") + 1);
  if (matches(new Set(policy.block), normalized, domain)) return false;
  const allowed = matches(new Set(policy.allow), normalized, domain);
  if (policy.allowListedOnly && !allowed) return false;
  return allowed || !policy.blockDisposable || !matches(disposableEmailDomains, normalized, domain);
}
