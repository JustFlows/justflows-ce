import { fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "../../../helpers/render";
import { I18nProvider } from "../../../../src/i18n/I18nProvider";
import PlatformPage from "../../../../src/pages/admin/platform/PlatformPage";
import { setAdminSsrPayload } from "../../../../src/ssr-data";

const overview = {
  tenants: [],
  sites: [],
  databases: [],
  installationPort: 5432,
  settings: {
    signupEnabled: true,
    signupDatabaseMode: "separate",
    baseDomain: "justflows.com",
    signupDatabase: { host: "127.0.0.1", port: 5432, database: "customers", username: "customers", passwordSet: true },
    purgeAfterDays: 30,
  },
};

function stubFetch(): Array<{ signupDatabaseMode?: string; database?: { database: string } }> {
  const saved: Array<{ signupDatabaseMode?: string; database?: { database: string } }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") saved.push(JSON.parse(String(init.body)));
      return { ok: true, status: 200, json: async () => (String(input).includes("overview") ? overview : {}) } as Response;
    }),
  );
  return saved;
}

function renderPage(): void {
  render(
    <MemoryRouter>
      <I18nProvider>
        <PlatformPage />
      </I18nProvider>
    </MemoryRouter>,
  );
}

function modeRadio(value: "current" | "separate"): HTMLInputElement {
  return document.querySelector(`input[name="signupDatabaseMode"][value="${value}"]`) as HTMLInputElement;
}

async function settingsLoaded(): Promise<void> {
  await waitFor(() => {
    expect((document.querySelector('input[name="baseDomain"]') as HTMLInputElement).value).toBe("justflows.com");
  });
}

afterEach(() => {
  setAdminSsrPayload(null);
  vi.unstubAllGlobals();
});

describe("PlatformPage signup settings", () => {
  it("shows the stored database choice when the settings load after the first render", async () => {
    stubFetch();
    renderPage();
    await settingsLoaded();
    expect(modeRadio("separate").checked).toBe(true);
    expect(modeRadio("current").checked).toBe(false);
  });

  it("keeps the separate database when saving after a client-side visit", async () => {
    const saved = stubFetch();
    renderPage();
    await settingsLoaded();
    fireEvent.submit(modeRadio("current").closest("form") as HTMLFormElement);
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]?.signupDatabaseMode).toBe("separate");
    expect(saved[0]?.database?.database).toBe("customers");
  });

  it("shows the stored database choice when the server seeds the page", async () => {
    stubFetch();
    setAdminSsrPayload({
      url: "/",
      locale: "en",
      adminBasePath: "/admin",
      responses: {
        "/api/platform/overview": { status: 200, statusText: "OK", headers: {}, body: JSON.stringify(overview) },
      },
    });
    renderPage();
    await settingsLoaded();
    expect(modeRadio("separate").checked).toBe(true);
  });
});
