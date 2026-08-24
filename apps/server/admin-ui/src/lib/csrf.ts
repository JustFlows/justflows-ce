export function readCsrfCookie(): string | null {
  const match = document.cookie.match(/(?:^|; )jf_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]!) : null;
}

/** Ensure a CSRF cookie exists before a POST that the server will check. */
export async function ensureCsrfCookie(): Promise<void> {
  if (readCsrfCookie()) return;
  await fetch("/api/auth/csrf");
}
