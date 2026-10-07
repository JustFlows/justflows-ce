// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  missingSharpPackages,
  omittedSharpLockPackages,
  sharpNativePackageNames,
  sharpRuntimeId,
} from "../../../../../scripts/sharp-native.js";

const optional = {
  "@img/sharp-linux-x64": "0.35.5",
  "@img/sharp-libvips-linux-x64": "1.3.4",
  "@img/sharp-darwin-arm64": "0.35.5",
  "@img/sharp-libvips-darwin-arm64": "1.3.4",
};

describe("sharp native packages", () => {
  it("names the linux glibc packages for an x64 server", () => {
    expect(sharpRuntimeId("linux", "x64", false)).toBe("linux-x64");
    expect(sharpNativePackageNames("linux-x64")).toEqual([
      "@img/sharp-linux-x64",
      "@img/sharp-libvips-linux-x64",
    ]);
  });

  it("uses the musl packages on Alpine", () => {
    expect(sharpRuntimeId("linux", "x64", true)).toBe("linuxmusl-x64");
    expect(sharpNativePackageNames("linuxmusl-x64")[0]).toBe("@img/sharp-linuxmusl-x64");
  });

  it("installs a declared package only when that version is not on disk", () => {
    expect(missingSharpPackages(optional, "linux-x64", {})).toEqual([
      { name: "@img/sharp-linux-x64", version: "0.35.5", spec: "@img/sharp-linux-x64@0.35.5" },
      {
        name: "@img/sharp-libvips-linux-x64",
        version: "1.3.4",
        spec: "@img/sharp-libvips-linux-x64@1.3.4",
      },
    ]);
    expect(
      missingSharpPackages(optional, "linux-x64", {
        "@img/sharp-linux-x64": "0.35.5",
        "@img/sharp-libvips-linux-x64": "1.3.4",
      }),
    ).toEqual([]);
    expect(
      missingSharpPackages(optional, "linux-x64", {
        "@img/sharp-linux-x64": "0.34.0",
        "@img/sharp-libvips-linux-x64": "1.3.4",
      }),
    ).toEqual([
      { name: "@img/sharp-linux-x64", version: "0.35.5", spec: "@img/sharp-linux-x64@0.35.5" },
    ]);
  });

  it("reports platform packages that the lockfile names but does not resolve", () => {
    const packages = {
      "node_modules/sharp": { version: "0.35.5", optionalDependencies: optional },
      "node_modules/@img/colour": { version: "1.1.0" },
    };
    expect(omittedSharpLockPackages(packages).map((item) => item.name)).toEqual([
      "@img/sharp-linux-x64",
      "@img/sharp-libvips-linux-x64",
      "@img/sharp-darwin-arm64",
      "@img/sharp-libvips-darwin-arm64",
    ]);
  });

  it("accepts a lockfile that already resolved the platform packages", () => {
    const packages = {
      "node_modules/sharp": { version: "0.35.5", optionalDependencies: optional },
      "node_modules/@img/sharp-linux-x64": { version: "0.35.5" },
      "node_modules/@img/sharp-libvips-linux-x64": { version: "1.3.4" },
      "node_modules/@img/sharp-darwin-arm64": { version: "0.35.5" },
      "node_modules/@img/sharp-libvips-darwin-arm64": { version: "1.3.4" },
    };
    expect(omittedSharpLockPackages(packages)).toEqual([]);
  });
});
