import { useEffect, useState } from "react";
import { useT } from "../../../i18n/I18nProvider";
import { initialJson } from "../../../ssr-data";
import QuotaLimitsCard, { type QuotaMeter } from "./QuotaLimitsCard";

interface Defaults {
  workspace: { meters: QuotaMeter[] };
  site: { meters: QuotaMeter[] };
}

export default function PlatformDefaultsPage() {
  const { t } = useT();
  const seeded = initialJson<Defaults>("/api/platform/quota-defaults");
  const [defaults, setDefaults] = useState<Defaults | null>(seeded ?? null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (seeded) return;
    void fetch("/api/platform/quota-defaults")
      .then(async (res) => {
        if (res.status === 403) {
          setError(t("platform.forbidden"));
          return;
        }
        if (!res.ok) throw new Error("Could not load defaults");
        setDefaults(await res.json() as Defaults);
      })
      .catch(() => setError(t("platform.forbidden")));
  }, [seeded, t]);

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("platform.defaults")}</h1>
          <p>{t("platform.defaultsIntro")}</p>
        </div>
      </header>
      {error ? <div className="jf-alert jf-alert--error" role="alert">{error}</div> : null}
      {defaults ? (
        <>
          <QuotaLimitsCard
            endpoint="/api/platform/quota-defaults/workspace"
            meters={defaults.workspace.meters}
            title={t("platform.defaultsWorkspace")}
            intro={t("platform.defaultsWorkspaceIntro")}
            showUsage={false}
          />
          <QuotaLimitsCard
            endpoint="/api/platform/quota-defaults/site"
            meters={defaults.site.meters}
            title={t("platform.defaultsSite")}
            intro={t("platform.defaultsSiteIntro")}
            showUsage={false}
          />
        </>
      ) : null}
    </div>
  );
}
