import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles/admin.css";

function readCsrfCookie(): string | null {
  const match = document.cookie.match(/(?:^|; )jf_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]!) : null;
}

const nativeFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
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
