// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { signV4 } from "../../../src/adapters/sigv4.js";

// Worked example from the AWS S3 docs ("GET Object", Signature Version 4,
// header-based authentication).
describe("signV4", () => {
  it("matches the AWS S3 GET Object example", () => {
    const headers = signV4(
      {
        method: "GET",
        url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
        headers: { range: "bytes=0-9" },
        region: "us-east-1",
        date: new Date("2013-05-24T00:00:00Z"),
      },
      {
        accessKeyId: "AKIAIOSFODNN7EXAMPLE", // scan-secrets:allow (fixture)
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      },
    );
    expect(headers["authorization"]).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " + // scan-secrets:allow (fixture)
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
        "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });
});
