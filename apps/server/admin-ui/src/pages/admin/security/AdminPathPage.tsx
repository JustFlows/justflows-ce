import { useEffect, useState } from "react";
import { publicAdminPath } from "../../../admin-path";
import { LoadError, PageSkeleton, SaveBar, Section } from "./components";
import { useT } from "../../../i18n/I18nProvider";

type Config = { path: string; oldPathBehavior: "not_found" | "redirect" };

export default function AdminPathPage() {
  const { t } = useT();
  const [saved, setSaved] = useState<Config | null>(null);
  const [draft, setDraft] = useState<Config>({ path: "/admin", oldPathBehavior: "not_found" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [justSaved, setJustSaved] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("saved") === "1",
  );

  useEffect(() => {
    void fetch("/api/security/admin-path")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || t("security.adminPath.errors.loadFailed"));
        setSaved(body.config);
        setDraft(body.config);
        setRecovery(Boolean(body.recoveryOverride));
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function save() {
    if (!saved || recovery) return;
    setSaving(true);
    setError(null);
    setJustSaved(false);
    try {
      const preview = await fetch("/api/security/admin-path/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: draft.path }),
      });
      const previewBody = await preview.json();
      if (!preview.ok) throw new Error(previewBody.error || t("security.adminPath.errors.invalidPath"));
      if (
        !window.confirm(
          t("security.adminPath.confirmMove", { path: previewBody.path }),
        )
      )
        return;

      const response = await fetch("/api/security/admin-path", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || t("security.adminPath.errors.saveFailed"));
      const check = await fetch(`${body.config.path}/security/admin-path`, {
        method: "GET",
        cache: "no-store",
      });
      if (!check.ok) {
        await fetch("/api/security/admin-path", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(saved),
        });
        throw new Error(
          t("security.adminPath.errors.routeUnreachable"),
        );
      }
      window.location.assign(`${body.config.path}/security/admin-path?saved=1`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!saved && !error) return <PageSkeleton />;
  if (!saved) return <LoadError error={error ?? t("security.shared.unknownError")} />;
  const dirty = saved.path !== draft.path || saved.oldPathBehavior !== draft.oldPathBehavior;

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("security.adminPath.title")}</h1>
          <p>
            {t("security.adminPath.subtitle")}
          </p>
        </div>
      </header>

      {recovery && (
        <div className="jf-banner jf-banner--warn">
          <span className="jf-banner__icon" aria-hidden="true">
            ⚠
          </span>
          <div>
            <div className="jf-banner__title">{t("security.adminPath.recoveryBanner.title")}</div>
            <div className="jf-banner__sub">
              {t("security.adminPath.recoveryBanner.subPrefix")} <code>JF_ADMIN_PATH_RECOVERY</code>{" "}
              {t("security.adminPath.recoveryBanner.subSuffix")}
            </div>
          </div>
        </div>
      )}

      <Section title={t("security.adminPath.address.title")}>
        <div className="jf-field">
          <label className="jf-field__label" htmlFor="admin-path">
            {t("security.adminPath.address.pathLabel")}
          </label>
          <input
            id="admin-path"
            className="jf-input jf-input--mono"
            style={{ maxWidth: "32rem" }}
            value={draft.path}
            placeholder="/control-room"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setDraft({ ...draft, path: e.target.value })}
            aria-describedby="admin-path-help"
          />
          <p id="admin-path-help" className="jf-field__hint">
            {t("security.adminPath.address.pathHelpPrefix")} <code>/</code>{" "}
            {t("security.adminPath.address.pathHelpSuffix")}
          </p>
        </div>
        <p className="jf-field__hint">
          {t("security.adminPath.address.current")} <code>{publicAdminPath("/admin")}</code>
        </p>
      </Section>

      <Section title={t("security.adminPath.oldAddress.title")}>
        <p className="jf-field__hint">
          {t("security.adminPath.oldAddress.hintPrefix")} <code>/admin</code>{" "}
          {t("security.adminPath.oldAddress.hintSuffix")}
        </p>
        <fieldset className="jf-choice">
          <legend className="jf-field__label">{t("security.adminPath.oldAddress.legend")}</legend>
          <label className="jf-checkrow">
            <input
              name="old-admin-path"
              type="radio"
              checked={draft.oldPathBehavior === "not_found"}
              onChange={() => setDraft({ ...draft, oldPathBehavior: "not_found" })}
            />
            <span>
              {t("security.adminPath.oldAddress.notFound")} <span className="jf-chip">{t("security.shared.recommended")}</span>
              <span className="jf-checkrow__meta">
                {t("security.adminPath.oldAddress.notFoundMeta")}
              </span>
            </span>
          </label>
          <label className="jf-checkrow">
            <input
              name="old-admin-path"
              type="radio"
              checked={draft.oldPathBehavior === "redirect"}
              onChange={() => setDraft({ ...draft, oldPathBehavior: "redirect" })}
            />
            <span>
              {t("security.adminPath.oldAddress.redirect")}
              <span className="jf-checkrow__meta">
                {t("security.adminPath.oldAddress.redirectMeta")}
              </span>
            </span>
          </label>
        </fieldset>
      </Section>

      <Section title={t("security.adminPath.recoverySection.title")}>
        <p>
          {t("security.adminPath.recoverySection.bodyPrefix")}{" "}
          <code>JF_ADMIN_PATH_RECOVERY=/admin</code> {t("security.adminPath.recoverySection.bodySuffix")}
        </p>
        <div className="jf-banner jf-banner--warn">
          <span className="jf-banner__icon" aria-hidden="true">
            !
          </span>
          <div>
            <div className="jf-banner__title">{t("security.adminPath.recoverySection.warnTitle")}</div>
            <div className="jf-banner__sub">
              {t("security.adminPath.recoverySection.warnSub")}
            </div>
          </div>
        </div>
      </Section>

      <SaveBar
        dirty={dirty && !recovery}
        saving={saving}
        saved={justSaved}
        error={error}
        onSave={() => void save()}
        onDiscard={() => {
          setDraft(saved);
          setError(null);
        }}
      >
        {recovery && (
          <span className="jf-status jf-status--dirty">{t("security.adminPath.savingDisabled")}</span>
        )}
      </SaveBar>
    </div>
  );
}
