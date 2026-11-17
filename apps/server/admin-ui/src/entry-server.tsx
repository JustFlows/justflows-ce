import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import App from "./App";
import { setAdminSsrPayload, type AdminSsrPayload } from "./ssr-data";
import { preloadEnglishFallback } from "./i18n/I18nProvider";
import { preloadAllPages } from "./lazy-page";

/** Await once before the first `render`, so lazily split pages and the English fallback render synchronously. */
export async function preloadPages(): Promise<void> {
  await Promise.all([preloadAllPages(), preloadEnglishFallback()]);
}

export function render(url: string, payload: AdminSsrPayload): string {
  setAdminSsrPayload(payload);
  try {
    return renderToString(
      <StrictMode>
        <StaticRouter location={url}>
          <App />
        </StaticRouter>
      </StrictMode>,
    );
  } finally {
    setAdminSsrPayload(null);
  }
}
