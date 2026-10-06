/**
 * Poll until the app has finished loading after a restart.
 * A systemd stop/start plus a cold boot can take about a minute. `/api/healthz`
 * returns 200 with `boot: "starting"` the whole time, so that is not "back".
 */
export async function waitForSiteRestart(t: (key: string) => string, onLog?: (line: string) => void): Promise<boolean> {
  const log = (line: string) => onLog?.(line);
  log(`↻ ${t("updates.log.appRestarting")}`);
  await sleep(3000);

  for (let attempt = 0; attempt < 70; attempt++) {
    try {
      const res = await fetchWithTimeout("/api/healthz", 5000);
      if (res.ok) {
        const body = await res.json() as { boot?: string };
        if (body.boot === "ready") {
          log(`✓ ${t("updates.log.siteBack")}`);
          await sleep(800);
          window.location.reload();
          return true;
        }
      }
    } catch {
      // expected while the process is down
    }
    await sleep(1500);
  }

  log(`⚠ ${t("updates.log.restartInProgress")}`);
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
