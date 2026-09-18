// SPDX-License-Identifier: MIT

import { useEffect, useState, type FormEvent } from "react";
import { useT } from "../../i18n/I18nProvider";
import MediaImageField from "../../components/MediaImageField";

type DisplayMode = "standalone" | "fullscreen" | "minimal-ui" | "browser";

interface Shortcut {
  name: string;
  url: string;
  description: string;
}

interface PwaSettings {
  enabled: boolean;
  appName: string;
  shortName: string;
  description: string;
  iconUrl: string;
  icon192Url: string;
  icon512Url: string;
  appleTouchIconUrl: string;
  maskableIconUrl: string;
  maskableIcon192Url: string;
  maskableIcon512Url: string;
  themeColor: string;
  backgroundColor: string;
  display: DisplayMode;
  startUrl: string;
  shortcuts: Shortcut[];
  installUi: { enabled: boolean; label: string; description: string; showLogo: boolean };
  offline: { title: string; message: string; imageUrl: string };
  assetCache: { enabled: boolean; maxEntries: number; maxAgeSeconds: number };
  diagnostics?: { https: boolean; manifestUrl: string; serviceWorkerUrl: string };
}

const MAX_SHORTCUTS = 4;

function emptyShortcut(): Shortcut {
  return { name: "", url: "", description: "" };
}

export default function PwaSettingsPage() {
  const { t } = useT();
  const [settings, setSettings] = useState<PwaSettings | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [saving, setSaving] = useState(false);
  const [swRegistered, setSwRegistered] = useState<boolean | null>(null);

  async function load() {
    setError("");
    try {
      const response = await fetch("/api/settings/pwa");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? t("pwa.failed"));
      setSettings(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("pwa.failed"));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      setSwRegistered(false);
      return;
    }
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => setSwRegistered(Boolean(reg)))
      .catch(() => setSwRegistered(false));
  }, [settings?.enabled]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;
    setSaving(true);
    setError("");
    setSaved("");
    try {
      const response = await fetch("/api/settings/pwa", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? t("pwa.failed"));
      setSettings(body);
      setSaved(t("pwa.saved"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("pwa.failed"));
    } finally {
      setSaving(false);
    }
  }

  function updateShortcut(index: number, patch: Partial<Shortcut>) {
    if (!settings) return;
    const shortcuts = settings.shortcuts.map((s, i) => (i === index ? { ...s, ...patch } : s));
    setSettings({ ...settings, shortcuts });
  }

  const enableBlocked = Boolean(settings && (!settings.appName.trim() || !settings.icon512Url));

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("pwa.title")}</h1>
          <p>{t("pwa.description")}</p>
        </div>
      </header>
      {error && (
        <div role="alert" className="jf-alert jf-alert--error">
          {error}{" "}
          {!settings && (
            <button className="jf-btn" onClick={() => void load()}>
              {t("pwa.retry")}
            </button>
          )}
        </div>
      )}
      {saved && (
        <div role="status" className="jf-alert jf-alert--success">
          {saved}
        </div>
      )}
      {!settings ? (
        !error && <p>{t("common.loading")}</p>
      ) : (
        <form onSubmit={save} className="jf-stack">
          <fieldset
            disabled={saving}
            className="jf-stack"
            style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
            aria-label={t("pwa.title")}
          >
            <section className="jf-card">
              <div className="jf-card__body jf-stack">
                <label className="jf-checkrow">
                  <input
                    type="checkbox"
                    checked={settings.enabled}
                    disabled={!settings.enabled && enableBlocked}
                    onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
                  />
                  <span>{t("pwa.enable")}</span>
                </label>
                <p className="jf-field__hint">
                  {enableBlocked ? t("pwa.enableRequirementsError") : t("pwa.enableHint")}
                </p>
              </div>
            </section>

            <section className="jf-card">
              <div className="jf-card__head">
                <h2 className="jf-card__title">{t("pwa.identity")}</h2>
              </div>
              <div className="jf-card__body jf-grid jf-grid--2">
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="pwa-app-name">
                    {t("pwa.appName")}
                  </label>
                  <input
                    className="jf-input"
                    id="pwa-app-name"
                    maxLength={100}
                    value={settings.appName}
                    onChange={(e) => setSettings({ ...settings, appName: e.target.value })}
                  />
                </div>
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="pwa-short-name">
                    {t("pwa.shortName")}
                  </label>
                  <input
                    className="jf-input"
                    id="pwa-short-name"
                    maxLength={40}
                    value={settings.shortName}
                    onChange={(e) => setSettings({ ...settings, shortName: e.target.value })}
                  />
                  <p className="jf-field__hint">{t("pwa.shortNameHint")}</p>
                </div>
                <div className="jf-field" style={{ gridColumn: "1 / -1" }}>
                  <label className="jf-field__label" htmlFor="pwa-description">
                    {t("pwa.appDescription")}
                  </label>
                  <textarea
                    className="jf-input"
                    id="pwa-description"
                    maxLength={300}
                    rows={2}
                    value={settings.description}
                    onChange={(e) => setSettings({ ...settings, description: e.target.value })}
                  />
                </div>
              </div>
            </section>

            <section className="jf-card">
              <div className="jf-card__head">
                <h2 className="jf-card__title">{t("pwa.icons")}</h2>
              </div>
              <div className="jf-card__body jf-grid jf-grid--2">
                <div className="jf-field">
                  <MediaImageField
                    id="pwa-icon"
                    label={t("pwa.icon")}
                    description={t("pwa.iconHint")}
                    value={settings.iconUrl}
                    onChange={(url) => setSettings({ ...settings, iconUrl: url })}
                    square
                  />
                </div>
                <div className="jf-field">
                  <MediaImageField
                    id="pwa-maskable-icon"
                    label={t("pwa.maskableIcon")}
                    description={t("pwa.maskableIconHint")}
                    value={settings.maskableIconUrl}
                    onChange={(url) => setSettings({ ...settings, maskableIconUrl: url })}
                    square
                  />
                  {settings.maskableIconUrl && (
                    <div
                      aria-hidden="true"
                      style={{
                        marginTop: ".5rem",
                        width: "96px",
                        height: "96px",
                        borderRadius: "50%",
                        overflow: "hidden",
                        border: "1px dashed var(--jf-border, #ccc)",
                      }}
                    >
                      <img
                        src={settings.maskableIconUrl}
                        alt=""
                        style={{
                          width: "150%",
                          height: "150%",
                          objectFit: "cover",
                          transform: "translate(-16.5%, -16.5%)",
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="jf-card">
              <div className="jf-card__head">
                <h2 className="jf-card__title">{t("pwa.colors")}</h2>
              </div>
              <div className="jf-card__body jf-grid jf-grid--2">
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="pwa-theme-color">
                    {t("pwa.themeColor")}
                  </label>
                  <div style={{ display: "flex", gap: ".5rem", alignItems: "center" }}>
                    <input
                      type="color"
                      id="pwa-theme-color"
                      value={settings.themeColor}
                      onChange={(e) => setSettings({ ...settings, themeColor: e.target.value })}
                    />
                    <input
                      className="jf-input"
                      aria-label={t("pwa.themeColor")}
                      value={settings.themeColor}
                      maxLength={7}
                      onChange={(e) => setSettings({ ...settings, themeColor: e.target.value })}
                    />
                  </div>
                </div>
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="pwa-background-color">
                    {t("pwa.backgroundColor")}
                  </label>
                  <div style={{ display: "flex", gap: ".5rem", alignItems: "center" }}>
                    <input
                      type="color"
                      id="pwa-background-color"
                      value={settings.backgroundColor}
                      onChange={(e) => setSettings({ ...settings, backgroundColor: e.target.value })}
                    />
                    <input
                      className="jf-input"
                      aria-label={t("pwa.backgroundColor")}
                      value={settings.backgroundColor}
                      maxLength={7}
                      onChange={(e) => setSettings({ ...settings, backgroundColor: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            </section>

            <section className="jf-card">
              <div className="jf-card__head">
                <h2 className="jf-card__title">{t("pwa.display")}</h2>
              </div>
              <div className="jf-card__body jf-stack">
                <div className="jf-field">
                  <select
                    className="jf-input"
                    aria-label={t("pwa.display")}
                    value={settings.display}
                    onChange={(e) =>
                      setSettings({ ...settings, display: e.target.value as DisplayMode })
                    }
                  >
                    <option value="standalone">{t("pwa.displayStandalone")}</option>
                    <option value="fullscreen">{t("pwa.displayFullscreen")}</option>
                    <option value="minimal-ui">{t("pwa.displayMinimalUi")}</option>
                    <option value="browser">{t("pwa.displayBrowser")}</option>
                  </select>
                  <p className="jf-field__hint">{t("pwa.displayHint")}</p>
                </div>
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="pwa-start-url">
                    {t("pwa.startUrl")}
                  </label>
                  <input
                    className="jf-input"
                    id="pwa-start-url"
                    maxLength={2048}
                    value={settings.startUrl}
                    onChange={(e) => setSettings({ ...settings, startUrl: e.target.value })}
                  />
                  <p className="jf-field__hint">{t("pwa.startUrlHint")}</p>
                </div>
              </div>
            </section>

            <section className="jf-card">
              <div className="jf-card__head">
                <h2 className="jf-card__title">{t("pwa.shortcuts")}</h2>
              </div>
              <div className="jf-card__body jf-stack">
                <p className="jf-field__hint">{t("pwa.shortcutsHint")}</p>
                {settings.shortcuts.map((shortcut, index) => (
                  <div key={index} className="jf-grid jf-grid--2" style={{ alignItems: "end" }}>
                    <div className="jf-field">
                      <label className="jf-field__label" htmlFor={`pwa-shortcut-name-${index}`}>
                        {t("pwa.shortcutName")}
                      </label>
                      <input
                        className="jf-input"
                        id={`pwa-shortcut-name-${index}`}
                        maxLength={100}
                        value={shortcut.name}
                        onChange={(e) => updateShortcut(index, { name: e.target.value })}
                      />
                    </div>
                    <div className="jf-field" style={{ display: "flex", gap: ".5rem" }}>
                      <div style={{ flex: 1 }}>
                        <label className="jf-field__label" htmlFor={`pwa-shortcut-url-${index}`}>
                          {t("pwa.shortcutUrl")}
                        </label>
                        <input
                          className="jf-input"
                          id={`pwa-shortcut-url-${index}`}
                          maxLength={2048}
                          value={shortcut.url}
                          onChange={(e) => updateShortcut(index, { url: e.target.value })}
                        />
                      </div>
                      <button
                        type="button"
                        className="jf-btn"
                        aria-label={`${t("pwa.removeShortcut")} ${shortcut.name || index + 1}`}
                        onClick={() =>
                          setSettings({
                            ...settings,
                            shortcuts: settings.shortcuts.filter((_, i) => i !== index),
                          })
                        }
                      >
                        {t("pwa.removeShortcut")}
                      </button>
                    </div>
                  </div>
                ))}
                {settings.shortcuts.length < MAX_SHORTCUTS && (
                  <button
                    type="button"
                    className="jf-btn"
                    onClick={() =>
                      setSettings({ ...settings, shortcuts: [...settings.shortcuts, emptyShortcut()] })
                    }
                  >
                    {t("pwa.addShortcut")}
                  </button>
                )}
              </div>
            </section>

            <section className="jf-card">
              <div className="jf-card__head">
                <h2 className="jf-card__title">{t("pwa.installUi")}</h2>
              </div>
              <div className="jf-card__body jf-stack">
                <label className="jf-checkrow">
                  <input
                    type="checkbox"
                    checked={settings.installUi.enabled}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        installUi: { ...settings.installUi, enabled: e.target.checked },
                      })
                    }
                  />
                  <span>{t("pwa.installUiEnable")}</span>
                </label>
                <div className="jf-grid jf-grid--2">
                  <div className="jf-field">
                    <label className="jf-field__label" htmlFor="pwa-install-label">
                      {t("pwa.installUiLabel")}
                    </label>
                    <input
                      className="jf-input"
                      id="pwa-install-label"
                      maxLength={100}
                      value={settings.installUi.label}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          installUi: { ...settings.installUi, label: e.target.value },
                        })
                      }
                    />
                  </div>
                  <div className="jf-field">
                    <label className="jf-field__label" htmlFor="pwa-install-description">
                      {t("pwa.installUiDescription")}
                    </label>
                    <input
                      className="jf-input"
                      id="pwa-install-description"
                      maxLength={300}
                      value={settings.installUi.description}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          installUi: { ...settings.installUi, description: e.target.value },
                        })
                      }
                    />
                  </div>
                </div>
                <label className="jf-checkrow">
                  <input
                    type="checkbox"
                    checked={settings.installUi.showLogo}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        installUi: { ...settings.installUi, showLogo: e.target.checked },
                      })
                    }
                  />
                  <span>{t("pwa.installUiShowLogo")}</span>
                </label>
                <p className="jf-field__hint">{t("pwa.installUiShowLogoHint")}</p>
              </div>
            </section>

            <section className="jf-card">
              <div className="jf-card__head">
                <h2 className="jf-card__title">{t("pwa.offline")}</h2>
              </div>
              <div className="jf-card__body jf-grid jf-grid--2">
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="pwa-offline-title">
                    {t("pwa.offlineTitle")}
                  </label>
                  <input
                    className="jf-input"
                    id="pwa-offline-title"
                    maxLength={150}
                    value={settings.offline.title}
                    onChange={(e) =>
                      setSettings({ ...settings, offline: { ...settings.offline, title: e.target.value } })
                    }
                  />
                </div>
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="pwa-offline-message">
                    {t("pwa.offlineMessage")}
                  </label>
                  <input
                    className="jf-input"
                    id="pwa-offline-message"
                    maxLength={500}
                    value={settings.offline.message}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        offline: { ...settings.offline, message: e.target.value },
                      })
                    }
                  />
                </div>
                <div className="jf-field" style={{ gridColumn: "1 / -1" }}>
                  <MediaImageField
                    id="pwa-offline-image"
                    label={t("pwa.offlineImage")}
                    value={settings.offline.imageUrl}
                    onChange={(url) =>
                      setSettings({ ...settings, offline: { ...settings.offline, imageUrl: url } })
                    }
                    square
                  />
                </div>
              </div>
            </section>

            <section className="jf-card">
              <div className="jf-card__head">
                <h2 className="jf-card__title">{t("pwa.assetCache")}</h2>
              </div>
              <div className="jf-card__body jf-stack">
                <label className="jf-checkrow">
                  <input
                    type="checkbox"
                    checked={settings.assetCache.enabled}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        assetCache: { ...settings.assetCache, enabled: e.target.checked },
                      })
                    }
                  />
                  <span>{t("pwa.assetCacheEnable")}</span>
                </label>
                <p className="jf-field__hint">{t("pwa.assetCacheHint")}</p>
                <div className="jf-grid jf-grid--2">
                  <div className="jf-field">
                    <label className="jf-field__label" htmlFor="pwa-cache-max-entries">
                      {t("pwa.assetCacheMaxEntries")}
                    </label>
                    <input
                      type="number"
                      className="jf-input"
                      id="pwa-cache-max-entries"
                      min={10}
                      max={500}
                      value={settings.assetCache.maxEntries}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          assetCache: {
                            ...settings.assetCache,
                            maxEntries: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </div>
                  <div className="jf-field">
                    <label className="jf-field__label" htmlFor="pwa-cache-max-age">
                      {t("pwa.assetCacheMaxAgeDays")}
                    </label>
                    <input
                      type="number"
                      className="jf-input"
                      id="pwa-cache-max-age"
                      min={1}
                      max={90}
                      value={Math.round(settings.assetCache.maxAgeSeconds / 86400)}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          assetCache: {
                            ...settings.assetCache,
                            maxAgeSeconds: Number(e.target.value) * 86400,
                          },
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            </section>

            <section className="jf-card">
              <div className="jf-card__head">
                <h2 className="jf-card__title">{t("pwa.diagnostics")}</h2>
              </div>
              <div className="jf-card__body jf-stack">
                <ul>
                  <li>
                    <strong>{t("pwa.diagnosticsHttps")}:</strong>{" "}
                    {settings.diagnostics?.https
                      ? t("pwa.diagnosticsHttpsOk")
                      : t("pwa.diagnosticsHttpsWarn")}
                  </li>
                  <li>
                    <strong>{t("pwa.diagnosticsServiceWorker")}:</strong>{" "}
                    {"serviceWorker" in navigator
                      ? t("pwa.diagnosticsServiceWorkerOk")
                      : t("pwa.diagnosticsServiceWorkerMissing")}
                  </li>
                  <li>
                    <strong>{t("pwa.diagnosticsRegistration")}:</strong>{" "}
                    {swRegistered ? t("pwa.diagnosticsRegistered") : t("pwa.diagnosticsNotRegistered")}
                  </li>
                </ul>
                <p className="jf-field__hint">{t("pwa.diagnosticsDisclaimer")}</p>
              </div>
            </section>

            <div className="jf-row">
              <button className="jf-btn jf-btn--primary" type="submit">
                {t(saving ? "pwa.saving" : "pwa.save")}
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </div>
  );
}
