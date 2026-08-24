import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { readCsrfCookie } from "./lib/csrf";
import "./styles/admin.css";

/** The CSRF token authenticates requests to this origin; nowhere else may see it. */
function isSameOrigin(input: RequestInfo | URL): boolean {
  try {
    const url =
      typeof input === "string"
        ? new URL(input, window.location.href)
        : input instanceof URL
          ? input
          : new URL(input.url, window.location.href);
    return url.origin === window.location.origin;
  } catch {
    return false;
  }
}

const nativeFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS" && isSameOrigin(input)) {
    const csrf = readCsrfCookie();
    if (csrf) {
      const headers = new Headers(init?.headers);
      headers.set("X-CSRF-Token", csrf);
      init = { ...init, headers };
    }
  }
  return nativeFetch(input, init);
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
