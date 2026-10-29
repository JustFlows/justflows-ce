import { useCallback, useEffect, useState } from "react";
import { initialJson } from "../../../ssr-data";
import { useT } from "../../../i18n/I18nProvider";
import { PageSkeleton } from "./components";

type PackageStatus = "verified" | "modified" | "missing" | "unexpected" | "unverifiable" | "limit";
type CoreStatus = "verified" | "local" | "absent" | "failed";

interface IntegrityPackage {
  packageId: string;
  packageType: string;
  version: string;
  status: PackageStatus;
  modified: string[];
  missing: string[];
  unexpected: string[];
}

interface IntegrityReport {
  installationRoot: boolean;
  core: CoreStatus;
  packages: IntegrityPackage[];
}

const STATUS_KEY: Record<PackageStatus, string> = {
  verified: "security.integrity.verified",
  modified: "security.integrity.modified",
  missing: "security.integrity.missing",
  unexpected: "security.integrity.unexpected",
  unverifiable: "security.integrity.unverifiable",
  limit: "security.integrity.limit",
};

const CORE_KEY: Record<CoreStatus, string> = {
  verified: "security.integrity.coreVerified",
  local: "security.integrity.coreLocal",
  absent: "security.integrity.coreAbsent",
  failed: "security.integrity.coreFailed",
};

function badgeClass(status: PackageStatus): string {
  if (status === "verified") return "jf-badge jf-badge--ok";
  if (status === "unverifiable") return "jf-badge jf-badge--info";
  return "jf-badge jf-badge--warn";
}

export default function IntegrityPage() {
  const { t } = useT();
  const prefetched = initialJson<IntegrityReport>("/api/security/integrity");
  const [report, setReport] = useState<IntegrityReport | null>(prefetched ?? null);
  const [loading, setLoading] = useState(!prefetched);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/security/integrity");
      const data = (await res.json().catch(() => ({}))) as IntegrityReport & { error?: string };
      if (!res.ok) throw new Error(data.error ?? t("security.integrity.loadError"));
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("security.integrity.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (prefetched) return;
    void load();
  }, [load, prefetched]);

  async function rescan() {
    setScanning(true);
    setError("");
    try {
      const res = await fetch("/api/security/integrity/scan", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as IntegrityReport & { error?: string };
      if (!res.ok) throw new Error(data.error ?? t("security.integrity.loadError"));
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("security.integrity.loadError"));
    } finally {
      setScanning(false);
    }
  }

  if (loading && !report) return <PageSkeleton />;

  const core = report?.core ?? "absent";
  const coreWarn = core === "failed" || core === "absent" || core === "local";

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("security.integrity.title")}</h1>
          <p>{t("security.integrity.subtitle")}</p>
        </div>
        {report?.installationRoot && (
          <button type="button" className="jf-btn" onClick={() => void rescan()} disabled={scanning}>
            {scanning ? t("security.integrity.scanning") : t("security.integrity.rescan")}
          </button>
        )}
      </header>

      {error && (
        <div className="jf-banner jf-banner--error" role="alert">
          <span className="jf-banner__icon" aria-hidden="true">⚠</span>
          <div>
            <div className="jf-banner__title">{t("security.integrity.loadError")}</div>
            <div className="jf-banner__sub">{error}</div>
          </div>
        </div>
      )}

      {report && !report.installationRoot && <p>{t("security.integrity.otherSite")}</p>}

      {report?.installationRoot && (
        <div className={coreWarn ? "jf-banner jf-banner--warn" : "jf-banner jf-banner--ok"}>
          <span className="jf-banner__icon" aria-hidden="true">{core === "verified" ? "✓" : "!"}</span>
          <div>
            <div className="jf-banner__title">{t(CORE_KEY[core])}</div>
          </div>
        </div>
      )}

      {report?.installationRoot && report.packages.length === 0 && <p>{t("security.integrity.empty")}</p>}

      {report?.installationRoot && report.packages.map((item, index) => {
        const paths = [...item.modified, ...item.missing, ...item.unexpected];
        return (
          <section className="jf-card" key={`${item.packageType}:${item.packageId}:${item.version}:${index}`}>
            <div className="jf-card__head">
              <div>
                <h2 className="jf-card__title">{item.packageId}</h2>
                <p className="jf-field__hint">{item.packageType}{item.version ? ` ${item.version}` : ""}</p>
              </div>
              <span className={badgeClass(item.status)}>{t(STATUS_KEY[item.status])}</span>
            </div>
            {paths.length > 0 && (
              <div className="jf-card__body">
                <ul>
                  {paths.map((file) => <li key={file}>{file}</li>)}
                </ul>
                <p className="jf-field__hint">{t("security.integrity.repair")}</p>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
