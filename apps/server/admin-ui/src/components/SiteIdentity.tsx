import { useEffect, useState } from "react";
import { initialJson } from "../ssr-data";

interface SiteIdentity {
  siteTitle: string;
  tagline: string;
  logoUrl: string;
  faviconUrl: string;
}

export function useSiteIdentity(): SiteIdentity {
  const prefetched = initialJson<Partial<SiteIdentity>>("/api/site/identity");
  const [identity, setIdentity] = useState<SiteIdentity>({
    siteTitle: prefetched?.siteTitle ?? "My Site",
    tagline: prefetched?.tagline ?? "",
    logoUrl: prefetched?.logoUrl ?? "",
    faviconUrl: prefetched?.faviconUrl ?? "",
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const preview = new URLSearchParams(window.location.search).get("preview") === "1";
    const url = preview ? "/api/site/identity?preview=1" : "/api/site/identity";
    fetch(url)
      .then((r) => r.json())
      .then((data: Partial<SiteIdentity>) =>
        setIdentity({
          siteTitle: data.siteTitle ?? "My Site",
          tagline: data.tagline ?? "",
          logoUrl: data.logoUrl ?? "",
          faviconUrl: data.faviconUrl ?? "",
        }),
      )
      .catch(() => {});
  }, []);

  return identity;
}

export function SiteBrand({ identity, href = "/" }: { identity: SiteIdentity; href?: string }) {
  return (
    <a
      href={href}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.6rem",
        fontWeight: 800,
        fontSize: "1.2rem",
        color: "var(--color-text, #0f172a)",
        textDecoration: "none",
      }}
    >
      {identity.logoUrl ? (
        <img
          src={identity.logoUrl}
          alt={identity.siteTitle}
          style={{ height: 32, width: "auto" }}
        />
      ) : null}
      {identity.siteTitle}
    </a>
  );
}

/** Sets the admin/login tab icon from Site Identity. */
export function SiteFavicon() {
  const identity = useSiteIdentity();

  useEffect(() => {
    if (typeof document === "undefined") return;
    const url = identity.faviconUrl.trim();
    if (!url) return;

    let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!icon) {
      icon = document.createElement("link");
      icon.rel = "icon";
      document.head.appendChild(icon);
    }
    icon.href = url;

    let apple = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
    if (!apple) {
      apple = document.createElement("link");
      apple.rel = "apple-touch-icon";
      document.head.appendChild(apple);
    }
    apple.href = url;
  }, [identity.faviconUrl]);

  return null;
}
