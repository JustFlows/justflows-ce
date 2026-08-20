export type HeaderScope = "all" | "public" | "admin";

export type SecurityHeaderId =
  | "x_frame_options"
  | "strict_transport_security"
  | "referrer_policy"
  | "x_content_type_options"
  | "content_security_policy"
  | "permissions_policy"
  | "cross_origin_embedder_policy"
  | "cross_origin_opener_policy"
  | "cross_origin_resource_policy"
  | "x_permitted_cross_domain_policies"
  | "x_dns_prefetch_control"
  | "origin_agent_cluster"
  | "x_xss_protection";

export type HeaderEditor = "choice" | "hsts" | "csp" | "permissions" | "text";

export type HeaderOption = {
  value: string;
  label: string;
  hint: string;
  recommended?: boolean;
};

export type SecurityHeaderDef = {
  id: SecurityHeaderId;
  header: string;
  title: string;
  description: string;
  editor: HeaderEditor;
  options?: HeaderOption[];
  defaultValue: string;
  defaultScope: HeaderScope;
  recommended: boolean;
  docs: string;
};

export type HeaderEntry = {
  enabled: boolean;
  scope: HeaderScope;
  value: string;
  mode?: "enforce" | "report-only";
  onlyWhenSecure?: boolean;
};

export type CustomHeader = {
  name: string;
  value: string;
  enabled: boolean;
  scope: HeaderScope;
};

export type SecurityHeadersConfig = {
  headers: Record<SecurityHeaderId, HeaderEntry>;
  custom: CustomHeader[];
  removeServerHeader: boolean;
};

export type FindingLevel = "critical" | "warning" | "info" | "pass";

export type Finding = {
  id: string;
  level: FindingLevel;
  headerId: SecurityHeaderId | null;
  title: string;
  detail: string;
  penalty: number;
};

export type SecurityAudit = {
  score: number;
  grade: "A+" | "A" | "B" | "C" | "D" | "E" | "F";
  findings: Finding[];
  counts: Record<FindingLevel, number>;
};

export type ResolvedHeader = { name: string; value: string };

export type EffectiveHeaders = {
  publicSecure: ResolvedHeader[];
  publicInsecure: ResolvedHeader[];
  admin: ResolvedHeader[];
};

export type SecurityPayload = {
  config: SecurityHeadersConfig;
  catalog: SecurityHeaderDef[];
  defaults: SecurityHeadersConfig;
  recommended: SecurityHeadersConfig;
  audit: SecurityAudit;
  effective: EffectiveHeaders;
  killSwitch: boolean;
};

export const SCOPE_LABELS: Record<HeaderScope, string> = {
  all: "Everywhere",
  public: "Public site only",
  admin: "Admin & API only",
};

export const SCOPE_HINTS: Record<HeaderScope, string> = {
  all: "Sent with every response.",
  public: "Sent on themed pages, not on /admin, /login, /register or the API.",
  admin: "Sent on /admin, /login, /register, /install and the API only.",
};
