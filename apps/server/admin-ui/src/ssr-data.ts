export interface SerializedResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

export interface AdminSsrPayload {
  url: string;
  locale: string;
  responses: Record<string, SerializedResponse>;
}

let activePayload: AdminSsrPayload | null = null;

export function setAdminSsrPayload(payload: AdminSsrPayload | null): void {
  activePayload = payload;
}

export function getAdminSsrPayload(): AdminSsrPayload | null {
  return activePayload;
}

export function initialJson<T>(url: string): T | undefined {
  const response = activePayload?.responses[url];
  if (!response?.body || response.status < 200 || response.status >= 300) return undefined;
  try {
    return JSON.parse(response.body) as T;
  } catch {
    return undefined;
  }
}

export function readAdminSsrPayload(): AdminSsrPayload | null {
  if (typeof document === "undefined") return activePayload;
  const node = document.getElementById("jf-ssr-data");
  if (!node?.textContent) return null;
  try {
    return JSON.parse(node.textContent) as AdminSsrPayload;
  } catch {
    return null;
  }
}

function requestKey(input: RequestInfo | URL): string | null {
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.href);
    return url.origin === window.location.origin ? `${url.pathname}${url.search}` : null;
  } catch {
    return null;
  }
}

/** Serve server-prefetched GETs during hydration, then return to native fetch. */
export function installSsrFetchCache(payload: AdminSsrPayload | null): void {
  if (!payload || typeof window === "undefined") return;
  const responses = new Map(Object.entries(payload.responses));
  const nativeFetch = window.fetch.bind(window);
  const expires = window.setTimeout(() => responses.clear(), 5_000);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (method === "GET" || method === "HEAD") {
      const key = requestKey(input);
      const cached = key ? responses.get(key) : undefined;
      if (cached) {
        return Promise.resolve(new Response(method === "HEAD" ? null : cached.body, {
          status: cached.status,
          statusText: cached.statusText,
          headers: cached.headers,
        }));
      }
    } else {
      window.clearTimeout(expires);
      responses.clear();
    }
    return nativeFetch(input, init);
  };
}
