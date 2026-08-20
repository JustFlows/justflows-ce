/** Poll until the app responds after a Passenger restart (tmp/restart.txt). */
export async function waitForSiteRestart(onLog?: (line: string) => void): Promise<boolean> {
  const log = (line: string) => onLog?.(line);
  log("↻ App is restarting — waiting for site to come back…");
  await sleep(3000);

  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const res = await fetchWithTimeout("/api/healthz", 5000);
      if (res.ok) {
        const body = await res.json() as { boot?: string };
        if (body.boot === "ready") {
          log("✓ Site is back online — reloading…");
          await sleep(800);
          window.location.reload();
          return true;
        }
      }
    } catch {
      // expected while Passenger restarts
    }
    await sleep(1500);
  }

  log("⚠ Restart may still be in progress — refresh the page manually if needed");
  return false;
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
