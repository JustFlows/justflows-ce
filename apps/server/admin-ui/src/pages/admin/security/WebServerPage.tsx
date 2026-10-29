import { useCallback, useEffect, useState } from "react";
import { initialJson } from "../../../ssr-data";
import { useT } from "../../../i18n/I18nProvider";
import { PageSkeleton } from "./components";

type EnvironmentId = "application" | "apache" | "nginx" | "apacheProxy" | "passenger" | "docker";
type HtaccessState = "current" | "pending" | "custom" | "missing";

interface WebServerEnvironment {
  id: EnvironmentId;
  automatic: boolean;
  config: string | null;
}

interface WebServerGuide {
  installationRoot: boolean;
  htaccess: HtaccessState;
  accelConfigured: boolean;
  environments: WebServerEnvironment[];
}

const TITLE: Record<EnvironmentId, string> = {
  application: "security.webServer.environments.application.title",
  apache: "security.webServer.environments.apache.title",
  nginx: "security.webServer.environments.nginx.title",
  apacheProxy: "security.webServer.environments.apacheProxy.title",
  passenger: "security.webServer.environments.passenger.title",
  docker: "security.webServer.environments.docker.title",
};

const BODY: Record<EnvironmentId, string> = {
  application: "security.webServer.environments.application.body",
  apache: "security.webServer.environments.apache.body",
  nginx: "security.webServer.environments.nginx.body",
  apacheProxy: "security.webServer.environments.apacheProxy.body",
  passenger: "security.webServer.environments.passenger.body",
  docker: "security.webServer.environments.docker.body",
};

const HTACCESS: Record<HtaccessState, string> = {
  current: "security.webServer.htaccess.current",
  pending: "security.webServer.htaccess.pending",
  custom: "security.webServer.htaccess.custom",
  missing: "security.webServer.htaccess.missing",
};

export default function WebServerPage() {
  const { t } = useT();
  const prefetched = initialJson<WebServerGuide>("/api/security/web-server");
  const [guide, setGuide] = useState<WebServerGuide | null>(prefetched ?? null);
  const [loading, setLoading] = useState(!prefetched);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<EnvironmentId | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/security/web-server");
      const data = (await res.json().catch(() => ({}))) as WebServerGuide & { error?: string };
      if (!res.ok) throw new Error(data.error ?? t("security.webServer.loadError"));
      setGuide(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("security.webServer.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (prefetched) return;
    void load();
  }, [load, prefetched]);

  async function copyConfig(id: EnvironmentId, config: string) {
    try {
      await navigator.clipboard.writeText(config);
      setCopied(id);
      setTimeout(() => setCopied((current) => (current === id ? null : current)), 2000);
    } catch {
      setError(t("security.webServer.copyError"));
    }
  }

  if (loading && !guide) return <PageSkeleton />;

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("security.webServer.title")}</h1>
          <p>{t("security.webServer.subtitle")}</p>
        </div>
      </header>

      {error && (
        <div className="jf-banner jf-banner--error" role="alert">
          <span className="jf-banner__icon" aria-hidden="true">⚠</span>
          <div>
            <div className="jf-banner__title">{t("security.webServer.loadError")}</div>
            <div className="jf-banner__sub">{error}</div>
          </div>
        </div>
      )}

      {guide && !guide.installationRoot && <p>{t("security.webServer.otherSite")}</p>}

      {guide?.installationRoot && (
        <div className={guide.htaccess === "custom" || guide.htaccess === "missing" ? "jf-banner jf-banner--warn" : "jf-banner jf-banner--ok"}>
          <span className="jf-banner__icon" aria-hidden="true">{guide.htaccess === "current" || guide.htaccess === "pending" ? "✓" : "!"}</span>
          <div>
            <div className="jf-banner__title">{t(HTACCESS[guide.htaccess])}</div>
          </div>
        </div>
      )}

      {guide?.installationRoot && guide.environments.map((environment) => (
        <section className="jf-card" key={environment.id}>
          <div className="jf-card__head">
            <div>
              <h2 className="jf-card__title">{t(TITLE[environment.id])}</h2>
              <p className="jf-field__hint">{t(BODY[environment.id])}</p>
              {(environment.id === "nginx" || environment.id === "docker") && (
                <p className="jf-field__hint">
                  {t(guide.accelConfigured ? "security.webServer.accelOn" : "security.webServer.accelOff")}
                </p>
              )}
            </div>
            <div className="jf-row">
              <span className={`jf-badge ${environment.automatic ? "jf-badge--ok" : "jf-badge--info"}`}>
                {t(environment.automatic ? "security.webServer.automatic" : "security.webServer.manual")}
              </span>
              {environment.config && (
                <button type="button" className="jf-btn jf-btn--ghost" onClick={() => void copyConfig(environment.id, environment.config ?? "")}>
                  {copied === environment.id ? t("security.webServer.copied") : t("security.webServer.copy")}
                </button>
              )}
            </div>
          </div>
          {environment.config && (
            <div className="jf-card__body">
              <pre className="jf-code-snippet jf-code-snippet--file">{environment.config}</pre>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
