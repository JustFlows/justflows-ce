/**
 * Justflows install wizard.
 */
import { cloneElement, isValidElement, useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { JustflowsLogo } from "@components/JustflowsLogo";

type Step = "welcome" | "database" | "site" | "account" | "installing" | "done";

interface DbForm {
  driver: "postgres" | "mysql" | "mariadb";
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
}

interface SiteForm {
  name: string;
  description: string;
}

interface AccountForm {
  email: string;
  username: string;
  displayName: string;
  password: string;
  confirmPassword: string;
}

interface InstallLog {
  message: string;
  status: "running" | "ok" | "error";
}

const DEFAULT_PORTS: Record<DbForm["driver"], string> = {
  postgres: "5432",
  mysql: "3306",
  mariadb: "3306",
};

export default function InstallPage() {
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("welcome");
  const [log, setLog] = useState<InstallLog[]>([]);
  const [fatalError, setFatalError] = useState("");

  const [db, setDb] = useState<DbForm>({
    driver: "mysql",
    host: "localhost",
    port: "3306",
    database: "justflows",
    username: "",
    password: "",
  });

  const [site, setSite] = useState<SiteForm>({ name: "", description: "" });
  const [account, setAccount] = useState<AccountForm>({
    email: "",
    username: "admin",
    displayName: "",
    password: "",
    confirmPassword: "",
  });

  // ── derived ──────────────────────────────────────────────────────────────
  const siteUrl =
    typeof window !== "undefined"
      ? `${window.location.protocol}//${window.location.hostname}${window.location.port ? `:${window.location.port}` : ""}`
      : "";

  const passwordsMatch =
    account.password.length === 0 ||
    account.confirmPassword.length === 0 ||
    account.password === account.confirmPassword;

  const canInstall =
    account.email.includes("@") &&
    account.username.length >= 2 &&
    account.displayName.length > 0 &&
    account.password.length >= 8 &&
    account.password === account.confirmPassword;

  // ── install ───────────────────────────────────────────────────────────────
  async function runInstall() {
    setStep("installing");
    setLog([]);
    setFatalError("");

    function addLog(message: string, status: InstallLog["status"] = "running") {
      setLog((prev) => [...prev, { message, status }]);
    }

    function markLast(status: InstallLog["status"]) {
      setLog((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last) next[next.length - 1] = { ...last, status };
        return next;
      });
    }

    try {
      addLog("Connecting to database…");
      const res = await fetch("/api/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          db: {
            driver: db.driver,
            host: db.host,
            port: Number(db.port),
            database: db.database,
            username: db.username,
            password: db.password,
          },
          site: {
            name: site.name,
            description: site.description,
            url: siteUrl,
          },
          account: {
            email: account.email,
            username: account.username,
            displayName: account.displayName,
            password: account.password,
          },
        }),
      });

      // Stream log events from the response body
      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        for (const line of chunk.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const raw = trimmed.slice(5).trim();
          if (!raw) continue;

          try {
            const event = JSON.parse(raw) as {
              type: "step" | "done" | "error";
              message: string;
            };

            if (event.type === "step") {
              markLast("ok");
              addLog(event.message);
            } else if (event.type === "done") {
              markLast("ok");
              // Ask the server to set the jf_installed cookie via Set-Cookie header
              // This is more reliable than document.cookie across all hosting environments
              await fetch("/api/install/complete").catch(() => null);
              setStep("done");
            } else if (event.type === "error") {
              markLast("error");
              setFatalError(event.message);
              setStep("installing"); // stay on log view, show error
            }
          } catch {
            // ignore malformed lines
          }
        }
      }
    } catch (err) {
      setFatalError(err instanceof Error ? err.message : String(err));
      markLast("error");
    }
  }

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="jf-auth">
      <div className="jf-auth__card jf-auth__card--wide">
        <div className="jf-auth__head">
          <div className="jf-auth__brand">
            <JustflowsLogo />
            Justflows
          </div>
          <h1 className="jf-auth__sub">Installation</h1>
        </div>

        {/* Progress dots */}
        {step !== "installing" && step !== "done" && (
          <ol className="jf-steps" aria-label="Installation steps">
            {(["welcome", "database", "site", "account"] as const).map((s) => (
              <li
                key={s}
                className="jf-steps__dot"
                data-current={s === step}
                aria-current={s === step ? "step" : undefined}
              >
                <span className="jf-sr-only">{s}</span>
              </li>
            ))}
          </ol>
        )}

        <div className="jf-auth__body">
          {/* ── WELCOME ─────────────────────────────────────────────────── */}
          {step === "welcome" && (
            <div className="jf-stack">
              <h2 className="jf-section-title">Welcome</h2>
              <p className="jf-prose">
                You are about to set up Justflows. You will need:
              </p>
              <ul className="jf-prose" style={{ paddingInlineStart: "1.25rem", lineHeight: 2 }}>
                <li>A database (PostgreSQL, MySQL, or MariaDB)</li>
                <li>The database hostname, name, username and password</li>
                <li>An email address for your admin account</li>
              </ul>
              <p className="jf-prose">Everything else is handled automatically.</p>
              <button className="jf-btn jf-btn--primary" onClick={() => setStep("database")}>
                Let's go →
              </button>
            </div>
          )}

          {/* ── DATABASE ────────────────────────────────────────────────── */}
          {step === "database" && (
            <div className="jf-stack">
              <h2 className="jf-section-title">Database</h2>
              <p className="jf-prose">
                Your web host will have given you these details. If you are
                running Docker or using a local setup, the defaults usually work.
              </p>

              <Field label="Database type">
                <select
                  className="jf-input"
                  value={db.driver}
                  onChange={(e) => {
                    const driver = e.target.value as DbForm["driver"];
                    setDb((d) => ({
                      ...d,
                      driver,
                      port: DEFAULT_PORTS[driver],
                    }));
                  }}
                >
                  <option value="postgres">PostgreSQL</option>
                  <option value="mysql">MySQL</option>
                  <option value="mariadb">MariaDB</option>
                </select>
              </Field>

              <div className="jf-grid" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(90px, 120px)" }}>
                <Field label="Database host">
                  <input
                    className="jf-input"
                    value={db.host}
                    placeholder="localhost"
                    onChange={(e) => setDb((d) => ({ ...d, host: e.target.value }))}
                  />
                </Field>
                <Field label="Port">
                  <input
                    className="jf-input"
                    value={db.port}
                    onChange={(e) => setDb((d) => ({ ...d, port: e.target.value }))}
                  />
                </Field>
              </div>

              <Field label="Database name">
                <input
                  className="jf-input"
                  value={db.database}
                  placeholder="justflows"
                  onChange={(e) => setDb((d) => ({ ...d, database: e.target.value }))}
                />
              </Field>

              <div className="jf-grid jf-grid--2">
                <Field label="Database username">
                  <input
                    className="jf-input"
                    value={db.username}
                    placeholder="db_user"
                    autoComplete="off"
                    onChange={(e) => setDb((d) => ({ ...d, username: e.target.value }))}
                  />
                </Field>
                <Field label="Database password">
                  <input
                    className="jf-input"
                    type="password"
                    value={db.password}
                    autoComplete="new-password"
                    onChange={(e) => setDb((d) => ({ ...d, password: e.target.value }))}
                  />
                </Field>
              </div>

              <Row>
                <button className="jf-btn jf-btn--ghost" onClick={() => setStep("welcome")}>← Back</button>
                <button
                  className="jf-btn jf-btn--primary"
                  disabled={!db.host || !db.database || !db.username}
                  onClick={() => setStep("site")}
                >
                  Next →
                </button>
              </Row>
            </div>
          )}

          {/* ── SITE ────────────────────────────────────────────────────── */}
          {step === "site" && (
            <div className="jf-stack">
              <h2 className="jf-section-title">Your site</h2>
              <Field label="Site name">
                <input
                  className="jf-input"
                  value={site.name}
                  placeholder="My Website"
                  onChange={(e) => setSite((s) => ({ ...s, name: e.target.value }))}
                />
              </Field>
              <Field label="Tagline (optional)">
                <input
                  className="jf-input"
                  value={site.description}
                  placeholder="Just another great website"
                  onChange={(e) => setSite((s) => ({ ...s, description: e.target.value }))}
                />
              </Field>
              <p className="jf-field__hint">
                Your site URL is detected automatically: <strong>{siteUrl || "…"}</strong>
              </p>
              <Row>
                <button className="jf-btn jf-btn--ghost" onClick={() => setStep("database")}>← Back</button>
                <button
                  className="jf-btn jf-btn--primary"
                  disabled={!site.name}
                  onClick={() => setStep("account")}
                >
                  Next →
                </button>
              </Row>
            </div>
          )}

          {/* ── ACCOUNT ─────────────────────────────────────────────────── */}
          {step === "account" && (
            <div className="jf-stack">
              <h2 className="jf-section-title">Admin account</h2>
              <p className="jf-prose">This will be your login to manage the site.</p>

              <Field label="Your email">
                <input
                  className="jf-input"
                  type="email"
                  value={account.email}
                  placeholder="you@example.com"
                  onChange={(e) => setAccount((a) => ({ ...a, email: e.target.value }))}
                />
              </Field>

              <div className="jf-grid jf-grid--2">
                <Field label="Username">
                  <input
                    className="jf-input"
                    value={account.username}
                    placeholder="admin"
                    onChange={(e) => setAccount((a) => ({ ...a, username: e.target.value }))}
                  />
                </Field>
                <Field label="Display name">
                  <input
                    className="jf-input"
                    value={account.displayName}
                    placeholder="Site Admin"
                    onChange={(e) => setAccount((a) => ({ ...a, displayName: e.target.value }))}
                  />
                </Field>
              </div>

              <div className="jf-grid jf-grid--2">
                <Field
                  label="Password"
                  error={account.password.length > 0 && account.password.length < 8 ? "Password must be at least 8 characters" : undefined}
                >
                  <input
                    className={`jf-input${account.password.length > 0 && account.password.length < 8 ? " jf-input--invalid" : ""}`}
                    type="password"
                    value={account.password}
                    autoComplete="new-password"
                    onChange={(e) => setAccount((a) => ({ ...a, password: e.target.value }))}
                  />
                </Field>
                <Field label="Confirm password" error={!passwordsMatch ? "Passwords do not match" : undefined}>
                  <input
                    className={`jf-input${!passwordsMatch ? " jf-input--invalid" : ""}`}
                    type="password"
                    value={account.confirmPassword}
                    autoComplete="new-password"
                    onChange={(e) =>
                      setAccount((a) => ({ ...a, confirmPassword: e.target.value }))
                    }
                  />
                </Field>
              </div>

              <Row>
                <button className="jf-btn jf-btn--ghost" onClick={() => setStep("site")}>← Back</button>
                <button
                  className="jf-btn jf-btn--primary"
                  disabled={!canInstall}
                  onClick={runInstall}
                >
                  Install Justflows
                </button>
              </Row>
            </div>
          )}

          {/* ── INSTALLING ──────────────────────────────────────────────── */}
          {step === "installing" && (
            <div className="jf-stack">
              <h2 className="jf-section-title">{fatalError ? "Installation failed" : "Installing…"}</h2>
              <div className="jf-log" role="log" aria-live="polite" aria-relevant="additions">
                {log.map((entry, i) => (
                  <p
                    key={i}
                    className={`jf-log__line${
                      entry.status === "ok" ? " jf-log__line--ok"
                        : entry.status === "error" ? " jf-log__line--fail"
                        : ""
                    }`}
                  >
                    {entry.status === "ok" ? "✓" : entry.status === "error" ? "✗" : "⋯"} {entry.message}
                  </p>
                ))}
              </div>

              {fatalError && (
                <div className="jf-alert jf-alert--error" role="alert">
                  <strong>Error:</strong> {fatalError}
                </div>
              )}

              {fatalError && (
                <button className="jf-btn jf-btn--ghost" onClick={() => setStep("database")}>
                  ← Fix settings and try again
                </button>
              )}
            </div>
          )}

          {/* ── DONE ────────────────────────────────────────────────────── */}
          {step === "done" && (
            <div className="jf-stack" style={{ textAlign: "center", alignItems: "center" }}>
              <div style={{ fontSize: "3.5rem", marginBottom: "0.75rem" }}>🎉</div>
              <h2 className="jf-section-title">
                {site.name || "Your site"} is ready!
              </h2>
              <p className="jf-prose" style={{ marginInline: "auto" }}>
                Sign in with <strong>{account.email}</strong> to get started.
              </p>
              <button
                className="jf-btn jf-btn--primary"
                onClick={() => navigate("/admin")}
              >
                Go to Admin dashboard →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── small components ──────────────────────────────────────────────────────────

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactElement<{ id?: string; "aria-invalid"?: boolean; "aria-describedby"?: string }>;
}) {
  const htmlFor = `jf-install-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  const errorId = error ? `${htmlFor}-error` : undefined;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id: htmlFor,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": errorId,
      })
    : children;

  return (
    <div className="jf-field">
      <label className="jf-field__label" htmlFor={htmlFor}>{label}</label>
      {control}
      {error && (
        <p id={errorId} className="jf-field__hint" role="alert" style={{ color: "var(--jf-danger)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="jf-navrow">{children}</div>;
}
