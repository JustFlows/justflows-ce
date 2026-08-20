import { useEffect, useMemo, useState } from "react";
import {
  DATE_FORMAT_PRESETS,
  TIME_FORMAT_PRESETS,
  WEEKDAYS,
  formatPhpDate,
} from "@lib/datetime-format";
import MediaImageField from "@components/MediaImageField";

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
  sitePublic: boolean;
  publicApiEnabled: boolean;
  discourageSearchEngines: boolean;
  mailTransport: "sendmail" | "smtp";
  mailFromName: string;
  smtpHost: string;
  smtpPort: string;
  smtpSecure: "none" | "starttls" | "ssl";
  smtpUser: string;
  smtpPass: string;
  smtpPassSet: boolean;
  faviconUrl: string;
};

const EMPTY: GeneralState = {
  name: "",
  description: "",
  url: "",
  adminEmail: "",
  usersCanRegister: false,
  defaultRole: "subscriber",
  siteLanguage: "en",
  timezone: "UTC",
  dateFormat: "F j, Y",
  timeFormat: "g:i a",
  startOfWeek: 1,
  postsPerPage: "10",
  sitePublic: false,
  publicApiEnabled: true,
  discourageSearchEngines: false,
  mailTransport: "sendmail",
  mailFromName: "",
  smtpHost: "localhost",
  smtpPort: "25",
  smtpSecure: "none",
  smtpUser: "",
  smtpPass: "",
  smtpPassSet: false,
  faviconUrl: "",
};

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
  const [general, setGeneral] = useState<GeneralState>(EMPTY);
  const [languages, setLanguages] = useState<LanguageOption[]>([]);
  const [timezones, setTimezones] = useState<string[]>(["UTC"]);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [customDate, setCustomDate] = useState(false);
  const [customTime, setCustomTime] = useState(false);
  const [testingMail, setTestingMail] = useState(false);
  const [mailTest, setMailTest] = useState<string | null>(null);

  const now = useMemo(() => new Date(), [general.timezone, general.dateFormat, general.timeFormat]);
  const utcTime = formatPhpDate(now, "Y-m-d H:i:s", { timeZone: "UTC" });
  const localTime = formatPhpDate(now, "Y-m-d H:i:s", { timeZone: general.timezone || "UTC" });

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        const dateFormat = data.date_format ?? "F j, Y";
        const timeFormat = data.time_format ?? "g:i a";
        setGeneral({
          name: data.site_name ?? "My Site",
          description: data.site_description ?? "",
          url: data.site_url ?? "",
          adminEmail: data.admin_email ?? "",
          usersCanRegister: data.users_can_register === true,
          defaultRole: data.default_role ?? "subscriber",
          siteLanguage: data.site_language ?? "en",
          timezone: data.timezone ?? "UTC",
          dateFormat,
          timeFormat,
          startOfWeek: Number(data.start_of_week ?? 1),
          postsPerPage: String(data.posts_per_page ?? 10),
          sitePublic: data.site_public === true,
          publicApiEnabled: data.public_api_enabled === true,
          discourageSearchEngines: data.discourage_search_engines === true,
          mailTransport: data.mail_transport === "smtp" ? "smtp" : "sendmail",
          mailFromName: data.mail_from_name ?? "",
          smtpHost: data.smtp_host ?? "localhost",
          smtpPort: String(data.smtp_port ?? 25),
          smtpSecure: data.smtp_secure === "starttls" || data.smtp_secure === "ssl" ? data.smtp_secure : "none",
          smtpUser: data.smtp_user ?? "",
          smtpPass: "",
          smtpPassSet: data.smtp_pass_set === true,
          faviconUrl: data.favicon_url ?? "",
        });
        setLanguages(data.languages ?? []);
        setTimezones(Array.isArray(data.timezones) && data.timezones.length > 0 ? data.timezones : ["UTC"]);
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
          site_public: general.sitePublic,
          public_api_enabled: general.publicApiEnabled,
          discourage_search_engines: general.discourageSearchEngines,
          mail_transport: general.mailTransport,
          mail_from_name: general.mailFromName,
          smtp_host: general.smtpHost,
          smtp_port: Number(general.smtpPort),
          smtp_secure: general.smtpSecure,
          smtp_user: general.smtpUser,
          ...(general.smtpPass ? { smtp_pass: general.smtpPass } : {}),
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
      const data = await res.json() as { error?: string };
      if (!res.ok) {
        setMailTest(data.error ?? "Could not send test email");
        return;
      }
      setMailTest(`Sent a test message to ${general.adminEmail}.`);
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
  const dateIsCustom = customDate || !(DATE_FORMAT_PRESETS as readonly string[]).includes(general.dateFormat);
  const timeIsCustom = customTime || !(TIME_FORMAT_PRESETS as readonly string[]).includes(general.timeFormat);

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>General Settings</h1>
          <p>Site title, membership, language, and how dates are displayed</p>
        </div>
      </header>

      <Section title="Site identity">
        <div className="jf-grid jf-grid--2">
          <div className="jf-field">
            <label className="jf-field__label" htmlFor="jf-site-name">Site Title</label>
            <input
              id="jf-site-name"
              className="jf-input"
              value={general.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </div>
          <div className="jf-field">
            <label className="jf-field__label" htmlFor="jf-site-url">Site Address (URL)</label>
            <input
              id="jf-site-url"
              className="jf-input"
              value={general.url}
              placeholder="https://example.com"
              onChange={(e) => patch({ url: e.target.value })}
            />
            <p className="jf-field__hint">The address people type in their browser to reach this site.</p>
          </div>
        </div>
        <div className="jf-field">
          <label className="jf-field__label" htmlFor="jf-tagline">Tagline</label>
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
          <label className="jf-field__label" htmlFor="jf-admin-email">Administration Email Address</label>
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
            Used for site administration notifications such as comment moderation, new user registrations,
            and system alerts. This is not the email address you log in with.
          </p>
        </div>
      </Section>

      <Section title="Outgoing mail">
        <p className="jf-field__hint" style={{ marginTop: 0 }}>
          Sends through the server itself — the same idea as PHPMailer. Sendmail uses the host&apos;s local mailer.
          Switch to SMTP if this machine needs authenticated submission (Plesk mailbox, localhost:587, and so on).
        </p>
        <div className="jf-grid jf-grid--2">
          <div className="jf-field">
            <label className="jf-field__label" htmlFor="jf-mail-transport">Mailer</label>
            <select
              id="jf-mail-transport"
              className="jf-input"
              value={general.mailTransport}
              onChange={(e) => patch({ mailTransport: e.target.value === "smtp" ? "smtp" : "sendmail" })}
            >
              <option value="sendmail">Sendmail (local)</option>
              <option value="smtp">SMTP</option>
            </select>
          </div>
          <div className="jf-field">
            <label className="jf-field__label" htmlFor="jf-mail-from-name">From name</label>
            <input
              id="jf-mail-from-name"
              className="jf-input"
              value={general.mailFromName}
              placeholder={general.name || "Site name"}
              onChange={(e) => patch({ mailFromName: e.target.value })}
            />
            <p className="jf-field__hint">Leave blank to use the site title. From address is the administration email.</p>
          </div>
        </div>
        {general.mailTransport === "smtp" && (
          <>
            <div className="jf-grid jf-grid--2">
              <div className="jf-field">
                <label className="jf-field__label" htmlFor="jf-smtp-host">SMTP host</label>
                <input
                  id="jf-smtp-host"
                  className="jf-input"
                  value={general.smtpHost}
                  placeholder="localhost"
                  onChange={(e) => patch({ smtpHost: e.target.value })}
                />
              </div>
              <div className="jf-field">
                <label className="jf-field__label" htmlFor="jf-smtp-port">Port</label>
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
                <label className="jf-field__label" htmlFor="jf-smtp-secure">Encryption</label>
                <select
                  id="jf-smtp-secure"
                  className="jf-input"
                  value={general.smtpSecure}
                  onChange={(e) => {
                    const value = e.target.value;
                    patch({ smtpSecure: value === "starttls" || value === "ssl" ? value : "none" });
                  }}
                >
                  <option value="none">None</option>
                  <option value="starttls">STARTTLS</option>
                  <option value="ssl">SSL/TLS</option>
                </select>
              </div>
              <div className="jf-field">
                <label className="jf-field__label" htmlFor="jf-smtp-user">Username</label>
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
              <label className="jf-field__label" htmlFor="jf-smtp-pass">Password</label>
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
        <p className="jf-field__hint">Save mail settings before sending a test. The message goes to the administration email address.</p>
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
          When checked, visitors can create an account at <code>/register</code>. New accounts receive the default role below.
        </p>
        <div className="jf-field" style={{ maxWidth: 280 }}>
          <label className="jf-field__label" htmlFor="jf-default-role">New User Default Role</label>
          <select
            id="jf-default-role"
            className="jf-input"
            value={general.defaultRole}
            onChange={(e) => patch({ defaultRole: e.target.value })}
          >
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>{ROLE_LABELS[role]}</option>
            ))}
          </select>
        </div>
      </Section>

      <Section title="Language">
        <div className="jf-field" style={{ maxWidth: 320 }}>
          <label className="jf-field__label" htmlFor="jf-site-language">Site Language</label>
          <select
            id="jf-site-language"
            className="jf-input"
            value={general.siteLanguage}
            onChange={(e) => patch({ siteLanguage: e.target.value })}
          >
            {(languages.length > 0 ? languages : [{ code: "en", name: "English", nativeName: "English", isDefault: true, isActive: true }]).map((lang) => (
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
          <label className="jf-field__label" htmlFor="jf-tz">Timezone</label>
          <select
            id="jf-tz"
            className="jf-input"
            value={general.timezone}
            onChange={(e) => patch({ timezone: e.target.value })}
          >
            {timezoneGroups.map((group) => (
              <optgroup key={group.region} label={group.region}>
                {group.zones.map((tz) => (
                  <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <p className="jf-field__hint">
            Universal time is <strong>{utcTime}</strong>. Local time is <strong>{localTime}</strong>.
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
          <label className="jf-field__label" htmlFor="jf-week-start">Week Starts On</label>
          <select
            id="jf-week-start"
            className="jf-input"
            value={general.startOfWeek}
            onChange={(e) => patch({ startOfWeek: Number(e.target.value) })}
          >
            {WEEKDAYS.map((day) => (
              <option key={day.value} value={day.value}>{day.label}</option>
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
          When unchecked, visitors see an under-construction page. Administrators and editors can still browse the site while logged in.
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
          When unchecked, every public-facing endpoint (<code>/api/v1/*</code>, <code>/api/site/*</code>)
          answers <code>404</code> for visitors — headless clients and integrations lose access.
          The admin API and everything the system uses internally keep working, and administrators
          and editors can still call the public endpoints while logged in.
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
          Adds a <code>noindex</code> meta tag and blocks crawlers via <code>robots.txt</code>. Independent of the live setting.
        </p>
      </Section>

      <Section title="Reading">
        <div className="jf-field" style={{ maxWidth: 200 }}>
          <label className="jf-field__label" htmlFor="jf-ppp">Blog pages show at most</label>
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

      <div className="jf-row">
        <button className="jf-btn jf-btn--primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save Changes"}
        </button>
        {saved && <span className="jf-status jf-status--saved">✓ Settings saved</span>}
        {error && <span className="jf-status jf-status--error">{error}</span>}
      </div>
    </div>
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
        <input
          type="radio"
          name={name}
          checked={custom}
          onChange={() => onSelect(value, true)}
        />
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
