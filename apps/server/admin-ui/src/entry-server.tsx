import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import App from "./App";
import { setAdminSsrPayload, type AdminSsrPayload } from "./ssr-data";

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
