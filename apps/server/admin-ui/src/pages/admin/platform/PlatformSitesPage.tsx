import { useEffect, useState } from "react";
import { Link } from "../../../admin-router";
import { useT } from "../../../i18n/I18nProvider";
import { initialJson } from "../../../ssr-data";

interface Overview {
  tenants: Array<{ id: string; name: string }>;
  sites: Array<{ id: string; tenant_id: string; name: string; hostname: string | null; status: string }>;
}

export default function PlatformSitesPage() {
  const { t } = useT();
  const seeded = initialJson<Overview>("/api/platform/overview");
  const [overview, setOverview] = useState<Overview | null>(seeded ?? null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (seeded) return;
    void fetch("/api/platform/overview")
      .then(async (res) => {
        if (res.status === 403) {
          setError(t("platform.forbidden"));
          return;
        }
        if (!res.ok) throw new Error("Could not load sites");
        setOverview(await res.json() as Overview);
      })
      .catch(() => setError(t("platform.forbidden")));
  }, [seeded, t]);

  const tenants = new Map((overview?.tenants ?? []).map((tenant) => [tenant.id, tenant.name]));
  const sites = overview?.sites ?? [];

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("platform.sites")}</h1>
          <p>{t("platform.sitesIntro")}</p>
        </div>
      </header>
      {error ? <div className="jf-alert jf-alert--error" role="alert">{error}</div> : null}
      {overview && sites.length === 0 ? (
        <div className="jf-empty">
          <div className="jf-empty__title">{t("platform.sitesEmpty")}</div>
        </div>
      ) : overview ? (
        <section className="jf-card">
          <div className="jf-card__body--flush jf-tablewrap">
            <table className="jf-table">
              <thead>
                <tr>
                  <th>{t("platform.sitePage")}</th>
                  <th>{t("platform.hostname")}</th>
                  <th>{t("platform.workspace")}</th>
                  <th>{t("platform.status")}</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((site) => (
                  <tr key={site.id}>
                    <td className="jf-td--strong">
                      <Link to={`/admin/platform/sites/${site.id}`}>{site.name}</Link>
                    </td>
                    <td>{site.hostname ?? "—"}</td>
                    <td>
                      <Link to={`/admin/platform/workspaces/${site.tenant_id}`}>{tenants.get(site.tenant_id) ?? site.tenant_id}</Link>
                    </td>
                    <td>
                      <span className={`jf-badge ${site.status === "suspended" ? "jf-badge--warn" : site.status === "active" ? "jf-badge--ok" : ""}`}>
                        {site.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
