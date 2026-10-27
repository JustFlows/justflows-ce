// SPDX-License-Identifier: MIT

import { getControlDb } from "../database/db.js";
import { getTenantContext } from "../tenancy/context.js";
import { installationRootSiteId, loadHostRecords } from "../tenancy/registry.js";

const PLUGIN_ID = "justflows.helpdesk";
const POPUP_METER = "justflows.helpdesk.popup";
const SETTINGS_KEY = "helpdesk";

/**
 * Where the admin Support button belongs.
 * The main site's own admin never shows it once other sites exist.
 * Those other sites follow the main site's switch.
 */
export function adminSupportAudience(input: {
  requestIsRoot: boolean;
  siteCount: number;
}): "none" | "this-site" | "main-site" {
  if (input.requestIsRoot) return input.siteCount > 1 ? "none" : "this-site";
  return "main-site";
}

/** Public origin for a site hostname, keeping the dev port on loopback. */
export function supportPageOrigin(host: string, devPort: string | undefined): string {
  const name = host.trim().toLowerCase();
  const loopback = name === "localhost" || name.startsWith("127.0.0.1") || name.endsWith(".localhost");
  const port = loopback && devPort ? `:${devPort}` : "";
  return `${loopback ? "http" : "https"}://${name}${port}`;
}

/** The main site's admin should not render the Support button while other sites exist. */
export async function rootAdminHidesSupportPopup(): Promise<boolean> {
  const tenant = getTenantContext();
  if (!tenant?.rootSite) return false;
  try {
    const loaded = await loadHostRecords();
    return adminSupportAudience({ requestIsRoot: true, siteCount: loaded?.siteCount ?? 1 }) === "none";
  } catch {
    return false;
  }
}

/** The admin popup switch exists only on the installation's main site. */
export function adminPopupSettingOnThisSite(requestIsRoot: boolean): boolean {
  return requestIsRoot;
}

/**
 * Support button for this admin screen. Other sites follow the main site's
 * switch. The main site's own admin stays clear once those sites exist.
 */
export async function adminSupportMarkup(): Promise<string> {
  const tenant = getTenantContext();
  if (!tenant?.siteId) return "";
  let siteCount = 1;
  try {
    const loaded = await loadHostRecords();
    siteCount = loaded?.siteCount ?? 1;
  } catch {
    siteCount = 1;
  }
  const audience = adminSupportAudience({ requestIsRoot: tenant.rootSite === true, siteCount });
  if (audience === "none") return "";
  const rootId = audience === "main-site" ? await installationRootSiteId().catch(() => null) : tenant.siteId;
  if (!rootId) return "";
  const choice = await mainSitePopup(rootId);
  if (!choice) return "";
  const href = audience === "main-site"
    ? await supportHrefFromControl(rootId, tenant.siteId, tenant.devPort)
    : "/support";
  return popupTag(choice, href);
}

export interface SupportSiteRef {
  siteId: string;
  host: string;
  active: boolean;
}

/**
 * Other sites in this installation, for the optional Support site choice.
 * One site has nothing to choose, so the field stays hidden.
 */
export function supportSiteChoices(
  records: Array<{ siteId: string; hostname: string; primaryHostname?: string; siteStatus: string }>,
  rootSiteId: string,
): Array<{ value: string; label: string }> | null {
  const others = records.filter((record) => record.siteId !== rootSiteId && record.siteStatus === "active");
  if (others.length === 0) return null;
  return [
    { value: "", label: "This site" },
    ...others.map((record) => ({
      value: record.siteId,
      label: record.primaryHostname || record.hostname,
    })),
  ];
}

/**
 * Where the Support button opens. An empty choice keeps the main site.
 * The site that owns the desk uses its own /support page.
 */
export function supportLink(input: {
  currentSiteId: string;
  rootSiteId: string;
  supportSiteId: string;
  sites: SupportSiteRef[];
  devPort?: string;
}): string {
  const picked = input.supportSiteId && input.supportSiteId !== input.rootSiteId
    ? input.sites.find((site) => site.siteId === input.supportSiteId && site.active)
    : undefined;
  const target = picked ?? input.sites.find((site) => site.siteId === input.rootSiteId && site.active);
  if (!target || target.siteId === input.currentSiteId) return "/support";
  return `${supportPageOrigin(target.host, input.devPort)}/support`;
}

/** Point a Helpdesk popup script at another site. Other markup is left as it is. */
export function pointHelpdeskPopupAt(html: string, href: string): string {
  const marker = "data-jf-helpdesk-popup";
  const start = html.indexOf(marker);
  if (start < 0) return html;
  const tagStart = html.lastIndexOf("<script", start);
  const tagEnd = html.indexOf(">", start);
  if (tagStart < 0 || tagEnd < 0) return html;
  const tag = html.slice(tagStart, tagEnd + 1);
  const next = tag.replace(/data-href="[^"]*"/, `data-href="${escapeAttr(href)}"`);
  if (next === tag) return html;
  return `${html.slice(0, tagStart)}${next}${html.slice(tagEnd + 1)}`;
}

/**
 * The main site's popup switch. Read from the installation database, because a
 * subsite with its own database does not store that switch.
 */
async function mainSitePopup(rootId: string): Promise<{
  greeting: string;
  side: "left" | "right";
  label: string;
  action: string;
} | null> {
  const [blob, direct, greetingValue, positionValue] = await Promise.all([
    controlSetting(rootId, SETTINGS_KEY),
    controlSetting(rootId, "popupAdmin"),
    controlSetting(rootId, "popupGreeting"),
    controlSetting(rootId, "popupPosition"),
  ]);
  const stored =
    blob && typeof blob === "object" && !Array.isArray(blob) ? (blob as Record<string, unknown>) : {};
  const enabled = direct !== undefined ? flag(direct) : flag(stored["popupAdmin"]);
  if (!enabled) return null;
  if (!(await popupAllowed(rootId))) return null;
  const { getDefaultLocale } = await import("../i18n/languages-db.js");
  const defaultLocale = await getDefaultLocale(rootId).catch(() => "");
  const greeting = resolveGreeting(
    greetingValue !== undefined ? greetingValue : stored["popupGreeting"],
    defaultLocale,
    defaultLocale,
  );
  const side = (positionValue ?? stored["popupPosition"]) === "bottom-left" ? "left" : "right";
  const copy = popupCopy(defaultLocale);
  return { greeting, side, label: copy.support, action: copy.contact };
}

async function controlSetting(siteId: string, key: string): Promise<unknown> {
  const db = await getControlDb();
  const rows = await db.query<{ payload: unknown }>(
    "SELECT payload FROM plugin_data WHERE site_id = ? AND plugin_id = ? AND collection = ? AND item_id = ? LIMIT 1",
    [siteId, PLUGIN_ID, "settings", key],
  );
  const raw = rows[0]?.payload;
  if (typeof raw !== "string") return raw ?? undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

async function popupAllowed(rootId: string): Promise<boolean> {
  try {
    const { checkQuota } = await import("../tenancy/quotas.js");
    const decision = await checkQuota(POPUP_METER, rootId, { used: 0, delta: 1 });
    return decision.ok;
  } catch {
    return true;
  }
}

async function supportHrefFromControl(
  rootId: string,
  currentSiteId: string,
  devPort: string | undefined,
): Promise<string> {
  let supportSiteId = "";
  try {
    const raw = await controlSetting(rootId, "supportSite");
    supportSiteId = typeof raw === "string" ? raw.trim() : "";
  } catch {
    supportSiteId = "";
  }
  let sites: SupportSiteRef[] = [];
  try {
    const loaded = await loadHostRecords();
    sites = (loaded?.records ?? []).map((record) => ({
      siteId: record.siteId,
      host: record.primaryHostname || record.hostname,
      active: record.siteStatus === "active",
    }));
  } catch {
    sites = [];
  }
  return supportLink({ currentSiteId, rootSiteId: rootId, supportSiteId, sites, ...(devPort ? { devPort } : {}) });
}

/**
 * Absolute Support address for the main site's public popup, when that site
 * has chosen another site. Empty means the popup keeps its own /support link.
 */
export async function canonicalPublicSupportHref(
  rootSiteId: string,
  devPort: string | undefined,
): Promise<string | null> {
  const href = await supportHrefFromControl(rootSiteId, rootSiteId, devPort);
  return href.startsWith("/") ? null : href;
}

function popupTag(choice: { greeting: string; side: "left" | "right"; label: string; action: string }, href = "/support"): string {
  return `<script src="/ext/${PLUGIN_ID}/popup.js" defer data-jf-helpdesk-popup data-href="${escapeAttr(href)}" data-greeting="${escapeAttr(choice.greeting)}" data-side="${choice.side}" data-label="${escapeAttr(choice.label)}" data-action="${escapeAttr(choice.action)}"></script>`;
}

const POPUP_COPY: Record<string, { support: string; contact: string }> = {
  en: { support: "Support", contact: "Contact support" },
  nl: { support: "Ondersteuning", contact: "Contact opnemen" },
  de: { support: "Support", contact: "Support kontaktieren" },
  fr: { support: "Assistance", contact: "Contacter l'assistance" },
  es: { support: "Soporte", contact: "Contactar con soporte" },
  pl: { support: "Pomoc", contact: "Skontaktuj się z pomocą" },
  uk: { support: "Підтримка", contact: "Звернутися до підтримки" },
  ru: { support: "Поддержка", contact: "Связаться с поддержкой" },
};

function popupCopy(locale: string): { support: string; contact: string } {
  const language = locale.toLowerCase().split("-")[0] || "en";
  return POPUP_COPY[language] ?? POPUP_COPY["en"] ?? { support: "Support", contact: "Contact support" };
}

function resolveGreeting(value: unknown, locale: string, defaultLocale: string): string {
  if (typeof value === "string") {
    const text = value.replace(/\s+/g, " ").trim().slice(0, 160);
    if (text) return text;
  }
  const map = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return greetingMatch(map, locale) || greetingMatch(map, defaultLocale) || textAt(map["*"]) || firstText(map) || "How can we help?";
}

function greetingMatch(map: Record<string, unknown>, locale: string): string {
  if (!locale) return "";
  const exact = textAt(map[locale]);
  if (exact) return exact;
  const language = locale.toLowerCase().split("-")[0] ?? "";
  if (!language) return "";
  const match = Object.entries(map).find(([key, entry]) => {
    const text = textAt(entry);
    if (!text) return false;
    const stored = key.toLowerCase();
    return stored === language || stored.split("-")[0] === language;
  });
  return match ? textAt(match[1]) : "";
}

function textAt(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 160);
}

function firstText(map: Record<string, unknown>): string {
  for (const entry of Object.values(map)) {
    const text = textAt(entry);
    if (text) return text;
  }
  return "";
}

function flag(value: unknown): boolean {
  return value === true || value === "true";
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
