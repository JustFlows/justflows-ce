import { useEffect, useMemo, useState } from "react";
import {
  DATE_FORMAT_PRESETS,
  TIME_FORMAT_PRESETS,
  WEEKDAYS,
  formatPhpDate,
} from "@lib/datetime-format";
import MediaImageField from "@components/MediaImageField";
import { useCapability, useSessionRole } from "@components/SessionProvider";
import { initialJson } from "../../ssr-data";

const ROLE_OPTIONS = ["subscriber", "contributor", "author", "editor", "administrator"] as const;
const ROLE_LABELS: Record<(typeof ROLE_OPTIONS)[number], string> = {
  subscriber: "Subscriber",
  contributor: "Contributor",
  author: "Author",
  editor: "Editor",
  administrator: "Administrator",
};

type LanguageOption = {
  code: string;
  name: string;
  nativeName: string;
  isDefault: boolean;
  isActive: boolean;
};

type GeneralState = {
  name: string;
  description: string;
  url: string;
  adminEmail: string;
  usersCanRegister: boolean;
  defaultRole: string;
  siteLanguage: string;
  timezone: string;
  dateFormat: string;
  timeFormat: string;
  startOfWeek: number;
  postsPerPage: string;
  trashRetentionDays: string;
  sitePublic: boolean;
  publicApiEnabled: boolean;
  discourageSearchEngines: boolean;
  mailTransport: string;
  mailFromName: string;
  mailFromAddress: string;
  mailReplyTo: string;
  mailEnvelopeSender: string;
  smtpHost: string;
  smtpPort: string;
  smtpSecure: "none" | "starttls" | "ssl";
  smtpUser: string;
  smtpPass: string;
  smtpPassSet: boolean;
  mailRateLimit: string;
  mailConcurrency: string;
  faviconUrl: string;
};

const EMPTY: GeneralState = {
  name: "",
  description: "",
  url: "",
  adminEmail: "",
  usersCanRegister: false,
  defaultRole: "subscriber",
  siteLanguage: "en-US",
  timezone: "UTC",
  dateFormat: "F j, Y",
  timeFormat: "g:i a",
  startOfWeek: 1,
  postsPerPage: "10",
  trashRetentionDays: "30",
  sitePublic: false,
  publicApiEnabled: false,
  discourageSearchEngines: true,
  mailTransport: "sendmail",
  mailFromName: "",
  mailFromAddress: "",
  mailReplyTo: "",
  mailEnvelopeSender: "",
  smtpHost: "localhost",
  smtpPort: "25",
  smtpSecure: "none",
  smtpUser: "",
  smtpPass: "",
  smtpPassSet: false,
  mailRateLimit: "60",
  mailConcurrency: "5",
  faviconUrl: "",
};

type SettingsPayload = Record<string, unknown> & {
  languages?: LanguageOption[];
  timezones?: string[];
  date_format?: string;
  time_format?: string;
  mail_transports?: Array<{ id: string; label: string }>;
};

function generalFromPayload(data: SettingsPayload): GeneralState {
  return {
    name: typeof data.site_name === "string" ? data.site_name : "My Site",
    description: typeof data.site_description === "string" ? data.site_description : "",
    url: typeof data.site_url === "string" ? data.site_url : "",
    adminEmail: typeof data.admin_email === "string" ? data.admin_email : "",
    usersCanRegister: data.users_can_register === true,
    defaultRole: typeof data.default_role === "string" ? data.default_role : "subscriber",
    siteLanguage: typeof data.site_language === "string" ? data.site_language : "en-US",
    timezone: typeof data.timezone === "string" ? data.timezone : "UTC",
    dateFormat: data.date_format ?? "F j, Y",
    timeFormat: data.time_format ?? "g:i a",
    startOfWeek: Number(data.start_of_week ?? 1),
    postsPerPage: String(data.posts_per_page ?? 10),
    trashRetentionDays: String(data.trash_retention_days ?? 30),
    sitePublic: data.site_public === true,
    publicApiEnabled: data.public_api_enabled === true,
    discourageSearchEngines: data.discourage_search_engines === true,
    mailTransport: typeof data.mail_transport === "string" ? data.mail_transport : "sendmail",
    mailFromName: typeof data.mail_from_name === "string" ? data.mail_from_name : "",
    mailFromAddress: typeof data.mail_from_address === "string" ? data.mail_from_address : "",
    mailReplyTo: typeof data.mail_reply_to === "string" ? data.mail_reply_to : "",
    mailEnvelopeSender:
      typeof data.mail_envelope_sender === "string" ? data.mail_envelope_sender : "",
    smtpHost: typeof data.smtp_host === "string" ? data.smtp_host : "localhost",
    smtpPort: String(data.smtp_port ?? 25),
    smtpSecure:
      data.smtp_secure === "starttls" || data.smtp_secure === "ssl" ? data.smtp_secure : "none",
    smtpUser: typeof data.smtp_user === "string" ? data.smtp_user : "",
    smtpPass: "",
    smtpPassSet: data.smtp_pass_set === true,
    mailRateLimit: String(data.mail_rate_limit ?? 60),
    mailConcurrency: String(data.mail_concurrency ?? 5),
    faviconUrl: typeof data.favicon_url === "string" ? data.favicon_url : "",
  };
}

function groupTimezones(zones: string[]): Array<{ region: string; zones: string[] }> {
  const groups = new Map<string, string[]>();
  for (const zone of zones) {
    const region = zone.includes("/") ? zone.slice(0, zone.indexOf("/")) : "UTC";
    const list = groups.get(region) ?? [];
    list.push(zone);
    groups.set(region, list);
  }
  return Array.from(groups.entries()).map(([region, list]) => ({ region, zones: list }));
}

export default function SettingsPage() {
  // Reading settings is open to every admin-eligible role; saving them (and
  // sending a test email) is administrator-only.
  const canManage = useSessionRole() === "administrator";
  const canReadMail = useCapability("mail:read");
  const canManageMail = useCapability("mail:manage");
  const prefetched = initialJson<SettingsPayload>("/api/settings");
  const initialGeneral = prefetched ? generalFromPayload(prefetched) : EMPTY;
  const [general, setGeneral] = useState<GeneralState>(initialGeneral);
  const [languages, setLanguages] = useState<LanguageOption[]>(prefetched?.languages ?? []);
  const [timezones, setTimezones] = useState<string[]>(
    prefetched?.timezones?.length ? prefetched.timezones : ["UTC"],
  );
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!prefetched);
  const [customDate, setCustomDate] = useState(
    prefetched
      ? !(DATE_FORMAT_PRESETS as readonly string[]).includes(initialGeneral.dateFormat)
      : false,
  );
  const [customTime, setCustomTime] = useState(
    prefetched
      ? !(TIME_FORMAT_PRESETS as readonly string[]).includes(initialGeneral.timeFormat)
      : false,
  );
  const [testingMail, setTestingMail] = useState(false);
  const [mailTest, setMailTest] = useState<string | null>(null);
  const [mailTransports, setMailTransports] = useState(
    prefetched?.mail_transports ?? [
      { id: "sendmail", label: "Sendmail (local)" },
      { id: "smtp", label: "SMTP" },
    ],
  );

  const now = useMemo(() => new Date(), [general.timezone, general.dateFormat, general.timeFormat]);
  const utcTime = formatPhpDate(now, "Y-m-d H:i:s", { timeZone: "UTC" });
  const localTime = formatPhpDate(now, "Y-m-d H:i:s", { timeZone: general.timezone || "UTC" });

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data: SettingsPayload) => {
        const dateFormat = data.date_format ?? "F j, Y";
        const timeFormat = data.time_format ?? "g:i a";
        setGeneral(generalFromPayload(data));
        setLanguages(data.languages ?? []);
        setTimezones(
          Array.isArray(data.timezones) && data.timezones.length > 0 ? data.timezones : ["UTC"],
        );
        if (data.mail_transports) setMailTransports(data.mail_transports);
        setCustomDate(!(DATE_FORMAT_PRESETS as readonly string[]).includes(dateFormat));
        setCustomTime(!(TIME_FORMAT_PRESETS as readonly string[]).includes(timeFormat));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function patch(partial: Partial<GeneralState>) {
    setGeneral((s) => ({ ...s, ...partial }));
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site_name: general.name,
          site_description: general.description,
          site_url: general.url,
          admin_email: general.adminEmail,
          users_can_register: general.usersCanRegister,
          default_role: general.defaultRole,
          site_language: general.siteLanguage,
          timezone: general.timezone,
          date_format: general.dateFormat,
          time_format: general.timeFormat,
          start_of_week: general.startOfWeek,
          posts_per_page: Number(general.postsPerPage),
          trash_retention_days: Number(general.trashRetentionDays),
          site_public: general.sitePublic,
          public_api_enabled: general.publicApiEnabled,
          discourage_search_engines: general.discourageSearchEngines,
          mail_transport: general.mailTransport,
          mail_from_name: general.mailFromName,
          mail_from_address: general.mailFromAddress,
          mail_reply_to: general.mailReplyTo,
          mail_envelope_sender: general.mailEnvelopeSender,
          smtp_host: general.smtpHost,
          smtp_port: Number(general.smtpPort),
          smtp_secure: general.smtpSecure,
          smtp_user: general.smtpUser,
          ...(general.smtpPass ? { smtp_pass: general.smtpPass } : {}),
          mail_rate_limit: Number(general.mailRateLimit),
          mail_concurrency: Number(general.mailConcurrency),
          favicon_url: general.faviconUrl,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to save");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      if (general.smtpPass) patch({ smtpPass: "", smtpPassSet: true });
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function testMail() {
    setMailTest(null);
    setError(null);
    setTestingMail(true);
    try {
      const res = await fetch("/api/settings/test-mail", { method: "POST" });
      const data = (await res.json()) as { error?: string; response?: string };
      if (!res.ok) {
        setMailTest(data.error ?? "Could not send test email");
        return;
      }
      setMailTest(
        `Sent to ${general.adminEmail}. Transport response: ${data.response ?? "Accepted"}`,
      );
    } catch (e) {
      setMailTest(String(e));
    } finally {
      setTestingMail(false);
    }
  }

  if (loading) {
    return (
      <div className="jf-page" aria-busy="true">
        <div className="jf-skeleton" style={{ height: 44, maxWidth: 260 }} />
        <div className="jf-skeleton" style={{ height: 260 }} />
      </div>
    );
  }

  const timezoneGroups = groupTimezones(timezones);
  const dateIsCustom =
    customDate || !(DATE_FORMAT_PRESETS as readonly string[]).includes(general.dateFormat);
  const timeIsCustom =
    customTime || !(TIME_FORMAT_PRESETS as readonly string[]).includes(general.timeFormat);

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>General Settings</h1>
          <p>Site title, membership, language, and how dates are displayed</p>
        </div>
      </header>

      {/* Native fieldset disabling covers every input/select/textarea/button
          below in one shot — cheaper and less error-prone than gating each
          of the dozens of controls in this form individually. */}
      <fieldset disabled={!canManage} style={{ border: 0, margin: 0, padding: 0 }}>
        <Section title="Site identity">
          <div className="jf-grid jf-grid--2">
            <div className="jf-field">
              <label className="jf-field__label" htmlFor="jf-site-name">
                Site Title
              </label>
              <input
                id="jf-site-name"
                className="jf-input"
                value={general.name}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </div>
            <div className="jf-field">
              <label className="jf-field__label" htmlFor="jf-site-url">
                Site Address (URL)
              </label>
              <input
                id="jf-site-url"
                className="jf-input"
                value={general.url}
                placeholder="https://example.com"
                onChange={(e) => patch({ url: e.target.value })}
              />
              <p className="jf-field__hint">
                The address people type in their browser to reach this site.
              </p>
            </div>
          </div>
          <div className="jf-field">
            <label className="jf-field__label" htmlFor="jf-tagline">
              Tagline
            </label>
            <input
              id="jf-tagline"
              className="jf-input"
              value={general.description}
              placeholder="Just another great website"
              onChange={(e) => patch({ description: e.target.value })}
            />
            <p className="jf-field__hint">In a few words, explain what this site is about.</p>
          </div>
          <MediaImageField
            id="jf-site-icon"
            label="Site Icon"
            description="Used as the browser and app icon. Square images work best, at least 512 × 512 pixels."
            value={general.faviconUrl}
            onChange={(url) => patch({ faviconUrl: url })}
            square
          />
        </Section>

        <Section title="Administration">
          <div className="jf-field">
            <label className="jf-field__label" htmlFor="jf-admin-email">
              Administration Email Address
            </label>
            <input
              id="jf-admin-email"
              className="jf-input"
              type="email"
              value={general.adminEmail}
              placeholder="admin@example.com"
              required
              onChange={(e) => patch({ adminEmail: e.target.value })}
            />
            <p className="jf-field__hint">
              Used for site administration notifications such as comment moderation, new user
              registrations, and system alerts. This is not the email address you log in with.
            </p>
          </div>
        </Section>

        <Section title="Outgoing mail">
          <p className="jf-field__hint" style={{ marginTop: 0 }}>
            Sends through the server itself — the same idea as PHPMailer. Sendmail uses the
            host&apos;s local mailer. Switch to SMTP if this machine needs authenticated submission
            (Plesk mailbox, localhost:587, and so on).
          </p>
          <div className="jf-grid jf-grid--2">
            <div className="jf-field">
              <label className="jf-field__label" htmlFor="jf-mail-transport">
                Mailer
              </label>
              <select
                id="jf-mail-transport"
                className="jf-input"
                value={general.mailTransport}
                onChange={(e) => patch({ mailTransport: e.target.value })}
              >
                {mailTransports.map((transport) => (
                  <option key={transport.id} value={transport.id}>
                    {transport.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="jf-field">
              <label className="jf-field__label" htmlFor="jf-mail-from-name">
                From name
              </label>
              <input
                id="jf-mail-from-name"
                className="jf-input"
                value={general.mailFromName}
                placeholder={general.name || "Site name"}
                onChange={(e) => patch({ mailFromName: e.target.value })}
              />
              <p className="jf-field__hint">
                Leave blank to use the site title. From address is the administration email.
              </p>
            </div>
          </div>
          <div className="jf-grid jf-grid--2">
            <div className="jf-field">
              <label className="jf-field__label" htmlFor="jf-mail-from-address">
                From address
              </label>
              <input
                id="jf-mail-from-address"
                className="jf-input"
                type="email"
                value={general.mailFromAddress}
                placeholder={general.adminEmail}
                onChange={(e) => patch({ mailFromAddress: e.target.value })}
              />
            </div>
            <div className="jf-field">
              <label className="jf-field__label" htmlFor="jf-mail-reply-to">
                Reply-To
              </label>
              <input
                id="jf-mail-reply-to"
                className="jf-input"
                type="email"
                value={general.mailReplyTo}
                onChange={(e) => patch({ mailReplyTo: e.target.value })}
              />
            </div>
            <div className="jf-field">
              <label className="jf-field__label" htmlFor="jf-mail-envelope">
                Envelope sender
              </label>
              <input
                id="jf-mail-envelope"
                className="jf-input"
                type="email"
                value={general.mailEnvelopeSender}
                onChange={(e) => patch({ mailEnvelopeSender: e.target.value })}
              />
            </div>
            <div className="jf-field">
              <label className="jf-field__label" htmlFor="jf-mail-rate">
                Rate / concurrency
              </label>
              <div className="jf-row">
                <input
                  id="jf-mail-rate"
                  aria-label="Messages per minute"
                  className="jf-input"
                  type="number"
                  min="1"
                  value={general.mailRateLimit}
                  onChange={(e) => patch({ mailRateLimit: e.target.value })}
                />
                <input
                  aria-label="Concurrent messages"
                  className="jf-input"
                  type="number"
                  min="1"
                  value={general.mailConcurrency}
                  onChange={(e) => patch({ mailConcurrency: e.target.value })}
                />
              </div>
            </div>
          </div>
          {general.mailTransport === "smtp" && (
            <>
              <div className="jf-grid jf-grid--2">
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="jf-smtp-host">
                    SMTP host
                  </label>
                  <input
                    id="jf-smtp-host"
                    className="jf-input"
                    value={general.smtpHost}
                    placeholder="localhost"
                    onChange={(e) => patch({ smtpHost: e.target.value })}
                  />
                </div>
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="jf-smtp-port">
                    Port
                  </label>
                  <input
                    id="jf-smtp-port"
                    className="jf-input"
                    type="number"
                    min={1}
                    max={65535}
                    value={general.smtpPort}
                    onChange={(e) => patch({ smtpPort: e.target.value })}
                  />
                </div>
              </div>
              <div className="jf-grid jf-grid--2">
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="jf-smtp-secure">
                    Encryption
                  </label>
                  <select
                    id="jf-smtp-secure"
                    className="jf-input"
                    value={general.smtpSecure}
                    onChange={(e) => {
                      const value = e.target.value;
                      patch({
                        smtpSecure: value === "starttls" || value === "ssl" ? value : "none",
                      });
                    }}
                  >
                    <option value="none">None</option>
                    <option value="starttls">STARTTLS</option>
                    <option value="ssl">SSL/TLS</option>
                  </select>
                </div>
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="jf-smtp-user">
                    Username
                  </label>
                  <input
                    id="jf-smtp-user"
                    className="jf-input"
                    value={general.smtpUser}
                    autoComplete="off"
                    onChange={(e) => patch({ smtpUser: e.target.value })}
                  />
                </div>
              </div>
              <div className="jf-field" style={{ maxWidth: 320 }}>
                <label className="jf-field__label" htmlFor="jf-smtp-pass">
                  Password
                </label>
                <input
                  id="jf-smtp-pass"
                  className="jf-input"
                  type="password"
                  value={general.smtpPass}
                  autoComplete="new-password"
                  placeholder={general.smtpPassSet ? "Stored — leave blank to keep" : ""}
                  onChange={(e) => patch({ smtpPass: e.target.value })}
                />
              </div>
            </>
          )}
          <div className="jf-row">
            <button type="button" className="jf-btn" onClick={testMail} disabled={testingMail}>
              {testingMail ? "Sending…" : "Send test email"}
            </button>
            {mailTest && <span className="jf-field__hint">{mailTest}</span>}
          </div>
          <p className="jf-field__hint">
            Save mail settings before sending a test. The message goes to the administration email
            address.
          </p>
          <p className="jf-field__hint">
            Publish SPF for your sending host, enable DKIM at the provider, and add a DMARC policy
            for the From domain. Justflows reports these as guidance and does not alter DNS.
          </p>
        </Section>

        <Section title="Membership">
          <label className="jf-checkrow">
            <input
              type="checkbox"
              checked={general.usersCanRegister}
              onChange={(e) => patch({ usersCanRegister: e.target.checked })}
            />
            <span>Anyone can register</span>
          </label>
          <p className="jf-field__hint">
            When checked, visitors can create an account at <code>/register</code>. New accounts
            receive the default role below.
          </p>
          <div className="jf-field" style={{ maxWidth: 280 }}>
            <label className="jf-field__label" htmlFor="jf-default-role">
              New User Default Role
            </label>
            <select
              id="jf-default-role"
              className="jf-input"
              value={general.defaultRole}
              onChange={(e) => patch({ defaultRole: e.target.value })}
            >
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </div>
        </Section>

        <Section title="Language">
          <div className="jf-field" style={{ maxWidth: 320 }}>
            <label className="jf-field__label" htmlFor="jf-site-language">
              Site Language
            </label>
            <select
              id="jf-site-language"
              className="jf-input"
              value={general.siteLanguage}
              onChange={(e) => patch({ siteLanguage: e.target.value })}
            >
              {(languages.length > 0
                ? languages
                : [
                    {
                      code: "en-US",
                      name: "English",
                      nativeName: "English",
                      isDefault: true,
                      isActive: true,
                    },
                  ]
              ).map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.nativeName} ({lang.code})
                </option>
              ))}
            </select>
            <p className="jf-field__hint">
              Default language for published content. Add more languages under{" "}
              <a href="/admin/languages">Languages</a>.
            </p>
          </div>
        </Section>

        <Section title="Timezone">
          <div className="jf-field" style={{ maxWidth: 420 }}>
            <label className="jf-field__label" htmlFor="jf-tz">
              Timezone
            </label>
            <select
              id="jf-tz"
              className="jf-input"
              value={general.timezone}
              onChange={(e) => patch({ timezone: e.target.value })}
            >
              {timezoneGroups.map((group) => (
                <optgroup key={group.region} label={group.region}>
                  {group.zones.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz.replace(/_/g, " ")}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="jf-field__hint">
              Universal time is <strong>{utcTime}</strong>. Local time is{" "}
              <strong>{localTime}</strong>.
            </p>
          </div>
        </Section>

        <Section title="Date and time">
          <FormatPicker
            legend="Date Format"
            name="date_format"
            presets={DATE_FORMAT_PRESETS}
            value={general.dateFormat}
            custom={dateIsCustom}
            preview={(fmt) => formatPhpDate(now, fmt, { timeZone: general.timezone })}
            onSelect={(fmt, isCustom) => {
              setCustomDate(isCustom);
              patch({ dateFormat: fmt });
            }}
          />
          <FormatPicker
            legend="Time Format"
            name="time_format"
            presets={TIME_FORMAT_PRESETS}
            value={general.timeFormat}
            custom={timeIsCustom}
            preview={(fmt) => formatPhpDate(now, fmt, { timeZone: general.timezone })}
            onSelect={(fmt, isCustom) => {
              setCustomTime(isCustom);
              patch({ timeFormat: fmt });
            }}
          />
          <div className="jf-field" style={{ maxWidth: 240 }}>
            <label className="jf-field__label" htmlFor="jf-week-start">
              Week Starts On
            </label>
            <select
              id="jf-week-start"
              className="jf-input"
              value={general.startOfWeek}
              onChange={(e) => patch({ startOfWeek: Number(e.target.value) })}
            >
              {WEEKDAYS.map((day) => (
                <option key={day.value} value={day.value}>
                  {day.label}
                </option>
              ))}
            </select>
          </div>
        </Section>

        <Section title="Site visibility">
          <label className="jf-checkrow">
            <input
              type="checkbox"
              checked={general.sitePublic}
              onChange={(e) => patch({ sitePublic: e.target.checked })}
            />
            <span>Site is live</span>
          </label>
          <p className="jf-field__hint">
            When unchecked, visitors see an under-construction page. Administrators and editors can
            still browse the site while logged in.
          </p>
        </Section>

        <Section title="Public API">
          <label className="jf-checkrow">
            <input
              type="checkbox"
              checked={general.publicApiEnabled}
              onChange={(e) => patch({ publicApiEnabled: e.target.checked })}
            />
            <span>Expose the public API</span>
          </label>
          <p className="jf-field__hint">
            When unchecked, every public-facing endpoint (<code>/api/v1/*</code>,{" "}
            <code>/api/site/*</code>) answers <code>404</code> for visitors — headless clients and
            integrations lose access. The admin API and everything the system uses internally keep
            working, and administrators and editors can still call the public endpoints while logged
            in.
          </p>
        </Section>

        <Section title="Search engines">
          <label className="jf-checkrow">
            <input
              type="checkbox"
              checked={general.discourageSearchEngines}
              onChange={(e) => patch({ discourageSearchEngines: e.target.checked })}
            />
            <span>Discourage search engines from indexing this site</span>
          </label>
          <p className="jf-field__hint">
            Adds a <code>noindex</code> meta tag and blocks crawlers via <code>robots.txt</code>.
            Independent of the live setting.
          </p>
        </Section>

        <Section title="Reading">
          <div className="jf-field" style={{ maxWidth: 200 }}>
            <label className="jf-field__label" htmlFor="jf-ppp">
              Blog pages show at most
            </label>
            <input
              id="jf-ppp"
              className="jf-input"
              type="number"
              min={1}
              max={100}
              value={general.postsPerPage}
              onChange={(e) => patch({ postsPerPage: e.target.value })}
            />
            <p className="jf-field__hint">posts</p>
          </div>
        </Section>

        <Section title="Trash retention">
          <div className="jf-field" style={{ maxWidth: 240 }}>
            <label className="jf-field__label" htmlFor="jf-trash-retention">
              Permanently delete trashed items after
            </label>
            <input
              id="jf-trash-retention"
              className="jf-input"
              type="number"
              min={1}
              max={3650}
              value={general.trashRetentionDays}
              onChange={(e) => patch({ trashRetentionDays: e.target.value })}
            />
            <p className="jf-field__hint">days (default: 30)</p>
          </div>
        </Section>
      </fieldset>

      {canReadMail && <EmailOperations canRetry={canManageMail} />}

      {canManage && (
        <div className="jf-row">
          <button className="jf-btn jf-btn--primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save Changes"}
          </button>
          {saved && <span className="jf-status jf-status--saved">✓ Settings saved</span>}
          {error && <span className="jf-status jf-status--error">{error}</span>}
        </div>
      )}

      {canManage && <DiscussionSettings />}
    </div>
  );
}

type Delivery = {
  id: string;
  message_type: string;
  recipient_masked: string;
  subject: string;
  status: string;
  transport: string;
  attempts: number;
  provider_response: string | null;
  error_detail: string | null;
  created_at: string;
};

function EmailOperations({ canRetry }: { canRetry: boolean }) {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function load() {
    const response = await fetch(
      `/api/settings/email/logs${filter ? `?status=${encodeURIComponent(filter)}` : ""}`,
    );
    const data = (await response.json()) as { deliveries?: Delivery[]; error?: string };
    if (!response.ok) throw new Error(data.error ?? "Could not load email log");
    setDeliveries(data.deliveries ?? []);
  }
  useEffect(() => {
    void load().catch((e) => setError(String(e)));
  }, [filter]);
  async function retry(id: string) {
    const response = await fetch(`/api/settings/email/logs/${id}/retry`, { method: "POST" });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) setError(data.error ?? "Retry failed");
    else await load();
  }
  return (
    <Section title="Email delivery log">
      <div className="jf-row">
        <label className="jf-field__label" htmlFor="jf-mail-status">
          Status
        </label>
        <select
          id="jf-mail-status"
          className="jf-input"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="">All</option>
          <option value="queued">Queued</option>
          <option value="sent">Sent</option>
          <option value="deferred">Deferred</option>
          <option value="failed">Failed / dead letter</option>
        </select>
        <button type="button" className="jf-btn" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {error && (
        <p role="alert" className="jf-error">
          {error}
        </p>
      )}
      {deliveries.length === 0 ? (
        <p className="jf-field__hint">No outbound email matches this status.</p>
      ) : (
        <div className="jf-table-wrap">
          <table className="jf-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Type / recipient</th>
                <th>Subject</th>
                <th>Status</th>
                <th>Transport response</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {deliveries.map((row) => (
                <tr key={row.id}>
                  <td>{new Date(row.created_at).toLocaleString()}</td>
                  <td>
                    {row.message_type}
                    <br />
                    <span className="jf-meta">{row.recipient_masked}</span>
                  </td>
                  <td>{row.subject}</td>
                  <td>
                    {row.status} ({row.attempts})
                  </td>
                  <td>{row.error_detail ?? row.provider_response ?? "—"}</td>
                  <td>
                    {canRetry && row.status !== "sent" && (
                      <button type="button" className="jf-btn" onClick={() => void retry(row.id)}>
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

type CommentSettingsState = {
  enabled: boolean;
  requireModeration: boolean;
  closeAfterDays: number;
  allowUrls: boolean;
  notifyModerator: boolean;
  maxLength: number;
  threadMaxDepth: number;
  pageSize: number;
  captchaProvider: "none" | "turnstile" | "hcaptcha" | "recaptcha" | "recaptcha-v3";
  captchaSiteKey: string;
  captchaScoreThreshold: number;
  captchaSecretKeySet: boolean;
};

const DISCUSSION_DEFAULTS: CommentSettingsState = {
  enabled: false,
  requireModeration: true,
  closeAfterDays: 0,
  allowUrls: true,
  notifyModerator: true,
  maxLength: 5000,
  threadMaxDepth: 6,
  pageSize: 50,
  captchaProvider: "none",
  captchaSiteKey: "",
  captchaScoreThreshold: 0.5,
  captchaSecretKeySet: false,
};

function DiscussionSettings() {
  const [state, setState] = useState<CommentSettingsState>(DISCUSSION_DEFAULTS);
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/comments")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load failed"))))
      .then((data: Partial<CommentSettingsState>) => {
        if (!cancelled) setState({ ...DISCUSSION_DEFAULTS, ...data });
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  function patch(next: Partial<CommentSettingsState>) {
    setState((s) => ({ ...s, ...next }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { ...state };
      delete payload.captchaSecretKeySet;
      if (secret) payload.captchaSecretKey = secret;
      const res = await fetch("/api/settings/comments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to save");
        return;
      }
      setState({ ...DISCUSSION_DEFAULTS, ...data });
      setSecret("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;

  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
      <Section title="Discussion">
        <label className="jf-checkrow">
          <input
            type="checkbox"
            checked={state.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
          />
          <span>Allow comments on the site</span>
        </label>
        <p className="jf-field__hint">
          Comments still only appear on a post that has a Comments block. A post's own Discussion
          setting can override this either way.
        </p>

        <label className="jf-checkrow">
          <input
            type="checkbox"
            checked={state.requireModeration}
            onChange={(e) => patch({ requireModeration: e.target.checked })}
          />
          <span>Hold new comments for moderation</span>
        </label>

        <label className="jf-checkrow">
          <input
            type="checkbox"
            checked={state.notifyModerator}
            onChange={(e) => patch({ notifyModerator: e.target.checked })}
          />
          <span>Email the admin address when a comment needs moderation</span>
        </label>

        <label className="jf-checkrow">
          <input
            type="checkbox"
            checked={state.allowUrls}
            onChange={(e) => patch({ allowUrls: e.target.checked })}
          />
          <span>Show a website field and link commenter names</span>
        </label>

        <div className="jf-grid jf-grid--2">
          <div className="jf-field">
            <label className="jf-field__label" htmlFor="jf-c-close">
              Close comments after
            </label>
            <input
              id="jf-c-close"
              className="jf-input"
              type="number"
              min={0}
              max={3650}
              value={state.closeAfterDays}
              onChange={(e) => patch({ closeAfterDays: Number(e.target.value) })}
            />
            <p className="jf-field__hint">days (0 = never)</p>
          </div>
          <div className="jf-field">
            <label className="jf-field__label" htmlFor="jf-c-page">
              Comments per page
            </label>
            <input
              id="jf-c-page"
              className="jf-input"
              type="number"
              min={5}
              max={200}
              value={state.pageSize}
              onChange={(e) => patch({ pageSize: Number(e.target.value) })}
            />
          </div>
          <div className="jf-field">
            <label className="jf-field__label" htmlFor="jf-c-max">
              Maximum comment length
            </label>
            <input
              id="jf-c-max"
              className="jf-input"
              type="number"
              min={200}
              max={20000}
              value={state.maxLength}
              onChange={(e) => patch({ maxLength: Number(e.target.value) })}
            />
            <p className="jf-field__hint">characters</p>
          </div>
          <div className="jf-field">
            <label className="jf-field__label" htmlFor="jf-c-depth">
              Maximum reply depth
            </label>
            <input
              id="jf-c-depth"
              className="jf-input"
              type="number"
              min={1}
              max={10}
              value={state.threadMaxDepth}
              onChange={(e) => patch({ threadMaxDepth: Number(e.target.value) })}
            />
          </div>
        </div>

        <div className="jf-field">
          <label className="jf-field__label" htmlFor="jf-c-captcha">
            Spam protection (CAPTCHA)
          </label>
          <select
            id="jf-c-captcha"
            className="jf-input"
            value={state.captchaProvider}
            onChange={(e) =>
              patch({ captchaProvider: e.target.value as CommentSettingsState["captchaProvider"] })
            }
          >
            <option value="none">None (honeypot + rate limit only)</option>
            <option value="turnstile">Cloudflare Turnstile</option>
            <option value="hcaptcha">hCaptcha</option>
            <option value="recaptcha">Google reCAPTCHA v2</option>
            <option value="recaptcha-v3">Google reCAPTCHA v3</option>
          </select>
          <p className="jf-field__hint">
            The provider and keys set here are also used by any form (Extensions → Forms) that has
            “Require a CAPTCHA on this form” turned on.
          </p>
        </div>
        {state.captchaProvider !== "none" && (
          <div className="jf-grid jf-grid--2">
            <div className="jf-field">
              <label className="jf-field__label" htmlFor="jf-c-site">
                Site key
              </label>
              <input
                id="jf-c-site"
                className="jf-input"
                type="text"
                value={state.captchaSiteKey}
                onChange={(e) => patch({ captchaSiteKey: e.target.value })}
              />
            </div>
            <div className="jf-field">
              <label className="jf-field__label" htmlFor="jf-c-secret">
                Secret key
              </label>
              <input
                id="jf-c-secret"
                className="jf-input"
                type="password"
                placeholder={state.captchaSecretKeySet ? "•••••••• (stored)" : ""}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
              />
              <p className="jf-field__hint">Leave blank to keep the stored key.</p>
            </div>
          </div>
        )}
        {state.captchaProvider === "recaptcha-v3" && (
          <div className="jf-field">
            <label className="jf-field__label" htmlFor="jf-c-score">
              Minimum reCAPTCHA score
            </label>
            <input
              id="jf-c-score"
              className="jf-input"
              type="number"
              min={0}
              max={1}
              step={0.1}
              value={state.captchaScoreThreshold}
              onChange={(e) => patch({ captchaScoreThreshold: Number(e.target.value) })}
            />
            <p className="jf-field__hint">
              0 allows more submissions; 1 is strictest. The recommended starting value is 0.5.
            </p>
          </div>
        )}

        <div className="jf-row" style={{ marginTop: "1rem" }}>
          <button className="jf-btn jf-btn--primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save discussion settings"}
          </button>
          {saved && <span className="jf-status jf-status--saved">✓ Saved</span>}
          {error && <span className="jf-status jf-status--error">{error}</span>}
        </div>
      </Section>
    </fieldset>
  );
}

function FormatPicker({
  legend,
  name,
  presets,
  value,
  custom,
  preview,
  onSelect,
}: {
  legend: string;
  name: string;
  presets: readonly string[];
  value: string;
  custom: boolean;
  preview: (format: string) => string;
  onSelect: (format: string, custom: boolean) => void;
}) {
  return (
    <fieldset className="jf-choice">
      <legend className="jf-field__label">{legend}</legend>
      {presets.map((fmt) => (
        <label key={fmt} className="jf-checkrow">
          <input
            type="radio"
            name={name}
            checked={!custom && value === fmt}
            onChange={() => onSelect(fmt, false)}
          />
          <code className="jf-code">{fmt}</code>
          <span className="jf-checkrow__meta">{preview(fmt)}</span>
        </label>
      ))}
      <label className="jf-checkrow">
        <input type="radio" name={name} checked={custom} onChange={() => onSelect(value, true)} />
        <span>Custom:</span>
        <input
          className="jf-input"
          style={{ maxWidth: 180 }}
          value={custom ? value : ""}
          placeholder={presets[0]}
          aria-label={`Custom ${legend.toLowerCase()}`}
          onFocus={() => onSelect(value || presets[0]!, true)}
          onChange={(e) => onSelect(e.target.value, true)}
        />
        {custom && value && <span className="jf-checkrow__meta">{preview(value)}</span>}
      </label>
    </fieldset>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="jf-card">
      <div className="jf-card__head">
        <h2 className="jf-card__title">{title}</h2>
      </div>
      <div className="jf-card__body jf-stack">{children}</div>
    </div>
  );
}
