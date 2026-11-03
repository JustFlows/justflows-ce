import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import App from "./App";
import { setAdminSsrPayload, type AdminSsrPayload } from "./ssr-data";

/** Await once before the first `render`, so lazily split pages render synchronously. */
export { preloadAllPages as preloadPages } from "./lazy-page";

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
