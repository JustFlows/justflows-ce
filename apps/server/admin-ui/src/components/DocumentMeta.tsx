import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useT } from "../i18n/I18nProvider";
import { findNavItemForPath, navLabel } from "../config/admin-nav";
import { usePluginMenu } from "./PluginMenuProvider";

const PRODUCT_NAME = "Justflows";

/** Catalog keys for the pages that render before a session exists. */
const PRE_AUTH_TITLES: Record<string, string> = {
  "/install": "install.title",
  "/login": "meta.login",
  "/register": "meta.register",
  "/forgot-password": "meta.forgotPassword",
  "/reset-password": "meta.resetPassword",
};

function setMetaTag(name: string, content: string) {
  let tag = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!tag) {
    tag = document.createElement("meta");
    tag.name = name;
    document.head.appendChild(tag);
  }
  tag.content = content;
}

/**
 * Keeps the tab title and meta description in step with the current admin
 * page: "Media ‹ My Site — Justflows", WordPress-style. `siteTitle` is omitted
 * on pre-auth pages, which carry product branding only.
 */
export function DocumentMeta({ siteTitle }: { siteTitle?: string }) {
  const { pathname } = useLocation();
  const { t } = useT();
  const { domains } = usePluginMenu();

  const preAuthKey = PRE_AUTH_TITLES[pathname];
  const item = preAuthKey ? null : findNavItemForPath(pathname, domains);
  const page = preAuthKey ? t(preAuthKey) : item ? navLabel(t, item) : "";
  const title = [page, siteTitle].filter(Boolean).join(" ‹ ");
  const fullTitle = title ? `${title} — ${PRODUCT_NAME}` : PRODUCT_NAME;
  const description = t("meta.description");

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.title = fullTitle;
    setMetaTag("description", description);
  }, [fullTitle, description]);

  return null;
}
