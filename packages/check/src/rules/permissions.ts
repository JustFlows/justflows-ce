// SPDX-License-Identifier: MIT

import { requiredPermissionForHook, SENSITIVE_PERMISSIONS } from "@justflows/sdk";
import type { CheckTarget, Rule } from "../types.js";
import { finding, matches, permissions, scannedCodeFiles } from "./util.js";

/**
 * Plugin API calls the host refuses without a manifest permission. Matched on
 * the call shape (`.users.create(`), whatever the context variable is named.
 * Mirrors the checks in the plugin loader and runtime.
 */
export const API_PERMISSIONS: ReadonlyArray<{ pattern: RegExp; permission: string; alternatives?: string[]; api: string }> = [
  { pattern: /\.users\.(create|addRole|removeRole|sendPasswordSetup|delete|updateProfile|get)\s*\(/g, permission: "users:manage", api: "ctx.users (manage)" },
  { pattern: /\.users\.(find|search)\s*\(/g, permission: "users:read", alternatives: ["users:manage"], api: "ctx.users.find/search" },
  { pattern: /\.content\.(ensureType|ensurePage)\s*\(/g, permission: "content:create", api: "ctx.content.ensureType/ensurePage" },
  { pattern: /\.content\.(deleteType|deletePages|deleteCreatedBy)\s*\(/g, permission: "content:delete", api: "ctx.content (delete)" },
  { pattern: /\.content\.(listPublished|getPublished)\s*\(/g, permission: "content:read", api: "ctx.content (read)" },
  { pattern: /\.files\.(put|get|read|delete|list)\s*\(/g, permission: "files:private", api: "ctx.files" },
  { pattern: /\.jobs\.(register|enqueue)\s*\(/g, permission: "jobs:register", api: "ctx.jobs" },
  { pattern: /\.mail\.send\s*\(/g, permission: "mail:send", api: "ctx.mail.send" },
  { pattern: /\.mail\.register\s*\(/g, permission: "mail:transport", api: "ctx.mail.register" },
  { pattern: /\.mail\.registerTemplate\s*\(/g, permission: "mail:templates", api: "ctx.mail.registerTemplate" },
  { pattern: /\.outbound\.fetch\s*\(/g, permission: "network:outbound", api: "ctx.outbound.fetch" },
  { pattern: /\.tenancy\.(siblingSites|listWorkspaces|listSites|createWorkspace|addSite|suspend|reactivate|deleteWorkspace)\s*\(/g, permission: "platform:tenancy", api: "ctx.tenancy" },
  { pattern: /\.quotas\.set\s*\(/g, permission: "platform:tenancy", api: "ctx.quotas.set" },
  { pattern: /\.network\.(sites|site|mainSiteSettings|mainSiteSecrets)\b/g, permission: "platform:network", api: "ctx.network" },
  { pattern: /\.diagnostics\.register\s*\(/g, permission: "diagnostics:publish", api: "ctx.diagnostics.register" },
  { pattern: /\.cache\.registerStore\s*\(/g, permission: "cache:store", api: "ctx.cache.registerStore" },
  { pattern: /\.visibility\.registerRule\s*\(/g, permission: "content:read", api: "ctx.visibility.registerRule" },
];

const HOOK_CALL = /\.(?:action|filter|gate|on)\s*\(\s*["'`]([a-zA-Z0-9_.:-]+)["'`]/g;
const NETWORK_HOOK_OPTION = /network\s*:\s*true/g;

interface Usage {
  permission: string;
  alternatives?: string[] | undefined;
  reason: string;
  file: string;
  line: number;
}

/** Permissions the plugin's code needs, with where each need comes from. */
export function permissionUsage(target: CheckTarget): Usage[] {
  const usages: Usage[] = [];
  for (const file of scannedCodeFiles(target)) {
    for (const { pattern, permission, alternatives, api } of API_PERMISSIONS) {
      for (const { line } of matches(file, pattern)) usages.push({ permission, alternatives, reason: api, file: file.path, line });
    }
    for (const { match, line } of matches(file, HOOK_CALL)) {
      const hook = match[1]!;
      const permission = requiredPermissionForHook(hook);
      if (permission) usages.push({ permission, reason: `hook "${hook}"`, file: file.path, line });
    }
    for (const { line } of matches(file, NETWORK_HOOK_OPTION)) {
      usages.push({ permission: "platform:network", reason: "a { network: true } hook", file: file.path, line });
    }
  }
  return usages;
}

/** Permissions a manifest feature needs; they count as used. */
function manifestUsage(target: CheckTarget): Set<string> {
  const used = new Set<string>();
  const manifest = target.manifest ?? {};
  if ((Array.isArray(manifest.adminMenu) && manifest.adminMenu.length) || manifest.adminApp || manifest.setupPath) used.add("admin:extend");
  if (Array.isArray(manifest.contentTypes) && manifest.contentTypes.length) used.add("content:delete");
  return used;
}

/** Permissions this checker cannot see being used from code alone. */
const NOT_DETECTABLE = new Set([
  "admin:extend",
  "settings:read",
  "settings:manage",
  "media:read",
  "media:upload",
  "media:delete",
  "content:update",
  "content:publish",
  "content:revisions:read",
  "content:revisions:restore",
  "content:revisions:discard",
  "mail:hook",
  "auth:hook",
  "network:outbound",
]);

export const permissionRules: Rule[] = [
  {
    id: "JF-P001",
    title: "Code only uses APIs its manifest has permission for",
    category: "permissions",
    severity: "error",
    types: ["plugin"],
    check: (target) => {
      const granted = permissions(target);
      const seen = new Set<string>();
      return permissionUsage(target)
        .filter((usage) => !granted.has(usage.permission) && !(usage.alternatives ?? []).some((name) => granted.has(name)))
        .filter((usage) => {
          const key = `${usage.permission}|${usage.reason}|${usage.file}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((usage) => finding(`${usage.reason} needs the "${usage.permission}" permission, which the manifest does not declare`, usage.file, usage.line));
    },
  },
  {
    id: "JF-P002",
    title: "Every declared permission is used",
    category: "permissions",
    severity: "warning",
    types: ["plugin"],
    check: (target) => {
      const used = new Set([...permissionUsage(target).flatMap((usage) => [usage.permission, ...(usage.alternatives ?? [])]), ...manifestUsage(target)]);
      if (target.mode === "package" && !scannedCodeFiles(target).length) return [];
      return [...permissions(target)]
        .filter((permission) => !used.has(permission) && !NOT_DETECTABLE.has(permission))
        .map((permission) => finding(`"${permission}" is declared but no code was found that needs it. Remove it unless it is used in a way this check cannot see.`, "justflows.json"));
    },
  },
  {
    id: "JF-P003",
    title: "Sensitive permissions are explained in the listing",
    category: "permissions",
    severity: "info",
    types: ["plugin"],
    check: (target) => {
      const sensitive = new Set<string>(SENSITIVE_PERMISSIONS);
      return [...permissions(target)]
        .filter((permission) => sensitive.has(permission))
        .map((permission) => finding(`"${permission}" is a sensitive permission: say in the listing why the plugin needs it`, "justflows.json"));
    },
  },
];
