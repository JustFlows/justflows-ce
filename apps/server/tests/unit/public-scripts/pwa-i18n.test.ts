// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function runScript(name: string, labels: Record<string, string>) {
  const script = document.createElement("script");
  Object.assign(script.dataset, labels);
  vi.spyOn(document, "currentScript", "get").mockReturnValue(script);
  const source = fs.readFileSync(path.resolve(fileURLToPath(import.meta.url), `../../../../../../public/js/${name}.js`), "utf8");
  new Function(source).call(window);
}

beforeEach(() => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
  vi.restoreAllMocks();
});

describe("PWA browser translations", () => {
  it("uses translated install and dismiss labels from its script tag", () => {
    vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
    // Capture the handler so this test doesn't leave a global listener behind.
    const listeners = vi.spyOn(window, "addEventListener").mockImplementation(() => {});
    runScript("pwa-install", {
      label: "Installeren", description: "Gebruik de app", installAria: "App installeren",
      dismiss: "Sluiten", showLogo: "0",
    });
    const handler = listeners.mock.calls.find(([name]) => name === "beforeinstallprompt")?.[1] as EventListener;
    expect(handler).toBeTypeOf("function");
    handler(new Event("beforeinstallprompt", { cancelable: true }));
    expect(document.querySelector('[role="region"]')?.getAttribute("aria-label")).toBe("App installeren");
    expect(document.body.textContent).toContain("Gebruik de app");
    expect(document.body.textContent).toContain("Installeren");
    expect(document.querySelector('button[aria-label="Sluiten"]')).not.toBeNull();
  });

  it("uses translated iOS instructions without replacing them with custom install prose", () => {
    vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("iPhone Safari");
    vi.spyOn(window, "addEventListener").mockImplementation(() => {});
    runScript("pwa-install", {
      iosInstructions: "Tik op Deel en zet de app op je beginscherm.",
      description: "Custom description", installAria: "App installeren", dismiss: "Sluiten",
    });
    expect(document.body.textContent).toContain("Tik op Deel en zet de app op je beginscherm.");
    expect(document.body.textContent).not.toContain("Custom description");
  });

  it("retains translated update labels after script execution finishes", async () => {
    const worker = Object.assign(new EventTarget(), { state: "installed", postMessage: vi.fn() });
    const registration = Object.assign(new EventTarget(), { installing: worker });
    const serviceWorker = Object.assign(new EventTarget(), {
      register: vi.fn().mockResolvedValue(registration), controller: {},
    });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: serviceWorker });
    const listeners = vi.spyOn(window, "addEventListener").mockImplementation(() => {});
    runScript("pwa-register", { updateAvailable: "Er is een update beschikbaar.", reload: "Opnieuw laden" });
    vi.spyOn(document, "currentScript", "get").mockReturnValue(null);
    const onLoad = listeners.mock.calls.find(([name]) => name === "load")?.[1] as EventListener;
    onLoad(new Event("load"));
    await Promise.resolve();
    registration.dispatchEvent(new Event("updatefound"));
    worker.dispatchEvent(new Event("statechange"));
    expect(document.querySelector('[role="status"]')?.textContent).toContain("Er is een update beschikbaar.");
    const button = document.querySelector("button")!;
    expect(button.textContent).toBe("Opnieuw laden");
    button.click();
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    Reflect.deleteProperty(navigator, "serviceWorker");
  });
});
