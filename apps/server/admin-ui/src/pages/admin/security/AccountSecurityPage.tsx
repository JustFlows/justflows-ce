import { useCallback, useEffect, useState } from "react";
import { Section } from "./components";
import { useT } from "../../../i18n/I18nProvider";

type TotpStatus = {
  enabled: boolean;
  pending: boolean;
  recoveryCodesRemaining: number;
};

type Notice = { kind: "ok" | "error"; text: string } | null;

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; data: any }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

/**
 * Per-user account security: password change, and two-factor enrolment.
 *
 * Both are new. There was no way to change a password anywhere in the product,
 * and no second factor at all — on a role that SECURITY.md describes as
 * equivalent to shell access.
 */
export default function AccountSecurityPage() {
  const { t } = useT();
  const [status, setStatus] = useState<TotpStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/2fa");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus((await res.json()) as TotpStatus);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("security.account.title")}</h1>
          <p>{t("security.account.subtitle")}</p>
        </div>
      </header>

      <PasswordSection />

      <SessionsSection />

      {loadError ? (
        <Section title={t("security.account.twoFactor.title")}>
          <p className="jf-status jf-status--error">
            {t("security.account.twoFactor.loadError", { message: loadError })}
          </p>
        </Section>
      ) : (
        <TwoFactorSection status={status} onChange={refresh} />
      )}
    </div>
  );
}

type DeviceSession = {
  id: string;
  user_agent: string | null;
  ip: string | null;
  last_seen_at: string;
  created_at: string;
  current: boolean;
};

function SessionsSection() {
  const { t } = useT();
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const refresh = useCallback(async () => {
    const res = await fetch("/api/auth/sessions");
    const data = await res.json() as { sessions?: DeviceSession[]; error?: string };
    if (!res.ok) { setNotice({ kind: "error", text: data.error ?? t("security.account.sessions.loadError") }); return; }
    setSessions(data.sessions ?? []);
  }, [t]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function revoke(id: string) {
    const res = await fetch(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
    const data = await res.json() as { error?: string };
    if (!res.ok) { setNotice({ kind: "error", text: data.error ?? t("security.account.sessions.revokeError") }); return; }
    setNotice({ kind: "ok", text: t("security.account.sessions.revoked") });
    await refresh();
  }

  async function revokeOthers() {
    const { ok, data } = await postJson("/api/auth/sessions/revoke-others", {});
    if (!ok) { setNotice({ kind: "error", text: data.error ?? t("security.account.sessions.revokeOthersError") }); return; }
    setNotice({ kind: "ok", text: t("security.account.sessions.othersRevoked", { count: data.revoked }) });
    await refresh();
  }

  return (
    <Section title={t("security.account.sessions.title")}>
      <p className="jf-field__hint">{t("security.account.sessions.hint")}</p>
      {notice ? <p className={`jf-status jf-status--${notice.kind === "ok" ? "saved" : "error"}`}>{notice.text}</p> : null}
      <div className="jf-stack">
        {sessions.map((session) => (
          <div className="jf-row" key={session.id}>
            <div style={{ flex: 1 }}>
              <strong>
                {session.current
                  ? t("security.account.sessions.thisDevice")
                  : session.user_agent || t("security.account.sessions.unknownDevice")}
              </strong>
              <div className="jf-field__hint">
                {session.ip || t("security.account.sessions.unknownIp")}
                {" · "}
                {t("security.account.sessions.lastActive", {
                  date: new Date(session.last_seen_at).toLocaleString(),
                })}
              </div>
            </div>
            {!session.current ? (
              <button className="jf-btn jf-btn--ghost" type="button" onClick={() => void revoke(session.id)}>
                {t("security.account.sessions.revoke")}
              </button>
            ) : null}
          </div>
        ))}
        {sessions.length > 1 ? (
          <button className="jf-btn jf-btn--ghost" type="button" onClick={() => void revokeOthers()}>
            {t("security.account.sessions.revokeAllOthers")}
          </button>
        ) : null}
      </div>
    </Section>
  );
}

function PasswordSection() {
  const { t } = useT();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setNotice(null);

    if (next !== confirm) {
      setNotice({ kind: "error", text: t("security.account.password.mismatch") });
      return;
    }

    setBusy(true);
    const { ok, data } = await postJson("/api/auth/password", {
      currentPassword: current,
      newPassword: next,
    });
    setBusy(false);

    if (!ok) {
      setNotice({ kind: "error", text: data.error ?? t("security.account.password.changeError") });
      return;
    }
    setCurrent("");
    setNext("");
    setConfirm("");
    setNotice({
      kind: "ok",
      text: t("security.account.password.changed"),
    });
  };

  return (
    <Section title={t("security.account.password.title")}>
      <form className="jf-stack" onSubmit={submit}>
        <label className="jf-field">
          <span className="jf-field__label">{t("security.account.password.current")}</span>
          <input
            className="jf-input"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </label>
        <label className="jf-field">
          <span className="jf-field__label">{t("security.account.password.new")}</span>
          <input
            className="jf-input"
            type="password"
            autoComplete="new-password"
            minLength={12}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
          />
          <small className="jf-field__hint">{t("security.account.password.newHint")}</small>
        </label>
        <label className="jf-field">
          <span className="jf-field__label">{t("security.account.password.confirm")}</span>
          <input
            className="jf-input"
            type="password"
            autoComplete="new-password"
            minLength={12}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </label>
        {notice ? (
          <p className={`jf-status jf-status--${notice.kind === "ok" ? "saved" : "error"}`}>
            {notice.text}
          </p>
        ) : null}
        <div className="jf-row">
          <button className="jf-btn jf-btn--primary" type="submit" disabled={busy}>
            {busy ? t("security.account.password.changing") : t("security.account.password.submit")}
          </button>
        </div>
      </form>
    </Section>
  );
}

function TwoFactorSection({
  status,
  onChange,
}: {
  status: TotpStatus | null;
  onChange: () => Promise<void>;
}) {
  const { t } = useT();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  if (!status) {
    return (
      <Section title={t("security.account.twoFactor.title")}>
        <p className="jf-skeleton" />
      </Section>
    );
  }

  const begin = async () => {
    setBusy(true);
    setNotice(null);
    const { ok, data } = await postJson("/api/auth/2fa/setup", {});
    setBusy(false);
    if (!ok) {
      setNotice({ kind: "error", text: data.error ?? t("security.account.twoFactor.setupError") });
      return;
    }
    setSetup({ secret: data.secret, uri: data.uri });
  };

  const enable = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    const { ok, data } = await postJson("/api/auth/2fa/enable", { code });
    setBusy(false);
    if (!ok) {
      setNotice({ kind: "error", text: data.error ?? t("security.account.twoFactor.enableError") });
      return;
    }
    setSetup(null);
    setCode("");
    setRecoveryCodes(data.recoveryCodes as string[]);
    await onChange();
  };

  const disable = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    const { ok, data } = await postJson("/api/auth/2fa/disable", { password, code });
    setBusy(false);
    if (!ok) {
      setNotice({ kind: "error", text: data.error ?? t("security.account.twoFactor.disableError") });
      return;
    }
    setPassword("");
    setCode("");
    setNotice({ kind: "ok", text: t("security.account.twoFactor.disabled") });
    await onChange();
  };

  // Shown once, immediately after enrolling. There is deliberately no way to
  // read them again — a list the account can re-display is a second copy of the
  // secret, not a break-glass measure.
  if (recoveryCodes) {
    return (
      <Section title={t("security.account.twoFactor.recovery.title")}>
        <p>{t("security.account.twoFactor.recovery.body")}</p>
        <div className="jf-banner jf-banner--warn">
          <span className="jf-banner__icon" aria-hidden="true">⚠</span>
          <div>
            <div className="jf-banner__title">{t("security.account.twoFactor.recovery.onlyShownTitle")}</div>
            <div className="jf-banner__sub">{t("security.account.twoFactor.recovery.onlyShownSub")}</div>
          </div>
        </div>
        <pre className="jf-secret jf-secret--list">{recoveryCodes.join("\n")}</pre>
        <div className="jf-row">
          <button className="jf-btn jf-btn--primary" type="button" onClick={() => setRecoveryCodes(null)}>
            {t("security.account.twoFactor.recovery.saved")}
          </button>
        </div>
      </Section>
    );
  }

  if (status.enabled) {
    return (
      <Section title={t("security.account.twoFactor.title")}>
        <p className="jf-status jf-status--saved">
          {t("security.account.twoFactor.enabledStatus")}
        </p>
        <p>
          {t("security.account.twoFactor.recoveryCodesLeft", { count: status.recoveryCodesRemaining })}
        </p>
        <form className="jf-stack" onSubmit={disable}>
          <p>
            {t("security.account.twoFactor.disableExplain")}
          </p>
          <label className="jf-field">
            <span className="jf-field__label">{t("security.account.twoFactor.password")}</span>
            <input
              className="jf-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <label className="jf-field">
            <span className="jf-field__label">{t("security.account.twoFactor.codeLabel")}</span>
            <input
              className="jf-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </label>
          {notice ? (
            <p className={`jf-status jf-status--${notice.kind === "ok" ? "saved" : "error"}`}>
              {notice.text}
            </p>
          ) : null}
          <div className="jf-row">
            <button className="jf-btn" type="submit" disabled={busy}>
              {busy ? t("security.account.twoFactor.turningOff") : t("security.account.twoFactor.turnOff")}
            </button>
          </div>
        </form>
      </Section>
    );
  }

  if (setup) {
    return (
      <Section title={t("security.account.twoFactor.setup.title")}>
        <p>
          {t("security.account.twoFactor.setup.body")}
        </p>
        <label className="jf-field">
          <span className="jf-field__label">{t("security.account.twoFactor.setup.keyLabel")}</span>
          <pre className="jf-secret">{setup.secret}</pre>
        </label>
        <p>
          <a href={setup.uri}>{t("security.account.twoFactor.setup.openApp")}</a>
        </p>
        <form className="jf-stack" onSubmit={enable}>
          <label className="jf-field">
            <span className="jf-field__label">{t("security.account.twoFactor.setup.codeLabel")}</span>
            <input
              className="jf-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
            <small className="jf-field__hint">{t("security.account.twoFactor.setup.codeHint")}</small>
          </label>
          {notice ? (
            <p className={`jf-status jf-status--${notice.kind === "ok" ? "saved" : "error"}`}>
              {notice.text}
            </p>
          ) : null}
          <div className="jf-row">
            <button className="jf-btn jf-btn--primary" type="submit" disabled={busy}>
              {busy ? t("security.account.twoFactor.checking") : t("security.account.twoFactor.turnOn")}
            </button>
            <button className="jf-btn" type="button" onClick={() => setSetup(null)}>
              {t("common.cancel")}
            </button>
          </div>
        </form>
      </Section>
    );
  }

  return (
    <Section title={t("security.account.twoFactor.title")}>
      <p>
        {t("security.account.twoFactor.off.body")}
      </p>
      {notice ? (
        <p className={`jf-status jf-status--${notice.kind === "ok" ? "saved" : "error"}`}>
          {notice.text}
        </p>
      ) : null}
      <div className="jf-row">
        <button className="jf-btn jf-btn--primary" type="button" onClick={begin} disabled={busy}>
          {busy ? t("security.account.twoFactor.starting") : t("security.account.twoFactor.setUp")}
        </button>
      </div>
    </Section>
  );
}
