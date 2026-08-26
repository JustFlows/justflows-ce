import { useCallback, useEffect, useState } from "react";
import { Section } from "./components";

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
          <h1>Your account</h1>
          <p>The password and second factor protecting your own sign-in.</p>
        </div>
      </header>

      <PasswordSection />

      {loadError ? (
        <Section title="Two-factor authentication">
          <p className="jf-status jf-status--error">Could not load status: {loadError}</p>
        </Section>
      ) : (
        <TwoFactorSection status={status} onChange={refresh} />
      )}
    </div>
  );
}

function PasswordSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setNotice(null);

    if (next !== confirm) {
      setNotice({ kind: "error", text: "The two new passwords do not match." });
      return;
    }

    setBusy(true);
    const { ok, data } = await postJson("/api/auth/password", {
      currentPassword: current,
      newPassword: next,
    });
    setBusy(false);

    if (!ok) {
      setNotice({ kind: "error", text: data.error ?? "Could not change the password." });
      return;
    }
    setCurrent("");
    setNext("");
    setConfirm("");
    setNotice({
      kind: "ok",
      text: "Password changed. Every other session has been signed out.",
    });
  };

  return (
    <Section title="Password">
      <form className="jf-stack" onSubmit={submit}>
        <label className="jf-field">
          <span className="jf-field__label">Current password</span>
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
          <span className="jf-field__label">New password</span>
          <input
            className="jf-input"
            type="password"
            autoComplete="new-password"
            minLength={12}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
          />
          <small className="jf-field__hint">At least 12 characters. Length matters more than symbols.</small>
        </label>
        <label className="jf-field">
          <span className="jf-field__label">Confirm new password</span>
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
            {busy ? "Changing…" : "Change password"}
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
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  if (!status) {
    return (
      <Section title="Two-factor authentication">
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
      setNotice({ kind: "error", text: data.error ?? "Could not start setup." });
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
      setNotice({ kind: "error", text: data.error ?? "Could not turn on two-factor." });
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
      setNotice({ kind: "error", text: data.error ?? "Could not turn off two-factor." });
      return;
    }
    setPassword("");
    setCode("");
    setNotice({ kind: "ok", text: "Two-factor authentication is off." });
    await onChange();
  };

  // Shown once, immediately after enrolling. There is deliberately no way to
  // read them again — a list the account can re-display is a second copy of the
  // secret, not a break-glass measure.
  if (recoveryCodes) {
    return (
      <Section title="Save your recovery codes">
        <p>
          Each code works once, and only these ten exist. Store them somewhere you can reach
          without your phone — they are the way back in if you lose the authenticator.
        </p>
        <div className="jf-banner jf-banner--warn">
          <span className="jf-banner__icon" aria-hidden="true">⚠</span>
          <div>
            <div className="jf-banner__title">This is the only time they are shown</div>
            <div className="jf-banner__sub">Copy them somewhere safe before you continue.</div>
          </div>
        </div>
        <pre className="jf-secret jf-secret--list">{recoveryCodes.join("\n")}</pre>
        <div className="jf-row">
          <button className="jf-btn jf-btn--primary" type="button" onClick={() => setRecoveryCodes(null)}>
            I have saved them
          </button>
        </div>
      </Section>
    );
  }

  if (status.enabled) {
    return (
      <Section title="Two-factor authentication">
        <p className="jf-status jf-status--saved">
          On. Sign-in asks for a code from your authenticator app.
        </p>
        <p>
          {status.recoveryCodesRemaining} unused recovery{" "}
          {status.recoveryCodesRemaining === 1 ? "code" : "codes"} left.
        </p>
        <form className="jf-stack" onSubmit={disable}>
          <p>
            Turning this off asks for your password and a current code, so a borrowed session
            cannot remove the thing that protects it.
          </p>
          <label className="jf-field">
            <span className="jf-field__label">Password</span>
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
            <span className="jf-field__label">Authentication or recovery code</span>
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
              {busy ? "Turning off…" : "Turn off two-factor"}
            </button>
          </div>
        </form>
      </Section>
    );
  }

  if (setup) {
    return (
      <Section title="Set up two-factor authentication">
        <p>
          Add this key to an authenticator app, then enter the code it shows. On a phone, the
          link below opens the app directly.
        </p>
        <label className="jf-field">
          <span className="jf-field__label">Setup key</span>
          <pre className="jf-secret">{setup.secret}</pre>
        </label>
        <p>
          <a href={setup.uri}>Open in your authenticator app</a>
        </p>
        <form className="jf-stack" onSubmit={enable}>
          <label className="jf-field">
            <span className="jf-field__label">Code from the app</span>
            <input
              className="jf-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
            <small className="jf-field__hint">Six digits. Nothing changes until this code checks out.</small>
          </label>
          {notice ? (
            <p className={`jf-status jf-status--${notice.kind === "ok" ? "saved" : "error"}`}>
              {notice.text}
            </p>
          ) : null}
          <div className="jf-row">
            <button className="jf-btn jf-btn--primary" type="submit" disabled={busy}>
              {busy ? "Checking…" : "Turn on two-factor"}
            </button>
            <button className="jf-btn" type="button" onClick={() => setSetup(null)}>
              Cancel
            </button>
          </div>
        </form>
      </Section>
    );
  }

  return (
    <Section title="Two-factor authentication">
      <p>
        Off. A password is currently the only thing between an attacker and this account —
        and an administrator here can install extensions and update the core, which is server
        access.
      </p>
      {notice ? (
        <p className={`jf-status jf-status--${notice.kind === "ok" ? "saved" : "error"}`}>
          {notice.text}
        </p>
      ) : null}
      <div className="jf-row">
        <button className="jf-btn jf-btn--primary" type="button" onClick={begin} disabled={busy}>
          {busy ? "Starting…" : "Set up two-factor"}
        </button>
      </div>
    </Section>
  );
}
