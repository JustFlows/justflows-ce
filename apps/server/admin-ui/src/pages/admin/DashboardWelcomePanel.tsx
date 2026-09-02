import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useSessionRole } from "@components/SessionProvider";
import { useT } from "../../i18n/I18nProvider";
import { canAccessPath } from "../../config/admin-nav";
import { DISCOVERY_CARDS } from "../../config/discovery-cards";

const STORAGE_KEY = "jf_dashboard_welcome";
const PREF_KEY = "dashboard_welcome";

export interface WelcomeState {
  dismissed: boolean;
  collapsed: boolean;
}

const DEFAULT_STATE: WelcomeState = { dismissed: false, collapsed: false };

function coerce(raw: Partial<WelcomeState> | null | undefined): WelcomeState {
  return {
    dismissed: raw?.dismissed === true,
    collapsed: raw?.collapsed === true,
  };
}

function readLocal(): WelcomeState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? coerce(JSON.parse(raw) as Partial<WelcomeState>) : DEFAULT_STATE;
  } catch {
    return DEFAULT_STATE;
  }
}

function writeLocal(state: WelcomeState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private mode / quota — the server copy still holds the choice */
  }
}

/**
 * Welcome-panel state, mirrored between this browser's localStorage (instant,
 * offline-safe first paint) and the signed-in user's server preference (follows
 * the account across devices). The server copy wins on load; every write goes
 * to both. All network calls are best-effort — offline, the panel keeps working
 * from the local mirror.
 */
export function useDashboardWelcome(): {
  state: WelcomeState;
  update: (patch: Partial<WelcomeState>) => void;
} {
  const [state, setState] = useState<WelcomeState>(readLocal);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/preferences", { headers: { Accept: "application/json" } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { preferences?: Record<string, Partial<WelcomeState>> } | null) => {
        const remote = data?.preferences?.[PREF_KEY];
        if (cancelled || !remote) return;
        const next = coerce(remote);
        setState(next);
        writeLocal(next);
      })
      .catch(() => {
        /* offline or route unavailable — keep the local value */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback((patch: Partial<WelcomeState>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      writeLocal(next);
      void fetch(`/api/preferences/${PREF_KEY}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      }).catch(() => {
        /* best effort — the local mirror holds the choice offline */
      });
      return next;
    });
  }, []);

  return { state, update };
}

export default function DashboardWelcomePanel({
  welcome,
}: {
  welcome: ReturnType<typeof useDashboardWelcome>;
}) {
  const role = useSessionRole();
  const { t } = useT();
  const { state, update } = welcome;

  if (role !== "administrator" || state.dismissed) return null;

  const cards = DISCOVERY_CARDS.filter((card) => card.external || canAccessPath(role, card.href));
  const expanded = !state.collapsed;

  return (
    <section className="jf-welcome" aria-labelledby="jf-welcome-title">
      <div className="jf-welcome__head">
        <div className="jf-welcome__intro">
          <h2 id="jf-welcome-title" className="jf-welcome__title">
            {t("dashboard.welcome.title")}
          </h2>
          {expanded && <p className="jf-welcome__subtitle">{t("dashboard.welcome.subtitle")}</p>}
        </div>
        <div className="jf-welcome__actions">
          <button
            type="button"
            className="jf-btn jf-btn--ghost jf-btn--sm"
            aria-expanded={expanded}
            aria-controls="jf-welcome-grid"
            onClick={() => update({ collapsed: expanded })}
          >
            {expanded ? t("dashboard.welcome.minimize") : t("dashboard.welcome.expand")}
          </button>
          <button
            type="button"
            className="jf-btn jf-btn--ghost jf-btn--sm"
            aria-label={t("dashboard.welcome.dismiss")}
            onClick={() => update({ dismissed: true })}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      </div>

      {expanded && (
        <div id="jf-welcome-grid" className="jf-welcome__grid">
          {cards.map((card) => {
            const body = (
              <>
                <span className="jf-tile__icon" aria-hidden="true">
                  {card.icon}
                </span>
                <div className="jf-tile__label">{t(card.titleKey)}</div>
                <div className="jf-tile__desc">{t(card.descKey)}</div>
              </>
            );
            return card.external ? (
              <a
                key={card.id}
                className="jf-tile"
                href={card.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {body}
                <span className="jf-sr-only"> {t("dashboard.welcome.opensNewTab")}</span>
              </a>
            ) : (
              <Link key={card.id} className="jf-tile" to={card.href}>
                {body}
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
