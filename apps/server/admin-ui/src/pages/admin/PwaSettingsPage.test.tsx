// SPDX-License-Identifier: MIT

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PwaSettingsPage from "./PwaSettingsPage";

vi.mock("../../i18n/I18nProvider", () => ({ useT: () => ({ t: (key: string) => key }) }));

const settings = {
  enabled: false,
  appName: "My Site",
  shortName: "",
  description: "",
  iconUrl: "",
  icon192Url: "",
  icon512Url: "/uploads/icon-512.png",
  appleTouchIconUrl: "",
  maskableIconUrl: "",
  maskableIcon192Url: "",
  maskableIcon512Url: "",
  themeColor: "#111111",
  backgroundColor: "#ffffff",
  display: "standalone",
  startUrl: "/",
  shortcuts: [],
  installUi: { enabled: true, label: "", description: "", showLogo: true },
  offline: { title: "", message: "", imageUrl: "" },
  assetCache: { enabled: true, maxEntries: 100, maxAgeSeconds: 604800 },
  diagnostics: { https: true, manifestUrl: "/manifest.webmanifest", serviceWorkerUrl: "/sw.js" },
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(settings))),
  );
});

describe("PwaSettingsPage", () => {
  it("loads settings and shows the HTTPS diagnostic", async () => {
    render(<PwaSettingsPage />);
    expect(await screen.findByDisplayValue("My Site")).toBeInTheDocument();
    expect(screen.getByText("pwa.diagnosticsHttpsOk")).toBeInTheDocument();
  });

  it("saves the form and includes the enable checkbox state", async () => {
    const user = userEvent.setup();
    render(<PwaSettingsPage />);
    await screen.findByDisplayValue("My Site");
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ...settings, enabled: true })),
    );
    await user.click(screen.getByRole("checkbox", { name: "pwa.enable" }));
    await user.click(screen.getByRole("button", { name: "pwa.save" }));
    await screen.findByRole("status");
    const request = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PUT")!;
    const body = JSON.parse(String(request[1]?.body));
    expect(body.enabled).toBe(true);
    expect(body.appName).toBe("My Site");
  });

  it("lets an administrator turn off the PWA logo in the install prompt", async () => {
    const user = userEvent.setup();
    render(<PwaSettingsPage />);
    await screen.findByDisplayValue("My Site");
    const logoCheckbox = screen.getByRole("checkbox", { name: "pwa.installUiShowLogo" });
    expect(logoCheckbox).toBeChecked();

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ...settings, installUi: { ...settings.installUi, showLogo: false } })),
    );
    await user.click(logoCheckbox);
    await user.click(screen.getByRole("button", { name: "pwa.save" }));
    await screen.findByRole("status");
    const request = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PUT")!;
    const body = JSON.parse(String(request[1]?.body));
    expect(body.installUi.showLogo).toBe(false);
  });

  it("blocks enabling when there is no app name or icon", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ...settings, appName: "", icon512Url: "" })),
    );
    render(<PwaSettingsPage />);
    const checkbox = await screen.findByRole("checkbox", { name: "pwa.enable" });
    expect(checkbox).toBeDisabled();
    expect(screen.getByText("pwa.enableRequirementsError")).toBeInTheDocument();
  });

  it("surfaces a server-side save error", async () => {
    const user = userEvent.setup();
    render(<PwaSettingsPage />);
    await screen.findByDisplayValue("My Site");
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Start URL must be a public path" }), { status: 400 }),
    );
    await user.click(screen.getByRole("button", { name: "pwa.save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Start URL must be a public path");
  });
});
