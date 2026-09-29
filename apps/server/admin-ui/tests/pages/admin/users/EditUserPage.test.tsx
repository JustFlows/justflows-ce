import { render } from "../../../helpers/render";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "@components/SessionProvider";
import EditUserPage from "../../../../src/pages/admin/users/EditUserPage";

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

const USER = {
  id: "member-1",
  email: "member@example.com",
  username: "member",
  display_name: "Member One",
  role: "subscriber",
  created_at: "2026-01-02T00:00:00.000Z",
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/users/member-1"]}>
      <SessionProvider>
        <Routes>
          <Route path="/admin/users/:id" element={<EditUserPage />} />
          <Route path="/admin/users" element={<div>Users list</div>} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  );
}

function mockFetch(role: string, extra?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | undefined): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/auth/me") return jsonResponse({ id: "self", email: "self@example.com", role });
      const extraResult = extra?.(input, init);
      if (extraResult) return extraResult;
      return jsonResponse({ user: USER });
    }),
  );
}

describe("EditUserPage as an administrator", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads the user into the form", async () => {
    mockFetch("administrator");
    renderPage();

    expect(await screen.findByDisplayValue("Member One")).toBeInTheDocument();
    expect(screen.getByDisplayValue("member@example.com")).toBeInTheDocument();
    expect(screen.getByLabelText("Role")).toHaveValue("subscriber");
  });

  it("saves display name and role changes", async () => {
    const calls: Array<{ path: string; body?: unknown }> = [];
    mockFetch("administrator", (input, init) => {
      if (init?.method === "PATCH") {
        calls.push({ path: String(input), body: init.body ? JSON.parse(String(init.body)) : undefined });
        return jsonResponse({ ok: true });
      }
      return undefined;
    });
    const user = userEvent.setup();
    renderPage();

    await screen.findByDisplayValue("Member One");
    await user.clear(screen.getByLabelText("Display name"));
    await user.type(screen.getByLabelText("Display name"), "New Name");
    await user.selectOptions(screen.getByLabelText("Role"), "editor");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(calls).toHaveLength(1));
    // grants/denies/scopes are omitted here: only the role actually changed,
    // and sending unchanged access fields would force a full access-policy
    // rewrite (and session revocation) on every save — see the regression
    // this guards against in EditUserPage.tsx.
    expect(calls[0]).toEqual({
      path: "/api/users/member-1",
      body: { displayName: "New Name", role: "editor", roleId: "editor" },
    });
    expect(await screen.findByText("User updated.")).toBeInTheDocument();
  });

  it("sends only displayName when nothing else changed", async () => {
    const calls: Array<{ path: string; body?: unknown }> = [];
    mockFetch("administrator", (input, init) => {
      if (init?.method === "PATCH") {
        calls.push({ path: String(input), body: init.body ? JSON.parse(String(init.body)) : undefined });
        return jsonResponse({ ok: true });
      }
      return undefined;
    });
    const user = userEvent.setup();
    renderPage();

    await screen.findByDisplayValue("Member One");
    await user.clear(screen.getByLabelText("Display name"));
    await user.type(screen.getByLabelText("Display name"), "New Name");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      path: "/api/users/member-1",
      body: { displayName: "New Name" },
    });
  });

  it("removes the user and navigates back to the list once confirmed", async () => {
    mockFetch("administrator", (_input, init) => (init?.method === "DELETE" ? jsonResponse({ ok: true }) : undefined));
    vi.stubGlobal("confirm", vi.fn(() => true));
    const user = userEvent.setup();
    renderPage();

    await screen.findByDisplayValue("Member One");
    await user.click(screen.getByRole("button", { name: "Remove user" }));

    expect(await screen.findByText("Users list")).toBeInTheDocument();
  });

  it("shows the server's error when removal is blocked", async () => {
    mockFetch("administrator", (_input, init) =>
      init?.method === "DELETE" ? jsonResponse({ error: "Cannot delete the last administrator" }, 400) : undefined,
    );
    vi.stubGlobal("confirm", vi.fn(() => true));
    const user = userEvent.setup();
    renderPage();

    await screen.findByDisplayValue("Member One");
    await user.click(screen.getByRole("button", { name: "Remove user" }));

    expect(await screen.findByText("Cannot delete the last administrator")).toBeInTheDocument();
  });
});

describe("EditUserPage additional roles", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("saves a checked additional role and never offers administrator or the primary role", async () => {
    const calls: unknown[] = [];
    mockFetch("administrator", (input, init) => {
      if (init?.method === "PATCH") {
        calls.push(JSON.parse(String(init.body)));
        return jsonResponse({ ok: true });
      }
      if (String(input) === "/api/roles") {
        return jsonResponse({
          roles: [
            { id: "administrator", name: "Administrator", builtIn: true },
            { id: "subscriber", name: "Subscriber", builtIn: true },
            { id: "customer", name: "Customer", builtIn: false, pluginId: "justflows.shop" },
            { id: "custom-1", name: "Custom", builtIn: false, pluginId: null },
          ],
          capabilities: [],
        });
      }
      return undefined;
    });
    const user = userEvent.setup();
    renderPage();

    const customer = await screen.findByRole("checkbox", { name: "Customer" });
    expect(screen.queryByRole("checkbox", { name: "Administrator" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Subscriber" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Custom" })).not.toBeInTheDocument();

    await user.click(customer);
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(calls).toEqual([{ displayName: "Member One", additionalRoles: ["customer"] }]));
  });
});

describe("EditUserPage as an editor", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows a read-only profile with no save, password, or danger-zone controls", async () => {
    mockFetch("editor");
    renderPage();

    await screen.findByDisplayValue("Member One");
    expect(screen.getByLabelText("Display name")).toBeDisabled();
    expect(screen.getByLabelText("Role")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset password" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove user" })).not.toBeInTheDocument();
    expect(screen.queryByText("Recent activity")).not.toBeInTheDocument();
  });
});

describe("EditUserPage detail sections", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows account data, authored content, capabilities and activity", async () => {
    mockFetch("administrator", (input) => {
      if (String(input) !== "/api/users/member-1") return undefined;
      return jsonResponse({
        user: {
          ...USER,
          updated_at: "2026-02-01T00:00:00.000Z",
          twoFactorEnabled: true,
          effectiveCapabilities: ["content:read"],
          content: {
            total: 1,
            byStatus: { published: 1 },
            recent: [{ id: "post-1", type: "post", title: "Hello world", status: "published", updatedAt: "2026-02-01T00:00:00.000Z" }],
          },
          recentActivity: [{ id: "a1", occurredAt: "2026-02-01T00:00:00.000Z", action: "auth.login", outcome: "success", target: null, ip: "127.0.0.1" }],
        },
      });
    });
    renderPage();

    expect(await screen.findByText("member-1")).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Hello world" })).toHaveAttribute("href", "/admin/content/post-1");
    expect(screen.getByText("content:read")).toBeInTheDocument();
    expect(screen.getByText("auth.login")).toBeInTheDocument();
    expect(screen.getByText("127.0.0.1")).toBeInTheDocument();
  });
});
