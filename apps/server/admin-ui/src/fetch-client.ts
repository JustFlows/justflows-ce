import { readCsrfCookie } from "./lib/csrf";

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

export function installCsrfFetch(): void {
  const previousFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS" && isSameOrigin(input)) {
      const csrf = readCsrfCookie();
      if (csrf) {
        const headers = new Headers(init?.headers);
        headers.set("X-CSRF-Token", csrf);
        init = { ...init, headers };
      }
    }
    return previousFetch(input, init);
  };
}
