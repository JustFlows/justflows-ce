// SPDX-License-Identifier: MIT
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { MemoryRouter, StaticRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { Link, NavLink, Navigate, useNavigate } from "./admin-router";
import { publicAdminPath } from "./admin-path";
import { setAdminSsrPayload } from "./ssr-data";

function configure(adminBasePath: string) {
  setAdminSsrPayload({ adminBasePath, url: adminBasePath, locale: "en", responses: {} });
}
afterEach(() => setAdminSsrPayload(null));

function Location() {
  const location = useLocation();
  return (
    <output>
      {location.pathname}
      {location.search}
      {location.hash}
    </output>
  );
}

describe("custom admin navigation", () => {
  it.each(["/admin", "/admin-test", "/private/dashboard", "/admin/private"])(
    "renders real links under %s on the server",
    (base) => {
      configure(base);
      const html = renderToString(
        <StaticRouter location={base}>
          <Link to="/admin/content/post-id?locale=nl#edit" target="_blank">
            Post
          </Link>
          <Link to={{ pathname: "/admin/content-types", search: "?type=post" }}>Types</Link>
        </StaticRouter>,
      );
      expect(html).toContain(`href="${base}/content/post-id?locale=nl#edit"`);
      expect(html).toContain(`href="${base}/content-types?type=post"`);
    },
  );

  it("uses custom URLs for active links and client navigation", () => {
    configure("/admin-test");
    render(
      <MemoryRouter initialEntries={["/admin-test/content"]}>
        <NavLink to="/admin/content">Content</NavLink>
        <Link to="/admin/content/post-id?locale=nl#edit">Post</Link>
        <Location />
      </MemoryRouter>,
    );
    expect(screen.getByText("Content")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Post")).toHaveAttribute(
      "href",
      "/admin-test/content/post-id?locale=nl#edit",
    );
    fireEvent.click(screen.getByText("Post"));
    expect(screen.getByRole("status")).toHaveTextContent(
      "/admin-test/content/post-id?locale=nl#edit",
    );
  });

  it("maps imperative navigation and supports history back", () => {
    configure("/admin-test");
    function Controls() {
      const navigate = useNavigate();
      return (
        <>
          <button onClick={() => navigate({ pathname: "/admin/users", search: "?page=2" })}>
            Go
          </button>
          <button onClick={() => navigate(-1)}>Back</button>
          <Location />
        </>
      );
    }
    render(
      <MemoryRouter initialEntries={["/admin-test"]}>
        <Controls />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Go"));
    expect(screen.getByRole("status")).toHaveTextContent("/admin-test/users?page=2");
    fireEvent.click(screen.getByText("Back"));
    expect(screen.getByRole("status").textContent).toBe("/admin-test");
  });

  it("maps declarative redirects", () => {
    configure("/admin-test");
    render(
      <MemoryRouter initialEntries={["/admin-test/content"]}>
        <Navigate to="/admin" replace />
        <Location />
      </MemoryRouter>,
    );
    expect(screen.getByRole("status").textContent).toBe("/admin-test");
  });

  it("preserves non-admin URLs and maps root queries and hashes", () => {
    configure("/admin-test");
    for (const path of [
      "/administrator",
      "/api/content",
      "/login",
      "../content",
      "?page=2",
      "https://example.com/admin",
      "/admin-test/content",
    ]) {
      expect(publicAdminPath(path)).toBe(path);
    }
    expect(publicAdminPath("/admin?saved=1")).toBe("/admin-test?saved=1");
    expect(publicAdminPath("/admin#content")).toBe("/admin-test#content");
    configure("//example.com");
    expect(publicAdminPath("/admin/content")).toBe("/admin/content");
  });
});
