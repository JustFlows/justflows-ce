// SPDX-License-Identifier: MIT

import { createHash, createHmac } from "node:crypto";

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | undefined;
}

export interface SigV4Request {
  method: string;
  url: URL;
  /** Headers to sign. `host`, `x-amz-date` and `x-amz-content-sha256` are added. */
  headers?: Record<string, string> | undefined;
  /** Hex SHA-256 of the body; defaults to the hash of an empty body. */
  payloadHash?: string | undefined;
  region: string;
  service?: string | undefined;
  /** Signing time; defaults to now. */
  date?: Date | undefined;
}

export const EMPTY_PAYLOAD_HASH = sha256Hex("");

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** RFC 3986 encoding as SigV4 requires: only unreserved characters stay literal. */
export function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Encode an object key for a URL path, keeping "/" separators. */
export function encodeKeyPath(key: string): string {
  return key.split("/").map(uriEncode).join("/");
}

function amzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function canonicalQuery(url: URL): string {
  const pairs: Array<[string, string]> = [];
  url.searchParams.forEach((value, key) => pairs.push([uriEncode(key), uriEncode(value)]));
  pairs.sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

/**
 * AWS Signature Version 4 for a single request. Returns the headers to send:
 * every signed header plus `authorization`. The URL path must already be
 * encoded (see {@link encodeKeyPath}); S3 does not double-encode it.
 */
export function signV4(req: SigV4Request, creds: SigV4Credentials): Record<string, string> {
  const service = req.service ?? "s3";
  const stamp = amzDate(req.date ?? new Date());
  const day = stamp.slice(0, 8);
  const payloadHash = req.payloadHash ?? EMPTY_PAYLOAD_HASH;

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers ?? {})) {
    headers[name.toLowerCase()] = String(value).trim().replace(/\s+/g, " ");
  }
  headers["host"] = req.url.host;
  headers["x-amz-date"] = stamp;
  headers["x-amz-content-sha256"] = payloadHash;
  if (creds.sessionToken) headers["x-amz-security-token"] = creds.sessionToken;

  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(";");
  const canonicalRequest = [
    req.method.toUpperCase(),
    req.url.pathname || "/",
    canonicalQuery(req.url),
    names.map((n) => `${n}:${headers[n]}\n`).join(""),
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${day}/${req.region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${creds.secretAccessKey}`, day), req.region), service),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  return {
    ...headers,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
