import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
      <Routes>
        <Route path="/admin/users/:id" element={<EditUserPage />} />
        <Route path="/admin/users" element={<div>Users list</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("EditUserPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads the user into the form", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ user: USER })));
    renderPage();

    expect(await screen.findByDisplayValue("Member One")).toBeInTheDocument();
    expect(screen.getByDisplayValue("member@example.com")).toBeInTheDocument();
    expect(screen.getByLabelText("Role")).toHaveValue("subscriber");
  });

  it("saves display name and role changes", async () => {
    const calls: Array<{ path: string; body?: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (init?.method === "PATCH") {
          calls.push({ path, body: init.body ? JSON.parse(String(init.body)) : undefined });
          return jsonResponse({ ok: true });
        }
        return jsonResponse({ user: USER });
      }),
    );
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
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "DELETE") return jsonResponse({ ok: true });
        return jsonResponse({ user: USER });
      }),
    );
    vi.stubGlobal("confirm", vi.fn(() => true));
    const user = userEvent.setup();
    renderPage();

    await screen.findByDisplayValue("Member One");
    await user.click(screen.getByRole("button", { name: "Remove user" }));

    expect(await screen.findByText("Users list")).toBeInTheDocument();
  });

  it("shows the server's error when removal is blocked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          return jsonResponse({ error: "Cannot delete the last administrator" }, 400);
        }
        return jsonResponse({ user: { ...USER, role: "administrator" } });
      }),
    );
    vi.stubGlobal("confirm", vi.fn(() => true));
    const user = userEvent.setup();
    renderPage();

    await screen.findByDisplayValue("Member One");
    await user.click(screen.getByRole("button", { name: "Remove user" }));

    expect(await screen.findByText("Cannot delete the last administrator")).toBeInTheDocument();
  });
});
