import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WebhooksPage from "../admin/WebhooksPage";

vi.mock("../../i18n/I18nProvider", () => ({
  useT: () => ({
    t: (key: string, vars?: Record<string, string | number>) =>
      key === "webhooks.selectedEvents" ? `${vars?.count} events selected` : key,
  }),
}));

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/deliveries/history")) {
        return new Response(JSON.stringify({ deliveries: [] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          endpoints: [],
          eventTypes: ["content.published", "user.created", "plugin.installed", "core.updated"],
        }),
        { status: 200 },
      );
    }),
  );
});

describe("WebhooksPage", () => {
  it("uses a dropdown multi-select and shows selected event chips", async () => {
    const user = userEvent.setup();
    render(<WebhooksPage />);

    await screen.findByRole("heading", { name: "webhooks.title" });
    const selector = screen.getByText("webhooks.chooseEvents");
    await user.click(selector);
    await user.click(screen.getByRole("checkbox", { name: "user.created" }));
    await user.click(screen.getByRole("checkbox", { name: "plugin.installed" }));

    expect(screen.getByText("2 events selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "user.created ×" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "plugin.installed ×" })).toBeInTheDocument();
  });

  it("selects and clears every event from the dropdown", async () => {
    const user = userEvent.setup();
    render(<WebhooksPage />);
    await screen.findByRole("heading", { name: "webhooks.title" });
    await user.click(screen.getByText("webhooks.chooseEvents"));
    await user.click(screen.getByRole("button", { name: "webhooks.selectAll" }));
    await waitFor(() => expect(screen.getByText("4 events selected")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "webhooks.clear" }));
    expect(screen.getByText("webhooks.chooseEvents")).toBeInTheDocument();
  });
});
