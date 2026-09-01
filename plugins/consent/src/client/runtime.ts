/**
 * Justflows Cookie Consent — public runtime.
 *
 * Served first-party from /ext/justflows.consent/runtime.js. No dependencies, no
 * network calls except a fire-and-forget consent beacon. Renders the banner and
 * preference center in the visitor's language, applies the configured design,
 * exposes `window.justflowsConsent`, and unlocks gated scripts and embeds once
 * their category is granted.
 */

type Category = "necessary" | "preferences" | "analytics" | "marketing";
type OptionalCategory = Exclude<Category, "necessary">;
type Choices = Record<Category, boolean>;

interface LocalizedText {
  bannerTitle: string;
  bannerBody: string;
  privacyPolicyLabel: string;
  acceptAllLabel: string;
  rejectAllLabel: string;
  saveLabel: string;
  preferencesLabel: string;
  necessaryName: string;
  necessaryDescription: string;
  embedNote: string;
  embedUnlockLabel: string;
  categories: Record<OptionalCategory, { name: string; description: string }>;
}

interface ConsentDesign {
  layout: "bar" | "box" | "modal";
  position: "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
  useThemeColors: boolean;
  colors: {
    background: string;
    text: string;
    accent: string;
    accentText: string;
    border: string;
    backdrop: string;
  };
  panelRadius: string;
  buttonRadius: string;
  width: string;
}

interface PublicConfig {
  displayMode: "always" | "eu" | "off";
  policyVersion: string;
  policyHash: string;
  privacyPolicyUrl: string;
  reopenSelector: string;
  recordUrl: string;
  cookiesUrl: string;
  categories: OptionalCategory[];
  design: ConsentDesign;
  defaultLocale: string;
  i18n: Record<string, LocalizedText>;
}

interface PublicCookie {
  name: string;
  category: Category;
  declared: Category;
  purpose: string;
  provider: string;
  duration: string;
  setBy: string;
}

function cookieNameMatches(pattern: string, name: string): boolean {
  return pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : pattern === name;
}

interface StoredDecision {
  cid: string;
  h: string;
  choices: Choices;
  ts: string;
  m?: string;
}

const COOKIE = "jf_consent";
const STORE_KEY = "jf_consent";
const ALL: Category[] = ["necessary", "preferences", "analytics", "marketing"];

// Timezones that imply an EEA / UK / CH visitor. Best-effort, no geolocation.
const EU_TZ = /^(Europe\/|Atlantic\/(Azores|Madeira|Canary|Reykjavik|Faroe)|Arctic\/Longyearbyen)/;

function readConfig(): PublicConfig | null {
  const el = document.getElementById("jf-consent-config");
  if (!el) return null;
  try {
    return JSON.parse(el.textContent || "null") as PublicConfig;
  } catch {
    return null;
  }
}

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]!) : null;
}

function readCookieNames(): string[] {
  return document.cookie
    .split(";")
    .map((pair) => pair.split("=")[0]!.trim())
    .filter(Boolean);
}

/** The host plus each parent domain, so a cookie set on `.example.com` is
 * cleared regardless of which level wrote it. `""` covers the default (host-only). */
function domainCandidates(): string[] {
  const parts = location.hostname.split(".");
  const out = [""];
  for (let i = 0; i < parts.length - 1; i++) out.push("." + parts.slice(i).join("."));
  return out;
}

function setCookie(name: string, value: string, days: number): void {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    name +
    "=" +
    encodeURIComponent(value) +
    "; Path=/; Expires=" +
    expires +
    "; SameSite=Lax" +
    secure;
}

function readDecision(): StoredDecision | null {
  let raw = getCookie(COOKIE);
  if (!raw) {
    try {
      raw = localStorage.getItem(STORE_KEY);
    } catch {
      raw = null;
    }
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredDecision;
    if (parsed && typeof parsed.cid === "string" && parsed.choices) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

function persist(decision: StoredDecision): void {
  const json = JSON.stringify(decision);
  setCookie(COOKIE, json, 365);
  try {
    localStorage.setItem(STORE_KEY, json);
  } catch {
    /* private mode */
  }
}

function newCid(): string {
  try {
    if (crypto && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {
    /* ignore */
  }
  return "c-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

function emptyChoices(): Choices {
  return { necessary: true, preferences: false, analytics: false, marketing: false };
}

function inScope(config: PublicConfig): boolean {
  if (config.displayMode === "off") return false;
  if (config.displayMode === "always") return true;
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    return EU_TZ.test(tz);
  } catch {
    return true; // fail safe: show the banner
  }
}

/** Best BCP-47 match: exact, then base language, then default, then anything. */
function resolveText(config: PublicConfig): LocalizedText {
  const codes = Object.keys(config.i18n);
  const wanted = (document.documentElement.lang || config.defaultLocale || "en").toLowerCase();
  const lower = new Map(codes.map((code) => [code.toLowerCase(), code]));
  const base = wanted.split("-")[0]!;
  const pick =
    lower.get(wanted) ||
    lower.get(base) ||
    codes.find((code) => code.toLowerCase().split("-")[0] === base) ||
    (config.i18n[config.defaultLocale] ? config.defaultLocale : codes[0]);
  return config.i18n[pick as string] ?? config.i18n[config.defaultLocale]!;
}

function applyDesign(root: HTMLElement, design: ConsentDesign): void {
  root.setAttribute("data-layout", design.layout);
  root.setAttribute("data-position", design.position);
  const set = (name: string, value: string) => value && root.style.setProperty(name, value);
  set("--jfc-panel-radius", design.panelRadius);
  set("--jfc-btn-radius", design.buttonRadius);
  set("--jfc-width", design.width);
  set("--jfc-backdrop", design.colors.backdrop);
  if (!design.useThemeColors) {
    set("--jfc-bg", design.colors.background);
    set("--jfc-text", design.colors.text);
    set("--jfc-accent", design.colors.accent);
    set("--jfc-accent-text", design.colors.accentText);
    set("--jfc-border", design.colors.border);
  }
}

class ConsentManager {
  readonly config: PublicConfig;
  readonly text: LocalizedText;
  private choices: Choices = emptyChoices();
  private cid = "";
  private decided = false;
  private listeners = new Set<(choices: Choices) => void>();
  private banner: HTMLElement | null = null;
  private modal: HTMLElement | null = null;
  private backdrop: HTMLElement | null = null;
  private modalBlocking = false;
  private lastFocus: Element | null = null;
  private cookies: PublicCookie[] = [];
  private readonly trapBound = (event: KeyboardEvent) => this.trap(event);

  constructor(config: PublicConfig) {
    this.config = config;
    this.text = resolveText(config);
    const prior = readDecision();
    if (prior && prior.h === config.policyHash) {
      this.choices = { ...emptyChoices(), ...prior.choices, necessary: true };
      this.cid = prior.cid;
      this.decided = true;
    } else {
      this.cid = (prior && prior.cid) || newCid();
    }
  }

  get(category: Category): boolean {
    return category === "necessary" ? true : Boolean(this.choices[category]);
  }

  all(): Choices {
    return { ...this.choices };
  }

  /** Is a specific cookie allowed right now, per the site registry? Unknown
   * (undeclared) names are treated as allowed. */
  allowed(cookieName: string): boolean {
    const hit = this.cookies.find((c) => cookieNameMatches(c.name, cookieName));
    return hit ? this.get(hit.category) : true;
  }

  /** Load the cookie registry (async) and enforce it against the current
   * decision. Called once the disclosure fetch resolves. */
  setCookies(cookies: PublicCookie[]): void {
    this.cookies = Array.isArray(cookies) ? cookies : [];
    if (this.decided) this.enforceCookies();
    // Re-render an open preference center so its cookie table appears.
    if (this.modal) {
      const blocking = this.modalBlocking;
      this.close();
      this.open(blocking);
    }
  }

  /** Expire every registered cookie whose category is not granted, for this
   * host and its parent domains. */
  private enforceCookies(): void {
    const hosts = domainCandidates();
    for (const cookie of this.cookies) {
      if (cookie.category === "necessary" || this.get(cookie.category)) continue;
      const names = cookie.name.endsWith("*")
        ? readCookieNames().filter((n) => cookieNameMatches(cookie.name, n))
        : [cookie.name];
      for (const name of names) {
        for (const domain of hosts) {
          document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${domain ? `; Domain=${domain}` : ""}`;
        }
      }
    }
  }

  onChange(fn: (choices: Choices) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) {
      try {
        fn(this.all());
      } catch {
        /* listener error must not break the runtime */
      }
    }
  }

  boot(): void {
    this.localizeEmbeds();
    if (this.decided) {
      this.apply();
      return;
    }
    if (!inScope(this.config)) {
      // Out of geo scope: imply acceptance of the offered categories so the
      // site behaves normally, but store it so it stays auditable.
      for (const category of this.config.categories) this.choices[category] = true;
      this.commit("auto");
      return;
    }
    if (this.config.design.layout === "modal") this.open(true);
    else this.renderBanner();
  }

  acceptAll(): void {
    for (const category of this.config.categories) this.choices[category] = true;
    this.commit("accept-all");
  }

  rejectAll(): void {
    for (const category of this.config.categories) this.choices[category] = false;
    this.commit("reject-all");
  }

  save(next?: Partial<Choices>): void {
    if (next) this.choices = { ...this.choices, ...next, necessary: true };
    this.commit("custom");
  }

  private commit(method: string): void {
    this.choices.necessary = true;
    this.decided = true;
    persist({
      cid: this.cid,
      h: this.config.policyHash,
      choices: this.choices,
      ts: new Date().toISOString(),
      m: method,
    });
    this.beacon(method);
    this.teardownUi();
    this.apply();
    this.enforceCookies();
    this.notify();
  }

  private beacon(method: string): void {
    if (!this.config.recordUrl) return; // logging disabled by the operator
    const compact = this.config.categories
      .map((category) => category + ":" + (this.choices[category] ? "1" : "0"))
      .join(",");
    const locale = (document.documentElement.lang || "").slice(0, 35);
    const url =
      this.config.recordUrl +
      "?cid=" +
      encodeURIComponent(this.cid) +
      "&c=" +
      encodeURIComponent(compact) +
      "&l=" +
      encodeURIComponent(locale) +
      "&m=" +
      encodeURIComponent(method);
    try {
      new Image().src = url;
    } catch {
      /* ignore */
    }
  }

  /** Unlock gated scripts and restore gated embeds for every granted category. */
  private apply(): void {
    document
      .querySelectorAll<HTMLScriptElement>('script[type="text/plain"][data-jf-consent]')
      .forEach((node) => {
        const category = node.getAttribute("data-jf-consent") as Category | null;
        if (category && this.get(category)) this.runScript(node);
      });
    document
      .querySelectorAll<HTMLElement>(".jf-consent-embed[data-jf-consent-embed]")
      .forEach((placeholder) => {
        const category = (placeholder.getAttribute("data-jf-consent-category") ||
          "marketing") as Category;
        if (this.get(category)) this.restoreEmbed(placeholder);
      });
  }

  private runScript(node: HTMLScriptElement): void {
    const replacement = document.createElement("script");
    for (const attr of Array.from(node.attributes)) {
      if (attr.name === "type" || attr.name === "data-jf-consent" || attr.name === "data-jf-src") {
        continue;
      }
      replacement.setAttribute(attr.name, attr.value);
    }
    const deferredSrc = node.getAttribute("data-jf-src");
    if (deferredSrc) replacement.src = deferredSrc;
    else replacement.text = node.textContent || "";
    node.parentNode?.replaceChild(replacement, node);
  }

  /** The `content.render` filter renders placeholders in the site default
   * locale; swap in the visitor's language once the runtime knows it. */
  private localizeEmbeds(): void {
    document.querySelectorAll<HTMLElement>(".jf-consent-embed").forEach((placeholder) => {
      const note = placeholder.querySelector(".jf-consent-embed__note");
      const unlock = placeholder.querySelector(".jf-consent-embed__unlock");
      if (note) {
        const title = placeholder.getAttribute("data-jf-consent-embed-title") || "";
        note.textContent = title ? `${this.text.embedNote}: ${title}` : this.text.embedNote;
      }
      if (unlock) unlock.textContent = this.text.embedUnlockLabel;
    });
  }

  private restoreEmbed(placeholder: HTMLElement): void {
    const encoded = placeholder.getAttribute("data-jf-consent-embed");
    if (!encoded) return;
    let markup = "";
    try {
      markup = decodeURIComponent(escape(atob(encoded)));
    } catch {
      try {
        markup = atob(encoded);
      } catch {
        return;
      }
    }
    const wrap = document.createElement("div");
    wrap.innerHTML = markup;
    const node = wrap.firstElementChild;
    if (node) placeholder.parentNode?.replaceChild(node, placeholder);
  }

  // ─── UI ────────────────────────────────────────────────────────────────

  private container(): HTMLElement {
    const el = document.createElement("div");
    el.className = "jf-consent";
    applyDesign(el, this.config.design);
    return el;
  }

  private renderBanner(): void {
    if (this.banner) return;
    const text = this.text;
    const el = this.container();
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", text.bannerTitle);
    el.innerHTML =
      '<div class="jf-consent__panel">' +
      '<h2 class="jf-consent__title"></h2>' +
      '<p class="jf-consent__body"></p>' +
      '<div class="jf-consent__actions">' +
      '<button type="button" class="jf-consent__btn jf-consent__btn--primary" data-act="accept"></button>' +
      '<button type="button" class="jf-consent__btn jf-consent__btn--secondary" data-act="reject"></button>' +
      '<button type="button" class="jf-consent__btn jf-consent__btn--ghost" data-act="prefs"></button>' +
      "</div></div>";
    (el.querySelector(".jf-consent__title") as HTMLElement).textContent = text.bannerTitle;
    const body = el.querySelector(".jf-consent__body") as HTMLElement;
    body.textContent = text.bannerBody + " ";
    if (this.config.privacyPolicyUrl) {
      const link = document.createElement("a");
      link.href = this.config.privacyPolicyUrl;
      link.textContent = text.privacyPolicyLabel;
      body.appendChild(link);
    }
    (el.querySelector('[data-act="accept"]') as HTMLElement).textContent = text.acceptAllLabel;
    (el.querySelector('[data-act="reject"]') as HTMLElement).textContent = text.rejectAllLabel;
    (el.querySelector('[data-act="prefs"]') as HTMLElement).textContent = text.preferencesLabel;
    el.addEventListener("click", (event) => {
      const act = (event.target as HTMLElement).closest("[data-act]")?.getAttribute("data-act");
      if (act === "accept") this.acceptAll();
      else if (act === "reject") this.rejectAll();
      else if (act === "prefs") this.open();
    });
    document.body.appendChild(el);
    this.banner = el;
  }

  /** Open the preference center (modal, focus-trapped). `blocking` hides the
   * dismiss affordances for a first-run modal-layout banner. */
  open(blocking = false): void {
    if (this.modal) return;
    this.lastFocus = document.activeElement;
    this.modalBlocking = blocking;
    const text = this.text;

    const backdrop = document.createElement("div");
    backdrop.className = "jf-consent__backdrop";
    applyDesign(backdrop, this.config.design);
    if (!blocking) backdrop.addEventListener("click", () => this.close());

    const modal = this.container();
    modal.setAttribute("data-layout", "modal");
    modal.setAttribute("data-position", "center");
    modal.innerHTML =
      '<div class="jf-consent__panel" role="dialog" aria-modal="true">' +
      '<h2 class="jf-consent__title"></h2>' +
      '<p class="jf-consent__body"></p>' +
      '<fieldset class="jf-consent__categories"></fieldset>' +
      '<div class="jf-consent__actions">' +
      '<button type="button" class="jf-consent__btn jf-consent__btn--primary" data-act="accept"></button>' +
      '<button type="button" class="jf-consent__btn jf-consent__btn--secondary" data-act="reject"></button>' +
      '<button type="button" class="jf-consent__btn jf-consent__btn--ghost" data-act="save"></button>' +
      "</div></div>";
    const panel = modal.querySelector(".jf-consent__panel") as HTMLElement;
    panel.setAttribute("aria-label", text.preferencesLabel);
    (modal.querySelector(".jf-consent__title") as HTMLElement).textContent = blocking
      ? text.bannerTitle
      : text.preferencesLabel;
    (modal.querySelector(".jf-consent__body") as HTMLElement).textContent = blocking
      ? text.bannerBody
      : "";

    const fieldset = modal.querySelector(".jf-consent__categories") as HTMLElement;
    fieldset.appendChild(
      this.categoryRow("necessary", text.necessaryName, text.necessaryDescription, true, true),
    );
    for (const category of this.config.categories) {
      const copy = text.categories[category];
      fieldset.appendChild(
        this.categoryRow(category, copy.name, copy.description, this.get(category), false),
      );
    }

    (modal.querySelector('[data-act="accept"]') as HTMLElement).textContent = text.acceptAllLabel;
    (modal.querySelector('[data-act="reject"]') as HTMLElement).textContent = text.rejectAllLabel;
    (modal.querySelector('[data-act="save"]') as HTMLElement).textContent = text.saveLabel;
    modal.addEventListener("click", (event) => {
      const act = (event.target as HTMLElement).closest("[data-act]")?.getAttribute("data-act");
      if (act === "accept") this.acceptAll();
      else if (act === "reject") this.rejectAll();
      else if (act === "save") {
        const next: Partial<Choices> = {};
        fieldset.querySelectorAll<HTMLInputElement>("input[data-cat]").forEach((input) => {
          next[input.getAttribute("data-cat") as Category] = input.checked;
        });
        this.save(next);
      }
    });

    document.body.appendChild(backdrop);
    document.body.appendChild(modal);
    this.backdrop = backdrop;
    this.modal = modal;

    document.addEventListener("keydown", this.trapBound, true);
    modal.querySelector<HTMLElement>("button, input")?.focus();
  }

  close(): void {
    this.modal?.remove();
    this.backdrop?.remove();
    this.modal = null;
    this.backdrop = null;
    document.removeEventListener("keydown", this.trapBound, true);
    if (this.lastFocus instanceof HTMLElement) this.lastFocus.focus();
    if (!this.decided && !this.banner && this.config.design.layout !== "modal") this.renderBanner();
  }

  private trap(event: KeyboardEvent): void {
    if (!this.modal) return;
    if (event.key === "Escape" && !this.modalBlocking) {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = this.modal.querySelectorAll<HTMLElement>(
      'button, input, a[href], [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable.length) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private categoryRow(
    category: Category,
    name: string,
    description: string,
    checked: boolean,
    locked: boolean,
  ): HTMLElement {
    const row = document.createElement("label");
    row.className = "jf-consent__category";
    row.innerHTML =
      '<input type="checkbox" data-cat="' +
      category +
      '"' +
      (checked ? " checked" : "") +
      (locked ? " disabled" : "") +
      ' aria-describedby="jfc-d-' +
      category +
      '">' +
      '<span class="jf-consent__category-text">' +
      '<span class="jf-consent__category-name"></span>' +
      '<span class="jf-consent__category-desc" id="jfc-d-' +
      category +
      '"></span>' +
      "</span>";
    (row.querySelector(".jf-consent__category-name") as HTMLElement).textContent = name;
    (row.querySelector(".jf-consent__category-desc") as HTMLElement).textContent = description;

    const cookies = this.cookies.filter((c) => c.category === category);
    if (!cookies.length) return row;

    const wrap = document.createElement("div");
    wrap.className = "jf-consent__category-wrap";
    wrap.appendChild(row);
    const details = document.createElement("details");
    details.className = "jf-consent__cookies";
    const summary = document.createElement("summary");
    summary.textContent = `${cookies.length} cookie${cookies.length === 1 ? "" : "s"}`;
    details.appendChild(summary);
    const table = document.createElement("table");
    table.innerHTML =
      "<thead><tr><th>Name</th><th>Purpose</th><th>Set by</th><th>Duration</th></tr></thead><tbody></tbody>";
    const tbody = table.querySelector("tbody")!;
    for (const cookie of cookies) {
      const tr = document.createElement("tr");
      for (const value of [
        cookie.name,
        cookie.purpose,
        cookie.provider || cookie.setBy,
        cookie.duration || "—",
      ]) {
        const td = document.createElement("td");
        td.textContent = value;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    details.appendChild(table);
    wrap.appendChild(details);
    return wrap;
  }

  private teardownUi(): void {
    this.banner?.remove();
    this.banner = null;
    this.modalBlocking = false;
    this.close();
  }

  /** Wire per-embed unlock buttons and the site's re-open triggers. */
  bindStaticTriggers(): void {
    document.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const unlock = target.closest(".jf-consent-embed__unlock");
      if (unlock) {
        const placeholder = unlock.closest(".jf-consent-embed") as HTMLElement | null;
        if (placeholder) this.restoreEmbed(placeholder);
        return;
      }
      if (this.config.reopenSelector && target.closest(this.config.reopenSelector)) {
        event.preventDefault();
        this.open();
      }
    });
  }
}

function start(): void {
  const config = readConfig();
  if (!config || !config.i18n || Object.keys(config.i18n).length === 0) return;
  const manager = new ConsentManager(config);
  const api = {
    get: (category: Category) => manager.get(category),
    all: () => manager.all(),
    /** Is a specific cookie name allowed right now (per the site registry)? */
    allowed: (cookieName: string) => manager.allowed(cookieName),
    onChange: (fn: (choices: Choices) => void) => manager.onChange(fn),
    open: () => manager.open(),
    acceptAll: () => manager.acceptAll(),
    rejectAll: () => manager.rejectAll(),
    save: (choices?: Partial<Choices>) => manager.save(choices),
    categories: ALL,
  };
  (window as unknown as { justflowsConsent: typeof api }).justflowsConsent = api;
  manager.bindStaticTriggers();
  manager.boot();
  document.dispatchEvent(new CustomEvent("justflows:consent-ready"));

  // Cookie registry is fetched async so the config island stays small and the
  // render path stays sync. Disclosure + enforcement apply once it lands.
  if (config.cookiesUrl) {
    fetch(config.cookiesUrl, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : { cookies: [] }))
      .then((body: { cookies?: PublicCookie[] }) => manager.setCookies(body.cookies ?? []))
      .catch(() => {
        /* disclosure is best-effort */
      });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
