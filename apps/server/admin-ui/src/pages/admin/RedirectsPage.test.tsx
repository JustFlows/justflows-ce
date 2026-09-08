// SPDX-License-Identifier: MIT
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RedirectsPage from "./RedirectsPage";
vi.mock("../../i18n/I18nProvider", () => ({ useT: () => ({ t: (key: string) => key }) }));
const input = {
  id: "bd922cab-6845-4035-bbdb-4fabbe06f87a",
  source: "/old",
  kind: "exact",
  targetType: "internal",
  target: "/new",
  status: 301,
  enabled: true,
};
const config = {
  rules: [input],
  suggestions: [{ ...input, id: "history:/before", source: "/before", target: "/current" }],
  content: [{ id: "c1", title: "Current page", path: "/current" }],
};
const entries = [
  {
    path: "/missing",
    hits: 42,
    referrer: "https://example.test/source",
    firstSeen: "2026-09-01",
    lastSeen: "2026-09-08",
  },
];
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string | URL | Request, init?: RequestInit) =>
        new Response(
          JSON.stringify(
            init?.method ? { ok: true } : String(url).includes("not-found") ? { entries } : config,
          ),
        ),
    ),
  );
});
describe("RedirectsPage", () => {
  it("prefills a 404, focuses its destination and creates a redirect", async () => {
    const user = userEvent.setup();
    render(<RedirectsPage />);
    await user.click(await screen.findByRole("button", { name: "redirects.createFrom404" }));
    expect(screen.getByLabelText("redirects.source")).toHaveValue("/missing");
    expect(screen.getByLabelText("redirects.target")).toHaveFocus();
    await user.type(screen.getByLabelText("redirects.target"), "/replacement");
    await user.selectOptions(screen.getByLabelText("redirects.status"), "308");
    await user.click(screen.getByRole("button", { name: "redirects.save" }));
    await screen.findByRole("status");
    const call = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(call[0]).toBe("/api/redirects");
    expect(JSON.parse(String(call[1]?.body))).toEqual({
      source: "/missing",
      kind: "exact",
      targetType: "internal",
      target: "/replacement",
      status: 308,
      enabled: true,
    });
  });
  it("focuses the destination when converting a 404 after choosing a content target", async () => {
    const user = userEvent.setup();
    render(<RedirectsPage />);
    await user.selectOptions(await screen.findByLabelText("redirects.targetType"), "content");
    await user.click(screen.getByRole("button", { name: "redirects.createFrom404" }));
    expect(screen.getByLabelText("redirects.target")).toHaveFocus();
    expect(screen.getByLabelText("redirects.source")).toHaveValue("/missing");
  });
  it("disables an existing rule", async () => {
    render(<RedirectsPage />);
    await userEvent.click(await screen.findByRole("button", { name: "redirects.disable" }));
    await screen.findByRole("status");
    const call = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(call[0]).toBe(`/api/redirects/${input.id}`);
    expect(JSON.parse(String(call[1]?.body)).enabled).toBe(false);
  });
  it("turns a history suggestion into a content-linked editable draft", async () => {
    render(<RedirectsPage />);
    await userEvent.click(await screen.findByRole("button", { name: "redirects.review" }));
    expect(screen.getByLabelText("redirects.source")).toHaveValue("/before");
    expect(screen.getByLabelText("redirects.targetType")).toHaveValue("content");
    expect(screen.getByLabelText("redirects.target")).toHaveValue("c1");
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method)).toBe(true);
  });
  it("keeps edits on validation errors and allows retry", async () => {
    const user = userEvent.setup();
    render(<RedirectsPage />);
    await user.click(await screen.findByRole("button", { name: "redirects.edit" }));
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Redirect loop." }), { status: 400 }),
    );
    await user.click(screen.getByRole("button", { name: "redirects.save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Redirect loop.");
    expect(screen.getByLabelText("redirects.source")).toHaveValue("/old");
    expect(screen.getByRole("button", { name: "redirects.save" })).toBeEnabled();
  });
  it("imports CSV and retains it if the server rejects a row", async () => {
    const user = userEvent.setup();
    render(<RedirectsPage />);
    const field = await screen.findByLabelText("redirects.csvText");
    await user.type(
      field,
      "source,kind,targetType,target,status,enabled\n/a,exact,internal,/b,301,true",
    );
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Duplicate source." }), { status: 400 }),
    );
    await user.click(screen.getByRole("button", { name: "redirects.import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Duplicate source.");
    expect(field).not.toHaveValue("");
    expect(screen.getByRole("link", { name: "redirects.export" })).toHaveAttribute(
      "href",
      "/api/redirects/export",
    );
  });
  it("offers retry after a loading error", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Offline"));
    render(<RedirectsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
    await userEvent.click(screen.getByRole("button", { name: "redirects.retry" }));
    await screen.findByLabelText("redirects.source");
  });
});
