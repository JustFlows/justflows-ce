// SPDX-License-Identifier: MIT

import {
  SECURITY_HEADER_DEFS,
  type SecurityHeaderId,
  type SecurityHeadersConfig,
} from "./security-headers.js";

export type FindingLevel = "critical" | "warning" | "info" | "pass";

export type Finding = {
  id: string;
  level: FindingLevel;
  /** Which header the finding is about, so the UI can link straight to it. */
  headerId: SecurityHeaderId | null;
  title: string;
  detail: string;
  /** Points subtracted from the score. Zero for passes and pure information. */
  penalty: number;
};

export type SecurityAudit = {
  score: number;
  grade: "A+" | "A" | "B" | "C" | "D" | "E" | "F";
  findings: Finding[];
  counts: Record<FindingLevel, number>;
};

/** Six months — the shortest max-age the HSTS preload list will accept. */
const HSTS_PRELOAD_MIN_AGE = 15_768_000;

export function parseCspDirectives(value: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of value.split(";")) {
    const [directive, ...sources] = part.trim().split(/\s+/).filter(Boolean);
    if (!directive) continue;
    const name = directive.toLowerCase();
    if (!out.has(name)) out.set(name, sources);
  }
  return out;
}

function parseHstsMaxAge(value: string): number | null {
  const match = /max-age\s*=\s*"?(\d+)"?/i.exec(value);
  if (!match?.[1]) return null;
  return Number(match[1]);
}

function titleFor(id: SecurityHeaderId): string {
  return SECURITY_HEADER_DEFS.find((d) => d.id === id)?.header ?? id;
}

/**
 * Grade a configuration the way an external scanner would, but with the reason
 * spelled out — the point of the screen is that the site owner learns what to
 * change, not just that they scored a B.
 */
export function auditConfig(config: SecurityHeadersConfig): SecurityAudit {
  const findings: Finding[] = [];
  const on = (id: SecurityHeaderId) => config.headers[id]?.enabled === true;
  const val = (id: SecurityHeaderId) => (config.headers[id]?.value ?? "").trim();

  const add = (f: Omit<Finding, "penalty"> & { penalty?: number }) =>
    findings.push({ penalty: 0, ...f });

  // ─── Content Security Policy ───────────────────────────────────────────────
  // Graded separately from the public policy. The admin holds a session that
  // can install extensions and replace the core, so an unprotected admin is the
  // more expensive of the two — and it is the one that shipped without a policy,
  // because the only CSP entry was scoped "public".
  if (!on("content_security_policy_admin")) {
    add({
      id: "cspAdmin.missing",
      level: "critical",
      headerId: "content_security_policy_admin",
      title: "No Content Security Policy on the admin",
      detail:
        "A script injected into the admin runs with your session, which can install an extension or upload a core update — that is server access, not just a defaced page. Turn the admin policy on.",
      penalty: 30,
    });
  } else if (config.headers.content_security_policy_admin.mode === "report-only") {
    add({
      id: "cspAdmin.reportOnly",
      level: "warning",
      headerId: "content_security_policy_admin",
      title: "Admin Content Security Policy is report-only",
      detail:
        "Violations in the admin are reported but nothing is blocked. Switch the mode to Enforce once the reports are quiet.",
      penalty: 12,
    });
  } else {
    const adminDirectives = parseCspDirectives(config.headers.content_security_policy_admin.value);
    const adminScript = adminDirectives.get("script-src") ?? adminDirectives.get("default-src") ?? [];
    if (adminScript.includes("'unsafe-inline'") || adminScript.includes("*")) {
      add({
        id: "cspAdmin.weakScript",
        level: "warning",
        headerId: "content_security_policy_admin",
        title: "Admin policy allows inline or wildcard scripts",
        detail:
          "The admin is a build you control, so it needs neither. Removing them is what makes the policy worth having on this surface.",
        penalty: 8,
      });
    } else {
      add({
        id: "cspAdmin.enforced",
        level: "pass",
        headerId: "content_security_policy_admin",
        title: "Admin Content Security Policy is enforced",
        detail: "Scripts outside the policy are blocked in the admin area and the API.",
      });
    }
  }

  const csp = config.headers.content_security_policy;
  if (!on("content_security_policy")) {
    add({
      id: "csp.missing",
      level: "critical",
      headerId: "content_security_policy",
      title: "No Content Security Policy",
      detail:
        "Without a CSP, any script that reaches one of your pages runs with full access to it. This is the single biggest gap in the list.",
      penalty: 30,
    });
  } else {
    const directives = parseCspDirectives(csp.value);
    if (csp.mode === "report-only") {
      add({
        id: "csp.reportOnly",
        level: "warning",
        headerId: "content_security_policy",
        title: "Content Security Policy is report-only",
        detail:
          "Violations are reported but nothing is blocked. This is the right way to start — switch the mode to Enforce once the reports are quiet.",
        penalty: 12,
      });
    } else {
      add({
        id: "csp.enforced",
        level: "pass",
        headerId: "content_security_policy",
        title: "Content Security Policy is enforced",
        detail: "Resources outside the policy are blocked by the browser.",
      });
    }

    const scriptSrc = directives.get("script-src") ?? directives.get("default-src") ?? [];
    if (scriptSrc.includes("'unsafe-inline'")) {
      add({
        id: "csp.unsafeInline",
        level: "warning",
        headerId: "content_security_policy",
        title: "Scripts allow 'unsafe-inline'",
        detail:
          "Inline scripts are the payload of most cross-site scripting attacks, so allowing them removes much of the CSP's value. Use a nonce or a hash instead.",
        penalty: 8,
      });
    }
    if (scriptSrc.includes("'unsafe-eval'")) {
      add({
        id: "csp.unsafeEval",
        level: "warning",
        headerId: "content_security_policy",
        title: "Scripts allow 'unsafe-eval'",
        detail: "eval() and its relatives turn injected strings into running code.",
        penalty: 5,
      });
    }
    if (scriptSrc.includes("*") || scriptSrc.includes("https:")) {
      add({
        id: "csp.wildcardScript",
        level: "warning",
        headerId: "content_security_policy",
        title: "Scripts may load from any host",
        detail:
          "A wildcard or bare https: source lets an attacker host their script anywhere. Name the hosts you actually use.",
        penalty: 6,
      });
    }
    if (!directives.has("object-src") && !directives.has("default-src")) {
      add({
        id: "csp.objectSrc",
        level: "warning",
        headerId: "content_security_policy",
        title: "No object-src directive",
        detail: "Add object-src 'none' to keep legacy plugin content from being injected.",
        penalty: 4,
      });
    }
    if (!directives.has("base-uri")) {
      add({
        id: "csp.baseUri",
        level: "warning",
        headerId: "content_security_policy",
        title: "No base-uri directive",
        detail:
          "Without base-uri 'self', injected markup can repoint every relative URL on the page at another host.",
        penalty: 4,
      });
    }
    if (!directives.has("frame-ancestors")) {
      add({
        id: "csp.frameAncestors",
        level: "info",
        headerId: "content_security_policy",
        title: "No frame-ancestors directive",
        detail:
          "frame-ancestors is the modern replacement for X-Frame-Options and is the one browsers prefer when both are present.",
        penalty: 2,
      });
    }
  }

  // ─── Strict Transport Security ─────────────────────────────────────────────
  if (!on("strict_transport_security")) {
    add({
      id: "hsts.missing",
      level: "critical",
      headerId: "strict_transport_security",
      title: "No Strict-Transport-Security",
      detail:
        "A visitor's first request can still be downgraded to plain HTTP, which is all a network attacker needs.",
      penalty: 20,
    });
  } else {
    const value = val("strict_transport_security");
    const maxAge = parseHstsMaxAge(value);
    if (maxAge === null) {
      add({
        id: "hsts.noMaxAge",
        level: "critical",
        headerId: "strict_transport_security",
        title: "Strict-Transport-Security has no max-age",
        detail: "Browsers ignore an HSTS header without a max-age directive.",
        penalty: 20,
      });
    } else if (maxAge < HSTS_PRELOAD_MIN_AGE) {
      add({
        id: "hsts.shortMaxAge",
        level: "warning",
        headerId: "strict_transport_security",
        title: "HSTS max-age is short",
        detail: `max-age is ${maxAge} seconds. Six months (15768000) is the accepted minimum; one year (31536000) is the norm.`,
        penalty: 5,
      });
    } else {
      add({
        id: "hsts.ok",
        level: "pass",
        headerId: "strict_transport_security",
        title: "HTTPS is enforced for returning visitors",
        detail: `max-age is ${maxAge} seconds.`,
      });
    }
    if (!/includeSubDomains/i.test(value)) {
      add({
        id: "hsts.noSubdomains",
        level: "info",
        headerId: "strict_transport_security",
        title: "HSTS does not cover subdomains",
        detail:
          "Add includeSubDomains so a forgotten subdomain cannot be used to plant a cookie on the parent domain.",
        penalty: 3,
      });
    }
  }

  // ─── Framing ───────────────────────────────────────────────────────────────
  const cspFrameAncestors =
    on("content_security_policy") && parseCspDirectives(val("content_security_policy")).has("frame-ancestors");
  if (!on("x_frame_options") && !cspFrameAncestors) {
    add({
      id: "xfo.missing",
      level: "critical",
      headerId: "x_frame_options",
      title: "Pages can be framed by any site",
      detail:
        "Set X-Frame-Options, or a CSP frame-ancestors directive, to stop clickjacking overlays.",
      penalty: 15,
    });
  } else {
    add({
      id: "xfo.ok",
      level: "pass",
      headerId: "x_frame_options",
      title: "Framing is restricted",
      detail: cspFrameAncestors
        ? "Covered by the CSP frame-ancestors directive."
        : `X-Frame-Options: ${val("x_frame_options")}`,
    });
  }

  // ─── The straightforward ones ──────────────────────────────────────────────
  const simple: { id: SecurityHeaderId; penalty: number; level: FindingLevel; detail: string }[] = [
    {
      id: "x_content_type_options",
      penalty: 10,
      level: "warning",
      detail:
        "Without nosniff the browser may treat an uploaded file as script because of what is inside it, whatever type you served it as.",
    },
    {
      id: "referrer_policy",
      penalty: 10,
      level: "warning",
      detail:
        "The full URL of the page a visitor is leaving — including any path or query string — is handed to the next site.",
    },
    {
      id: "permissions_policy",
      penalty: 10,
      level: "warning",
      detail:
        "Camera, microphone, geolocation and the rest stay reachable from any code that runs on the page.",
    },
    {
      id: "cross_origin_opener_policy",
      penalty: 5,
      level: "warning",
      detail:
        "A page that opens yours, or that you open, keeps a reference to your window and can probe it across origins.",
    },
    {
      id: "cross_origin_resource_policy",
      penalty: 4,
      level: "info",
      detail: "Any site can load your pages and files as a subresource and time the result.",
    },
    {
      id: "cross_origin_embedder_policy",
      penalty: 2,
      level: "info",
      detail:
        "Cross-origin isolation stays off, so the browser keeps the mitigations for speculative-execution side channels at their weaker default.",
    },
  ];

  for (const rule of simple) {
    if (on(rule.id)) {
      add({
        id: `${rule.id}.ok`,
        level: "pass",
        headerId: rule.id,
        title: `${titleFor(rule.id)} is set`,
        detail: val(rule.id),
      });
    } else {
      add({
        id: `${rule.id}.missing`,
        level: rule.level,
        headerId: rule.id,
        title: `No ${titleFor(rule.id)}`,
        detail: rule.detail,
        penalty: rule.penalty,
      });
    }
  }

  // ─── Legacy footgun ────────────────────────────────────────────────────────
  if (on("x_xss_protection") && val("x_xss_protection") !== "0") {
    add({
      id: "xss.legacyFilter",
      level: "warning",
      headerId: "x_xss_protection",
      title: "The legacy XSS filter is switched on",
      detail:
        "The filter this header controls introduced vulnerabilities of its own and is gone from current browsers. Send 0, or turn the header off entirely.",
      penalty: 5,
    });
  }

  const penalty = findings.reduce((sum, f) => sum + f.penalty, 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));

  const counts: Record<FindingLevel, number> = { critical: 0, warning: 0, info: 0, pass: 0 };
  for (const f of findings) counts[f.level] += 1;

  return { score, grade: gradeFor(score), findings, counts };
}

function gradeFor(score: number): SecurityAudit["grade"] {
  if (score >= 95) return "A+";
  if (score >= 85) return "A";
  if (score >= 75) return "B";
  if (score >= 65) return "C";
  if (score >= 55) return "D";
  if (score >= 40) return "E";
  return "F";
}
