// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { coreBlocks } from "./index.js";

const image = coreBlocks.find((block) => block.type === "core.image")!;

describe("core.image sizing", () => {
  it("keeps older image blocks on automatic sizing", () => {
    expect(image.validateProps({ src: "/logo.png", alt: "Logo" })).toMatchObject({
      width: 0,
      height: 0,
      objectFit: "contain",
    });
  });

  it("renders bounded dimensions and an allowed fit mode", () => {
    const props = image.validateProps({
      src: "/logo.png",
      alt: "Logo",
      width: 320,
      height: 180,
      objectFit: "cover",
    });
    const html = image.render(props);

    expect(html).toContain("width:320px");
    expect(html).toContain("height:180px");
    expect(html).toContain("object-fit:cover");
  });

  it("rejects unsafe fit values and clamps dimensions", () => {
    expect(image.validateProps({ width: -1, height: 20000, objectFit: "none;position:fixed" })).toMatchObject({
      width: 0,
      height: 10000,
      objectFit: "contain",
    });
  });
});
