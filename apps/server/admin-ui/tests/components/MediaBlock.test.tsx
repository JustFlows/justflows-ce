// SPDX-License-Identifier: MIT
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import MediaBlock from "../../src/components/MediaBlock";
import { I18nProvider } from "../../src/i18n/I18nProvider";

function mount(type: string, props: Record<string, unknown>, preview = false) {
  return render(<I18nProvider><MediaBlock type={type} props={props} preview={preview} /></I18nProvider>);
}

describe("media block previews", () => {
  it("shows video controls without autoplay in the builder and preserves public settings", () => {
    const props = { src: "/video.mp4", poster: "/poster.jpg", autoplay: true, controls: false, muted: true };
    const { container, rerender } = mount("core.video", props, true);
    expect(container.querySelector("video")).toHaveAttribute("controls");
    expect(container.querySelector("video")).not.toHaveAttribute("autoplay");
    expect(container.querySelector("video")).toHaveAttribute("poster", "/poster.jpg");
    rerender(<I18nProvider><MediaBlock type="core.video" props={props} /></I18nProvider>);
    expect(container.querySelector("video")).toHaveAttribute("autoplay");
    expect(container.querySelector("video")).not.toHaveAttribute("controls");
  });

  it("renders audio and escapes file labels", () => {
    const { container, rerender } = mount("core.audio", { src: "/audio.mp3" }, true);
    expect(container.querySelector("audio")).toHaveAttribute("src", "/audio.mp3");
    rerender(<I18nProvider><MediaBlock type="core.file" props={{ src: "/document.pdf", label: "<Document>" }} /></I18nProvider>);
    expect(screen.getByRole("link", { name: "<Document>" })).toHaveAttribute("download");
    expect(container.querySelector("document")).toBeNull();
  });

  it("shows a useful placeholder for missing or unsafe URLs", () => {
    const { container } = mount("core.video", { src: "javascript:alert(1)" }, true);
    expect(screen.getByText("Add a media URL in the block settings.")).toBeInTheDocument();
    expect(container.querySelector("video")).toBeNull();
  });
});
