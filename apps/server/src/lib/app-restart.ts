import fsp from "node:fs/promises";
import path from "node:path";

/**
 * Trigger a Phusion Passenger restart (used by Plesk Node.js).
 * Touching tmp/restart.txt reloads the app on the next HTTP request.
 */
export async function requestPassengerRestart(appRoot: string): Promise<{
  ok: boolean;
  path: string;
  error?: string;
}> {
  const restartFile = path.join(appRoot, "tmp", "restart.txt");

  try {
    await fsp.mkdir(path.dirname(restartFile), { recursive: true });
    await fsp.writeFile(restartFile, `${Date.now()}\n`, "utf-8");
    return { ok: true, path: restartFile };
  } catch (err) {
    return {
      ok: false,
      path: restartFile,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
