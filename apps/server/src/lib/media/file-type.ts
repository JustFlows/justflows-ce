// SPDX-License-Identifier: MIT

/**
 * Magic-byte checks for the media types the library accepts.
 *
 * multer reports `file.mimetype` straight from the client's own Content-Type
 * part header, so it is a claim, not a fact. Without a content check, arbitrary
 * bytes can be stored under an image extension. `nosniff` keeps the browser from
 * reinterpreting them, but the library should not hold mislabelled files at all.
 */

type Check = (buf: Buffer) => boolean;

const startsWith = (...bytes: number[]): Check =>
  (buf) => bytes.every((b, i) => buf[i] === b);

const ascii = (text: string, offset = 0): Check =>
  (buf) => buf.subarray(offset, offset + text.length).toString("latin1") === text;

const all = (...checks: Check[]): Check => (buf) => checks.every((c) => c(buf));
const any = (...checks: Check[]): Check => (buf) => checks.some((c) => c(buf));

/** RIFF containers: "RIFF" then a four-byte size then the form type. */
const riff = (form: string): Check => all(ascii("RIFF"), ascii(form, 8));

/** ISO base media (MP4 and friends): "ftyp" at offset 4. */
const isoBmff: Check = ascii("ftyp", 4);

const SIGNATURES: Record<string, Check> = {
  "image/jpeg": startsWith(0xff, 0xd8, 0xff),
  "image/png": startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
  "image/gif": any(ascii("GIF87a"), ascii("GIF89a")),
  "image/webp": riff("WEBP"),
  "image/avif": isoBmff,
  "image/x-icon": startsWith(0x00, 0x00, 0x01, 0x00),
  "image/vnd.microsoft.icon": startsWith(0x00, 0x00, 0x01, 0x00),
  "image/ico": startsWith(0x00, 0x00, 0x01, 0x00),
  "application/pdf": ascii("%PDF-"),
  "video/mp4": isoBmff,
  // Matroska/WebM EBML header.
  "video/webm": startsWith(0x1a, 0x45, 0xdf, 0xa3),
  // MP3 with an ID3 tag, or a bare MPEG audio frame sync.
  "audio/mpeg": any(ascii("ID3"), (buf) => buf[0] === 0xff && (buf[1] ?? 0) >= 0xe0),
  "audio/ogg": ascii("OggS"),
};

export function isKnownMediaType(mimeType: string): boolean {
  return mimeType in SIGNATURES;
}

/** True when the bytes match what the declared MIME type promises. */
export function contentMatchesMimeType(buffer: Buffer, mimeType: string): boolean {
  const check = SIGNATURES[mimeType];
  if (!check) return false;
  if (buffer.length < 12) return false;
  return check(buffer);
}
