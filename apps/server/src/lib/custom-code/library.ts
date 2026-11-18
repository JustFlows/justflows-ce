// SPDX-License-Identifier: MIT

/**
 * Vetted third-party snippets. An administrator fills in named parameters;
 * the host writes the script, so no raw code is pasted for common services.
 * Each template names the origins it loads from, which are added to the
 * Content Security Policy only while a snippet using it is enabled.
 */

export type ConsentCategory = "necessary" | "preferences" | "analytics" | "marketing";

export interface LibraryParam {
  id: string;
  label: string;
  /** Anchored pattern every value must match. */
  pattern: RegExp;
  example: string;
  optional?: boolean;
}

export interface LibraryRender {
  /** Inline script body, rendered as <script>…</script>. */
  inline?: string;
  /** External script URL, rendered as <script src async>. */
  src?: string;
}

export interface LibraryTemplate {
  id: string;
  name: string;
  description: string;
  consent: ConsentCategory;
  params: LibraryParam[];
  /** https origins this template loads scripts from, sends data to, or frames. */
  origins: { script: string[]; connect?: string[]; img?: string[]; frame?: string[] };
  render(values: Record<string, string>): LibraryRender[];
}

const json = (value: string) => JSON.stringify(value).replace(/</g, "\\u003c");

export const SNIPPET_LIBRARY: readonly LibraryTemplate[] = [
  {
    id: "google-analytics",
    name: "Google Analytics 4",
    description: "Page views and events with gtag.js.",
    consent: "analytics",
    params: [{ id: "measurementId", label: "Measurement ID", pattern: /^G-[A-Z0-9]{4,16}$/, example: "G-ABC123XYZ" }],
    origins: {
      script: ["https://www.googletagmanager.com"],
      connect: ["https://*.google-analytics.com", "https://*.analytics.google.com", "https://www.googletagmanager.com"],
      img: ["https://*.google-analytics.com", "https://www.googletagmanager.com"],
    },
    render: ({ measurementId = "" }) => [
      { src: `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}` },
      { inline: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${json(measurementId)});` },
    ],
  },
  {
    id: "google-tag-manager",
    name: "Google Tag Manager",
    description: "Loads a GTM container. Tags inside the container load their own origins; add them to the allowlist.",
    consent: "analytics",
    params: [{ id: "containerId", label: "Container ID", pattern: /^GTM-[A-Z0-9]{4,12}$/, example: "GTM-AB12CD3" }],
    origins: { script: ["https://www.googletagmanager.com"], connect: ["https://www.googletagmanager.com"], img: ["https://www.googletagmanager.com"] },
    render: ({ containerId = "" }) => [
      { inline: `window.dataLayer=window.dataLayer||[];window.dataLayer.push({'gtm.start':new Date().getTime(),event:'gtm.js'});` },
      { src: `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(containerId)}` },
    ],
  },
  {
    id: "plausible",
    name: "Plausible Analytics",
    description: "Cookieless page analytics.",
    consent: "analytics",
    params: [
      { id: "domain", label: "Site domain", pattern: /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/, example: "example.com" },
      { id: "host", label: "Script host (self-hosted Plausible)", pattern: /^https:\/\/[a-z0-9.-]+(?::\d+)?$/, example: "https://plausible.io", optional: true },
    ],
    origins: { script: ["https://plausible.io"], connect: ["https://plausible.io"] },
    render: ({ domain = "", host }) => [{ src: `${host || "https://plausible.io"}/js/script.js#${encodeURIComponent(domain)}` }],
  },
  {
    id: "matomo",
    name: "Matomo",
    description: "Self-hosted or cloud Matomo tracking.",
    consent: "analytics",
    params: [
      { id: "url", label: "Matomo URL", pattern: /^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[A-Za-z0-9._~/-]*)?$/, example: "https://analytics.example.com/" },
      { id: "siteId", label: "Site ID", pattern: /^\d{1,9}$/, example: "1" },
    ],
    origins: { script: [], connect: [] },
    render: ({ url = "", siteId = "" }) => {
      const base = url.endsWith("/") ? url : `${url}/`;
      return [
        { inline: `var _paq=window._paq=window._paq||[];_paq.push(['trackPageView']);_paq.push(['enableLinkTracking']);_paq.push(['setTrackerUrl',${json(`${base}matomo.php`)}]);_paq.push(['setSiteId',${json(siteId)}]);` },
        { src: `${base}matomo.js` },
      ];
    },
  },
  {
    id: "meta-pixel",
    name: "Meta Pixel",
    description: "Facebook and Instagram ad conversion tracking.",
    consent: "marketing",
    params: [{ id: "pixelId", label: "Pixel ID", pattern: /^\d{8,20}$/, example: "123456789012345" }],
    origins: { script: ["https://connect.facebook.net"], connect: ["https://www.facebook.com"], img: ["https://www.facebook.com"] },
    render: ({ pixelId = "" }) => [
      { inline: `!function(f,n){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[]}(window);fbq('init',${json(pixelId)});fbq('track','PageView');` },
      { src: "https://connect.facebook.net/en_US/fbevents.js" },
    ],
  },
  {
    id: "microsoft-clarity",
    name: "Microsoft Clarity",
    description: "Heatmaps and session recordings.",
    consent: "analytics",
    params: [{ id: "projectId", label: "Project ID", pattern: /^[a-z0-9]{6,20}$/, example: "abcd1234ef" }],
    origins: { script: ["https://www.clarity.ms", "https://*.clarity.ms"], connect: ["https://*.clarity.ms"], img: ["https://*.clarity.ms"] },
    render: ({ projectId = "" }) => [
      { inline: `window.clarity=window.clarity||function(){(window.clarity.q=window.clarity.q||[]).push(arguments)};` },
      { src: `https://www.clarity.ms/tag/${encodeURIComponent(projectId)}` },
    ],
  },
];

export function libraryTemplate(id: string): LibraryTemplate | undefined {
  return SNIPPET_LIBRARY.find((template) => template.id === id);
}

/** Origins of a URL a self-hosted template points at (Matomo, Plausible on a custom host). */
export function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}
