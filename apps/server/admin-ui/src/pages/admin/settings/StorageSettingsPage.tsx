// SPDX-License-Identifier: MIT

import { useEffect, useState, type FormEvent } from "react";
import { useSession } from "../../../components/SessionProvider";
import { useT } from "../../../i18n/I18nProvider";

type Source = "site" | "platform" | "environment" | "local";

interface StorageConnection {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  forcePathStyle: boolean;
  accessKeyId: { last4: string };
  secretAccessKey: { last4: string };
  updatedAt: string;
}

interface Usage {
  used: number | null;
  limit: number | null;
}

interface StorageState {
  root: boolean;
  ownStorageAllowed: boolean;
  source: Source;
  publicEnvironmentBucket: boolean;
  connection: StorageConnection | null;
  copying: number;
  files: Usage;
  bytes: Usage;
}

interface Draft {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

const EMPTY: Draft = { endpoint: "", region: "", bucket: "", prefix: "", forcePathStyle: true, accessKeyId: "", secretAccessKey: "" };

async function storageJson<T>(path: string, init: RequestInit | undefined, fallback: string): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? fallback);
  return body as T;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unit]}`;
}

/**
 * Admin → Settings → Storage: where this site keeps private files, such as
 * products sold as downloads. The root site's connection is every site's
 * default; another site can save its own when its plan allows it.
 */
export default function StorageSettingsPage() {
  const { t } = useT();
  const { loading: sessionLoading } = useSession();
  const [state, setState] = useState<StorageState | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "test" | "remove">("");

  function accept(next: StorageState) {
    setState(next);
    const saved = next.connection;
    setDraft(saved
      ? { ...EMPTY, endpoint: saved.endpoint, region: saved.region, bucket: saved.bucket, prefix: saved.prefix, forcePathStyle: saved.forcePathStyle }
      : EMPTY);
  }

  useEffect(() => {
    if (sessionLoading) return;
    storageJson<StorageState>("/api/storage", undefined, t("storage.failed")).then(accept).catch((err: Error) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionLoading]);

  async function run(kind: typeof busy, action: () => Promise<string>) {
    setBusy(kind);
    setError("");
    setNotice("");
    try {
      setNotice(await action());
    } catch (err) {
      setError(err instanceof Error ? err.message : t("storage.failed"));
    } finally {
      setBusy("");
    }
  }

  function payload() {
    return JSON.stringify({
      endpoint: draft.endpoint.trim(),
      region: draft.region.trim(),
      bucket: draft.bucket.trim(),
      prefix: draft.prefix.trim(),
      forcePathStyle: draft.forcePathStyle,
      ...(draft.accessKeyId.trim() ? { accessKeyId: draft.accessKeyId.trim() } : {}),
      ...(draft.secretAccessKey.trim() ? { secretAccessKey: draft.secretAccessKey.trim() } : {}),
    });
  }

  function save(event: FormEvent) {
    event.preventDefault();
    void run("save", async () => {
      accept(await storageJson<StorageState>("/api/storage", { method: "PUT", body: payload() }, t("storage.failed")));
      return t("storage.saved");
    });
  }

  function test() {
    void run("test", async () => {
      await storageJson("/api/storage/test", { method: "POST", body: payload() }, t("storage.failed"));
      return t("storage.testOk");
    });
  }

  function remove() {
    if (!window.confirm(state?.root ? t("storage.removeConfirmRoot") : t("storage.removeConfirm"))) return;
    void run("remove", async () => {
      accept(await storageJson<StorageState>("/api/storage", { method: "DELETE" }, t("storage.failed")));
      return t("storage.removed");
    });
  }

  function usage(label: string, item: Usage, bytes: boolean) {
    const show = (value: number) => (bytes ? formatBytes(value) : String(value));
    const used = item.used === null ? "—" : show(item.used);
    return (
      <div className="jf-field">
        <span className="jf-field__label">{label}</span>
        <span>{item.limit === null ? t("storage.usageUnlimited", { used }) : t("storage.usageOf", { used, limit: show(item.limit) })}</span>
      </div>
    );
  }

  const field = (id: keyof Draft, label: string, hint: string, options: { secret?: boolean; required?: boolean } = {}) => {
    const savedSecret = options.secret && state?.connection ? state.connection[id as "accessKeyId" | "secretAccessKey"] : undefined;
    return (
      <div className="jf-field">
        <label className="jf-field__label" htmlFor={`jf-storage-${id}`}>
          {label}
        </label>
        <input
          id={`jf-storage-${id}`}
          className="jf-input"
          type={options.secret ? "password" : "text"}
          autoComplete="off"
          required={Boolean(options.required) && !savedSecret}
          value={String(draft[id])}
          placeholder={savedSecret ? t("storage.secretSaved", { last4: savedSecret.last4 }) : undefined}
          onChange={(e) => setDraft({ ...draft, [id]: e.target.value })}
        />
        {hint && <p className="jf-field__hint">{hint}</p>}
      </div>
    );
  };

  const canEdit = Boolean(state && (state.root || state.ownStorageAllowed));

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("storage.title")}</h1>
          <p>{t("storage.description")}</p>
        </div>
      </header>

      {error && (
        <div className="jf-alert jf-alert--error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="jf-alert jf-alert--success" role="status">
          {notice}
        </div>
      )}

      {!state || sessionLoading ? (
        !error && <p>{t("common.loading")}</p>
      ) : (
        <>
          <section className="jf-card">
            <div className="jf-card__head">
              <h2 className="jf-card__title">{t("storage.inUseTitle")}</h2>
            </div>
            <div className="jf-card__body jf-grid">
              <p>{t(`storage.source.${state.source}`)}</p>
              {state.source === "local" && state.publicEnvironmentBucket && (
                <div className="jf-alert jf-alert--info" role="note">
                  {t("storage.publicBucket")}
                </div>
              )}
              {state.copying > 0 && (
                <div className="jf-alert jf-alert--info" role="status">
                  {t("storage.copying", { count: String(state.copying) })}
                </div>
              )}
              {usage(t("storage.filesUsage"), state.files, false)}
              {usage(t("storage.bytesUsage"), state.bytes, true)}
            </div>
          </section>

          {!canEdit ? (
            <section className="jf-card">
              <div className="jf-card__body">
                <p className="jf-field__hint">{t("storage.managedOnPlatform")}</p>
              </div>
            </section>
          ) : (
            <section className="jf-card">
              <div className="jf-card__head">
                <h2 className="jf-card__title">{state.root ? t("storage.connectionTitleRoot") : t("storage.connectionTitle")}</h2>
              </div>
              <form className="jf-card__body jf-grid" onSubmit={save}>
                <p className="jf-field__hint">{state.root ? t("storage.connectionHintRoot") : t("storage.connectionHint")}</p>
                {field("endpoint", t("storage.endpoint"), t("storage.endpointHint"))}
                {field("region", t("storage.region"), t("storage.regionHint"))}
                {field("bucket", t("storage.bucket"), t("storage.bucketHint"), { required: true })}
                {field("prefix", t("storage.prefix"), t("storage.prefixHint"))}
                {field("accessKeyId", t("storage.accessKeyId"), "", { secret: true, required: true })}
                {field("secretAccessKey", t("storage.secretAccessKey"), "", { secret: true, required: true })}
                <label className="jf-checkrow">
                  <input type="checkbox" checked={draft.forcePathStyle} onChange={(e) => setDraft({ ...draft, forcePathStyle: e.target.checked })} />
                  <span>{t("storage.pathStyle")}</span>
                </label>
                <p className="jf-field__hint">{t("storage.saveHint")}</p>
                <div className="jf-row">
                  <button className="jf-btn jf-btn--primary" type="submit" disabled={busy !== ""}>
                    {busy === "save" ? t("common.saving") : t("storage.save")}
                  </button>
                  <button className="jf-btn" type="button" onClick={test} disabled={busy !== "" || !draft.bucket.trim()}>
                    {busy === "test" ? t("storage.testing") : t("storage.test")}
                  </button>
                  {state.connection && (
                    <button className="jf-btn jf-btn--danger" type="button" onClick={remove} disabled={busy !== ""}>
                      {t("storage.remove")}
                    </button>
                  )}
                </div>
              </form>
            </section>
          )}
        </>
      )}
    </div>
  );
}
