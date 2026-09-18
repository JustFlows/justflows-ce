// SPDX-License-Identifier: MIT
import { z } from "zod";
export class RedirectValidationError extends Error {}
export const RedirectSchema = z
  .object({
    source: z.string().min(1).max(2048),
    kind: z.enum(["exact", "prefix", "regex"]),
    targetType: z.enum(["internal", "content", "external"]),
    target: z.string().min(1).max(2048),
    status: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]),
    enabled: z.boolean(),
  })
  .strict();
export type RedirectInput = z.infer<typeof RedirectSchema>;
export type RedirectRule = RedirectInput & { id: string };
/** Restricted, non-overlapping captures avoid running arbitrary backtracking regex on requests. */
export function redirectRegex(source: string): RegExp {
  if (source.length > 512 || !source.startsWith("^/") || !source.endsWith("$"))
    throw new RedirectValidationError("Regex must start with ^/ and end with $.");
  let rest = source.slice(1, -1).replace(/\(\.\*\)$/, "CAPTURE");
  rest = rest
    .replace(/\(\[\^\/\]\+\)(?=\/|$)/g, "CAPTURE")
    .replace(/\(\\d\+\)(?=\/|$)/g, "CAPTURE");
  if (!/^\/[a-zA-Z0-9/_%~-]*$/.test(rest) || (source.match(/\(/g)?.length ?? 0) > 9)
    throw new RedirectValidationError(
      "Use literal paths, ([^/]+), (\\d+), and a final (.*) capture only.",
    );
  return new RegExp(source);
}
export function safeRedirectTarget(value: string, external = false): boolean {
  if (!value || value.length > 2048 || /[\s\\\u0000-\u001f\u007f]/.test(value)) return false;
  let decoded = value;
  try {
    for (let i = 0; i < 4; i++) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    return false;
  }
  if (/[\\\u0000-\u0020\u007f]/.test(decoded) || /%[0-9a-f]{2}/i.test(decoded)) return false;
  if (!external)
    return (
      decoded.startsWith("/") &&
      !decoded.startsWith("//") &&
      !decoded
        .split(/[?#]/)[0]!
        .split("/")
        .some((p) => p === "." || p === "..")
    );
  try {
    const url = new URL(value);
    return /^https?:\/\//.test(value) && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}
/** Only the permalink identity query participates in matching. */
export function redirectRequestPath(value: string): string {
  const url = new URL(value, "https://redirect.invalid");
  const identity = url.searchParams.get("p");
  return url.pathname + (identity ? `?p=${encodeURIComponent(identity)}` : "");
}
export function validateRedirect(input: unknown): RedirectInput {
  const parsed = RedirectSchema.safeParse(input);
  if (!parsed.success)
    throw new RedirectValidationError(parsed.error.issues[0]?.message ?? "Invalid redirect.");
  const rule = parsed.data;
  if (rule.kind === "regex") redirectRegex(rule.source);
  else if (
    !safeRedirectTarget(rule.source) ||
    rule.source.includes("#") ||
    (rule.kind === "prefix" && (rule.source.includes("?") || !rule.source.endsWith("/")))
  )
    throw new RedirectValidationError("Use an internal source path; prefixes must end in /.");
  if (rule.kind !== "regex" && redirectRequestPath(rule.source) !== rule.source)
    throw new RedirectValidationError(
      "Only the canonical ?p= content identity query is supported in sources.",
    );
  const captures =
    rule.kind === "prefix"
      ? 1
      : rule.kind === "regex"
        ? (rule.source.match(/\(/g)?.length ?? 0)
        : 0;
  if (
    /\$(?![1-9])/.test(rule.target) ||
    [...rule.target.matchAll(/\$([1-9])/g)].some((m) => Number(m[1]) > captures)
  )
    throw new RedirectValidationError("Target references an unavailable capture group.");
  if (rule.targetType === "content") {
    if (!z.string().uuid().safeParse(rule.target).success)
      throw new RedirectValidationError("Choose a valid content ID.");
  } else {
    if (!safeRedirectTarget(rule.target, rule.targetType === "external"))
      throw new RedirectValidationError(
        "Use a safe internal path or an absolute HTTP(S) URL without credentials.",
      );
    if (rule.targetType === "external" && new URL(rule.target).host.includes("$"))
      throw new RedirectValidationError("External target hosts cannot contain captures.");
  }
  return rule;
}
export function matchRedirect(rule: RedirectRule, path: string): string[] | null {
  if (!rule.enabled || path.length > 2048) return null;
  if (rule.kind === "exact") return path === rule.source ? [] : null;
  const pathname = path.split("?")[0]!;
  if (rule.kind === "prefix")
    return pathname.startsWith(rule.source) ? [pathname.slice(rule.source.length)] : null;
  return redirectRegex(rule.source).exec(pathname)?.slice(1) ?? null;
}
export function orderedRedirects(rules: RedirectRule[]): RedirectRule[] {
  const rank = { exact: 0, prefix: 1, regex: 2 };
  return [...rules].sort(
    (a, b) =>
      Number(a.id.startsWith("history:")) - Number(b.id.startsWith("history:")) ||
      rank[a.kind] - rank[b.kind] ||
      b.source.length - a.source.length ||
      a.id.localeCompare(b.id),
  );
}
export function expandRedirect(rule: RedirectRule, captures: string[]): string {
  return rule.target.replace(/\$([1-9])/g, (_, n: string) => captures[Number(n) - 1] ?? "");
}
const CSV_HEADER = ["source", "kind", "targetType", "target", "status", "enabled"] as const;
export function exportRedirectCsv(rules: RedirectRule[]): string {
  const cell = (s: unknown) => `"${String(s).replace(/"/g, '""')}"`;
  return [
    CSV_HEADER.join(","),
    ...rules.map((r) => CSV_HEADER.map((k) => cell(r[k])).join(",")),
  ].join("\r\n");
}
export function importRedirectCsv(csv: string): RedirectInput[] {
  if (Buffer.byteLength(csv) > 1024 * 1024) throw new RedirectValidationError("CSV exceeds 1 MiB.");
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i]!;
    if (quoted) {
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += ch;
    } else if (ch === '"' && !cell && !closed) quoted = true;
    else if (ch === "," || ch === "\n" || ch === "\r") {
      row.push(cell);
      cell = "";
      closed = false;
      if (ch !== ",") {
        rows.push(row);
        row = [];
        if (ch === "\r" && csv[i + 1] === "\n") i++;
      }
    } else {
      if (closed || ch === '"') throw new RedirectValidationError("Malformed CSV quoting.");
      cell += ch;
    }
  }
  if (quoted) throw new RedirectValidationError("Unterminated CSV field.");
  if (cell || row.length || closed) rows.push([...row, cell]);
  if (
    rows
      .shift()
      ?.join(",")
      .replace(/^\uFEFF/, "") !== CSV_HEADER.join(",")
  )
    throw new RedirectValidationError("Invalid CSV header.");
  if (rows.length > 500)
    throw new RedirectValidationError("Import at most 500 redirects at a time.");
  return rows.map((v) => {
    if (v.length !== 6 || !["true", "false"].includes(v[5]!))
      throw new RedirectValidationError("Invalid CSV row.");
    return validateRedirect({
      ...Object.fromEntries(CSV_HEADER.map((k, i) => [k, v[i]])),
      status: Number(v[4]),
      enabled: v[5] === "true",
    });
  });
}

/** Conservative dependency graph: reject potentially cyclic pattern combinations,
 * including cycles that only occur for a particular capture value. */
export function assertNoRedirectLoops(rules: RedirectRule[]): void {
  const active = rules.filter((r) => r.enabled);
  const sourcePrefix = (r: RedirectRule) =>
    r.kind === "regex" ? r.source.slice(1, -1).split("(")[0]! : r.source;
  const edges = active.map((r) => {
    if (r.targetType === "external" || r.targetType === "content") return [];
    const dynamic = /\$[1-9]/.test(r.target);
    const prefix = r.target.split(/\$[1-9]/)[0]!;
    return active.flatMap((next, index) => {
      const possible = dynamic
        ? prefix.startsWith(sourcePrefix(next)) || sourcePrefix(next).startsWith(prefix)
        : matchRedirect(next, redirectRequestPath(r.target)) !== null;
      return possible ? [index] : [];
    });
  });
  const visiting = new Set<number>(),
    visited = new Map<number, number>();
  const visit = (index: number): number => {
    if (visiting.has(index))
      throw new RedirectValidationError(
        "Redirect loop or potentially cyclic pattern chain. Narrow the source or target.",
      );
    if (visited.has(index)) return visited.get(index)!;
    visiting.add(index);
    const depth = 1 + Math.max(0, ...edges[index]!.map(visit));
    if (depth > 32) throw new RedirectValidationError("Redirect chains must not exceed 32 hops.");
    visiting.delete(index);
    visited.set(index, depth);
    return depth;
  };
  active.forEach((_, i) => visit(i));
}

/** Collapse only equal-status chains: combining temporary/permanent or method
 * semantics would change the meaning of the operator's rules. Always inspect
 * the complete chain first so a mixed-status cycle cannot escape detection. */
export function resolveRedirect(
  rules: RedirectRule[],
  incoming: string,
  canonicalize: (path: string) => string = (path) => path,
): { target: string; status: RedirectInput["status"]; chain: string[] } | null {
  const ordered = orderedRedirects(rules);
  let current = incoming;
  const seen = new Set<string>();
  let result: { target: string; status: RedirectInput["status"]; chain: string[] } | null = null;
  let collapse = true;
  let fragment = "";
  for (let hop = 0; hop <= 32; hop++) {
    if (seen.has(current)) return null;
    seen.add(current);
    const rule = ordered.find((r) => matchRedirect(r, current) !== null);
    if (!rule) return result;
    const expanded = expandRedirect(rule, matchRedirect(rule, current)!);
    const target =
      rule.targetType === "internal" &&
      safeRedirectTarget(expanded) &&
      !ordered.some((r) => matchRedirect(r, redirectRequestPath(expanded)) !== null)
        ? canonicalize(expanded)
        : expanded;
    if (
      rule.targetType === "content" ||
      !safeRedirectTarget(target, rule.targetType === "external")
    )
      return null;
    if (target.includes("#")) fragment = target.slice(target.indexOf("#"));
    const location = target.includes("#") ? target : target + fragment;
    if (!result) result = { target: location, status: rule.status, chain: [rule.id] };
    else {
      collapse = collapse && rule.status === result.status;
      if (collapse) result.target = location;
      result.chain.push(rule.id);
    }
    if (rule.targetType === "external") return result;
    // Fragments are not sent to the server, so they must not evade cycle checks.
    current = redirectRequestPath(target);
  }
  return null;
}
