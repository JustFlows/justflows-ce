import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "@components/SessionProvider";
import EditUserPage from "../admin/EditUserPage";

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
    expect(calls[0]).toEqual({
      path: "/api/users/member-1",
      body: { displayName: "New Name", role: "editor" },
    });
    expect(await screen.findByText("User updated.")).toBeInTheDocument();
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
  });
});
