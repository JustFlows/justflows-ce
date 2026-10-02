// SPDX-License-Identifier: MIT
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NoticeFocus from "../../src/components/NoticeFocus";

const scroll = vi.fn();
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  HTMLElement.prototype.scrollIntoView = scroll;
  scroll.mockClear();
});
afterEach(() => vi.unstubAllGlobals());
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 30)));

describe("shared notice focus", () => {
  it("focuses and reveals a newly created key without losing its copy button", async () => {
    const view = render(<><NoticeFocus /><button>Create</button></>);
    view.rerender(<><NoticeFocus /><button>Create</button><div className="jf-alert jf-alert--success">Copy this key now <button>Copy</button></div></>);
    const notice = screen.getByText("Copy this key now");
    await waitFor(() => expect(notice).toHaveFocus());
    expect(notice).toHaveAttribute("tabindex", "-1");
    expect(scroll).toHaveBeenCalledWith({ block: "center", inline: "nearest", behavior: "instant" });
    screen.getByText("Copy").focus();
    view.rerender(<><NoticeFocus /><button>Create</button><div className="jf-alert jf-alert--success">Copy this key now <button>Copied</button></div></>);
    await settle();
    expect(screen.getByText("Copied")).toHaveFocus();
  });

  it("focuses updated text and severity, but not unchanged notices on unrelated renders", async () => {
    const page = (text: string, error = false) => <><NoticeFocus /><button>Save</button><p className={`jf-status--${error ? "error" : "saved"}`}>{text}</p></>;
    const view = render(page("Saved"));
    screen.getByText("Save").focus();
    view.rerender(page("Failed", true));
    await waitFor(() => expect(screen.getByText("Failed")).toHaveFocus());
    screen.getByText("Save").focus();
    view.rerender(page("Failed", true));
    await settle();
    expect(screen.getByText("Save")).toHaveFocus();
    view.rerender(page("Failed"));
    await waitFor(() => expect(screen.getByText("Failed")).toHaveFocus());
  });

  it("prioritizes errors when several notices appear together", async () => {
    const view = render(<NoticeFocus />);
    view.rerender(<><NoticeFocus /><p className="jf-alert">Information</p><p role="alert">Failed</p></>);
    await waitFor(() => expect(screen.getByText("Failed")).toHaveFocus());
  });

  it("ignores initial banners, progress, hidden notices and opted-out background updates", async () => {
    const view = render(<><NoticeFocus /><button>Editing</button><p className="jf-alert">Explanation</p></>);
    screen.getByText("Editing").focus();
    view.rerender(<><NoticeFocus /><button>Editing</button><p className="jf-alert">Explanation</p><p role="status">Loading</p><p className="jf-status--dirty">Unsaved</p><p hidden role="alert">Hidden</p><div data-notice-focus="false"><p className="jf-status--saved">Autosaved</p></div></>);
    await settle();
    expect(screen.getByText("Editing")).toHaveFocus();
    expect(scroll).not.toHaveBeenCalled();
  });

  it("focuses a notice when it becomes visible", async () => {
    const view = render(<><NoticeFocus /><p hidden role="alert">Failed</p></>);
    view.rerender(<><NoticeFocus /><p role="alert">Failed</p></>);
    await waitFor(() => expect(screen.getByText("Failed")).toHaveFocus());
  });

  it("keeps focus in a modal and focuses its own notices", async () => {
    const page = (error: boolean, modalError: boolean) => <><NoticeFocus />{error && <p role="alert">Background failure</p>}<div role="dialog" aria-modal="true"><button>Dialog action</button>{modalError && <p role="alert">Dialog failure</p>}</div></>;
    const view = render(page(false, false));
    screen.getByText("Dialog action").focus();
    view.rerender(page(true, false));
    await settle();
    expect(screen.getByText("Dialog action")).toHaveFocus();
    view.rerender(page(true, true));
    await waitFor(() => expect(screen.getByText("Dialog failure")).toHaveFocus());
  });

  it("covers full-screen editor feedback and custom notices", async () => {
    const view = render(<NoticeFocus />);
    view.rerender(<><NoticeFocus /><span className="jf-editor__status--ok">Editor saved</span></>);
    await waitFor(() => expect(screen.getByText("Editor saved")).toHaveFocus());
    view.rerender(<><NoticeFocus /><p role="status" data-notice-focus="true">Scheduled</p></>);
    await waitFor(() => expect(screen.getByText("Scheduled")).toHaveFocus());
  });

  it("disconnects on unmount", async () => {
    const view = render(<NoticeFocus />);
    view.unmount();
    render(<p role="alert">Later</p>);
    await settle();
    expect(scroll).not.toHaveBeenCalled();
  });
});
