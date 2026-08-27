import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UsersPage from "../admin/UsersPage";

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

const USERS = [
  { id: "admin-1", email: "admin@example.com", username: "admin", display_name: "Admin One", role: "administrator", created_at: "2026-01-01T00:00:00.000Z" },
  { id: "member-1", email: "member@example.com", username: "member", display_name: "Member One", role: "subscriber", created_at: "2026-01-02T00:00:00.000Z" },
];

function mockFetch(onDelete?: (id: string) => void): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/users" && (!init || init.method === undefined)) {
        return jsonResponse({ users: USERS });
      }
      if (init?.method === "DELETE") {
        const id = path.split("/").pop()!;
        onDelete?.(id);
        return jsonResponse({ ok: true });
      }
      return jsonResponse({});
    }),
  );
}

describe("UsersPage", () => {
  beforeEach(() => mockFetch());
  afterEach(() => vi.unstubAllGlobals());

  it("shows Edit for every user and Remove only for non-administrators", async () => {
    render(
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>,
    );

    const adminRow = (await screen.findByText("Admin One")).closest("tr")!;
    expect(within(adminRow).getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/admin/users/admin-1");
    expect(within(adminRow).queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();

    const memberRow = screen.getByText("Member One").closest("tr")!;
    expect(within(memberRow).getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/admin/users/member-1");
    expect(within(memberRow).getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("does nothing when the removal is not confirmed", async () => {
    const onDelete = vi.fn();
    mockFetch(onDelete);
    vi.stubGlobal("confirm", vi.fn(() => false));
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>,
    );

    const memberRow = (await screen.findByText("Member One")).closest("tr")!;
    await user.click(within(memberRow).getByRole("button", { name: "Remove" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText("Member One")).toBeInTheDocument();
  });

  it("removes the row and shows a notice once confirmed", async () => {
    const onDelete = vi.fn();
    mockFetch(onDelete);
    vi.stubGlobal("confirm", vi.fn(() => true));
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>,
    );

    const memberRow = (await screen.findByText("Member One")).closest("tr")!;
    await user.click(within(memberRow).getByRole("button", { name: "Remove" }));

    expect(onDelete).toHaveBeenCalledWith("member-1");
    await waitFor(() => expect(screen.queryByText("Member One")).not.toBeInTheDocument());
    expect(screen.getByText("User removed.")).toBeInTheDocument();
  });
});
