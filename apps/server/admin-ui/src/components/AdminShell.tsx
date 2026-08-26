import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ADMIN_UI_LOCALES, useT, type AdminUiLocale } from "../i18n/I18nProvider";
import { ADMIN_DASHBOARD, findDomainForPath, isDomainActive } from "../config/admin-nav";
import DomainSubnav from "./DomainSubnav";
import { usePluginMenu } from "./PluginMenuProvider";
import { JustflowsLogo } from "./JustflowsLogo";
import { initialJson } from "../ssr-data";

export default function AdminShell() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t, locale, setLocale } = useT();
  const [navOpen, setNavOpen] = useState(false);
  const [version, setVersion] = useState(
    () => initialJson<{ version?: string }>("/api/updates")?.version ?? "",
  );
  // Domains carry the pages of whichever plugins are installed right now.
  const { domains } = usePluginMenu();
  const activeDomain = findDomainForPath(pathname, domains);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setNavOpen(false), [pathname]);

  useEffect(() => {
    fetch("/api/updates")
      .then((r) => r.json())
      .then((data: { version?: string }) => {
        if (data.version) setVersion(data.version);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    navigate("/login");
  }

  return (
    <div className="jf-app">
      <button
        type="button"
        className="jf-scrim"
        data-open={navOpen}
        aria-label="Close navigation"
        onClick={() => setNavOpen(false)}
      />

      <aside className="jf-sidebar" data-open={navOpen}>
        <div className="jf-brand">
          <JustflowsLogo />
          <span className="jf-brand__name">Justflows</span>
        </div>

        <nav className="jf-nav" aria-label="Admin">
          <NavLink to={ADMIN_DASHBOARD.to} end={ADMIN_DASHBOARD.end} className="jf-nav__link">
            <span className="jf-nav__icon" aria-hidden="true">
              {ADMIN_DASHBOARD.icon}
            </span>
            {t(ADMIN_DASHBOARD.key)}
          </NavLink>

          {domains.map((domain) => (
            <NavLink key={domain.key} to={domain.items[0].to} className="jf-nav__link">
              <span className="jf-nav__icon" aria-hidden="true">
                {domain.icon}
              </span>
              {t(domain.key)}
            </NavLink>
          ))}
        </nav>

        <div className="jf-sidebar__footer">
          <label className="jf-sidebar__label" htmlFor="jf-ui-locale">
            {t("languages.uiLanguage")}
          </label>
          <select
            id="jf-ui-locale"
            className="jf-sidebar__select"
            value={locale}
            onChange={(e) => setLocale(e.target.value as AdminUiLocale)}
          >
            {ADMIN_UI_LOCALES.map((code) => (
              <option key={code} value={code}>
                {code.toUpperCase()}
              </option>
            ))}
          </select>
          <button type="button" className="jf-sidebar__signout" onClick={logout}>
            {t("common.signOut")}
          </button>
          <div className="jf-sidebar__version">
            {version ? `Justflows v${version}` : "Justflows"}
          </div>
        </div>
      </aside>

      <main className="jf-main">
        {/* Mobile-only bar: the sidebar is a drawer below 900px, so every
            page needs a way to open it. */}
        <div className="jf-mobilebar">
          <button
            type="button"
            className="jf-navtoggle"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            aria-expanded={navOpen}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
          <JustflowsLogo />
          <span className="jf-brand__name" style={{ color: "var(--jf-text)" }}>
            Justflows
          </span>
        </div>

        {activeDomain && <DomainSubnav domain={activeDomain} />}
        <Outlet />
      </main>
    </div>
  );
}
