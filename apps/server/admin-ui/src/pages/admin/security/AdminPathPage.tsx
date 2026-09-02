import { useEffect, useState } from "react";
import { publicAdminPath } from "../../../admin-path";
import { LoadError, PageSkeleton, SaveBar, Section } from "./components";

type Config = { path: string; oldPathBehavior: "not_found" | "redirect" };

export default function AdminPathPage() {
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
        if (!response.ok) throw new Error(body.error || "Could not load the admin path.");
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
      if (!preview.ok) throw new Error(previewBody.error || "That path cannot be used.");
      if (
        !window.confirm(
          `Move the administration area to ${previewBody.path}? Keep this tab open while Justflows verifies the new route.`,
        )
      )
        return;

      const response = await fetch("/api/security/admin-path", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save the admin path.");
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
          "The new route could not be reached, so Justflows restored the previous path.",
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
  if (!saved) return <LoadError error={error ?? "Unknown error"} />;
  const dirty = saved.path !== draft.path || saved.oldPathBehavior !== draft.oldPathBehavior;

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>Admin URL</h1>
          <p>
            Move the administration entry point to a private, memorable path. Authentication and
            rate limiting remain essential.
          </p>
        </div>
      </header>

      {recovery && (
        <div className="jf-banner jf-banner--warn">
          <span className="jf-banner__icon" aria-hidden="true">
            ⚠
          </span>
          <div>
            <div className="jf-banner__title">Recovery override is active</div>
            <div className="jf-banner__sub">
              Remove <code>JF_ADMIN_PATH_RECOVERY</code> from the server environment and restart
              before saving changes here.
            </div>
          </div>
        </div>
      )}

      <Section title="Admin address">
        <div className="jf-field">
          <label className="jf-field__label" htmlFor="admin-path">
            Path
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
            Start with <code>/</code> and use letters, numbers, hyphens, underscores, or nested
            paths. Do not add a trailing slash.
          </p>
        </div>
        <p className="jf-field__hint">
          Current address: <code>{publicAdminPath("/admin")}</code>
        </p>
      </Section>

      <Section title="Old admin address">
        <p className="jf-field__hint">
          Choose what visitors receive when they request <code>/admin</code> after the move.
        </p>
        <fieldset className="jf-choice">
          <legend className="jf-field__label">Requests to /admin</legend>
          <label className="jf-checkrow">
            <input
              name="old-admin-path"
              type="radio"
              checked={draft.oldPathBehavior === "not_found"}
              onChange={() => setDraft({ ...draft, oldPathBehavior: "not_found" })}
            />
            <span>
              Return 404 <span className="jf-chip">Recommended</span>
              <span className="jf-checkrow__meta">
                Do not reveal that the administration area moved elsewhere.
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
              Redirect to the new address
              <span className="jf-checkrow__meta">
                More convenient, but exposes the configured path to anyone visiting /admin.
              </span>
            </span>
          </label>
        </fieldset>
      </Section>

      <Section title="Recovery">
        <p>
          If a reverse proxy or cache blocks the new address, set{" "}
          <code>JF_ADMIN_PATH_RECOVERY=/admin</code> in the server environment and restart. The
          override restores access without changing the saved setting.
        </p>
        <div className="jf-banner jf-banner--warn">
          <span className="jf-banner__icon" aria-hidden="true">
            !
          </span>
          <div>
            <div className="jf-banner__title">Keep this page open while saving</div>
            <div className="jf-banner__sub">
              Justflows checks the new route before sending you there. If it cannot be reached, the
              previous address is restored automatically.
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
          <span className="jf-status jf-status--dirty">Saving is disabled by recovery mode</span>
        )}
      </SaveBar>
    </div>
  );
}
