import { describe, expect, it } from "vitest";
import { cssColorToHex, firstCssColor } from "./computed-block-values";

describe("cssColorToHex", () => {
  it("turns computed RGB colors into color-input values", () => {
    expect(cssColorToHex("rgb(37, 99, 235)")).toBe("#2563eb");
    expect(cssColorToHex("rgba(15, 23, 42, 1)")).toBe("#0f172a");
  });

  it("finds a representative swatch color in a computed gradient", () => {
    expect(firstCssColor("linear-gradient(160deg, rgb(248, 250, 252), rgb(239, 246, 255))")).toBe(
      "#f8fafc",
    );
  });

  it("keeps transparent and unsupported values unset", () => {
    expect(cssColorToHex("rgba(0, 0, 0, 0)")).toBe("");
    expect(cssColorToHex("linear-gradient(red, blue)")).toBe("");
  });
});
