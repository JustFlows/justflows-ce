// SPDX-License-Identifier: MIT

/**
 * The subset of CBOR (RFC 8949) that WebAuthn uses: unsigned and negative
 * integers, byte and text strings, arrays, maps, and the simple values
 * false/true/null. Floats, tags and indefinite lengths never appear in an
 * attestation object or a COSE key, so they are refused rather than guessed at.
 *
 * Input is untrusted. Every length is checked against the remaining bytes and
 * nesting is bounded, so a hostile authenticator response cannot make the
 * decoder read past its buffer or recurse without limit.
 */

export type CborValue =
  | number
  | bigint
  | string
  | boolean
  | null
  | Uint8Array
  | CborValue[]
  | Map<CborValue, CborValue>;

export class CborError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CborError";
  }
}

const MAX_DEPTH = 16;
const MAX_ITEMS = 4096;

/** Decode one item starting at `offset`. Returns the value and where it ended. */
export function decodeCborItem(bytes: Uint8Array, offset = 0): { value: CborValue; end: number } {
  let position = offset;
  let items = 0;

  const need = (count: number) => {
    if (count < 0 || position + count > bytes.length) throw new CborError("CBOR item is truncated");
  };

  const readLength = (info: number): number => {
    if (info < 24) return info;
    if (info === 24) { need(1); return bytes[position++]!; }
    if (info === 25) { need(2); const v = (bytes[position]! << 8) | bytes[position + 1]!; position += 2; return v; }
    if (info === 26) {
      need(4);
      const v = ((bytes[position]! << 24) >>> 0) + (bytes[position + 1]! << 16) + (bytes[position + 2]! << 8) + bytes[position + 3]!;
      position += 4;
      return v;
    }
    if (info === 27) {
      need(8);
      let v = 0n;
      for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(bytes[position + i]!);
      position += 8;
      if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new CborError("CBOR length or integer is too large");
      return Number(v);
    }
    throw new CborError("Indefinite or reserved CBOR lengths are not supported");
  };

  const read = (depth: number): CborValue => {
    if (depth > MAX_DEPTH) throw new CborError("CBOR nesting is too deep");
    if (++items > MAX_ITEMS) throw new CborError("CBOR item has too many elements");
    need(1);
    const initial = bytes[position++]!;
    const major = initial >> 5;
    const info = initial & 0x1f;
    switch (major) {
      case 0:
        return readLength(info);
      case 1:
        return -1 - readLength(info);
      case 2: {
        const length = readLength(info);
        need(length);
        const value = bytes.slice(position, position + length);
        position += length;
        return value;
      }
      case 3: {
        const length = readLength(info);
        need(length);
        const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(position, position + length));
        position += length;
        return value;
      }
      case 4: {
        const length = readLength(info);
        if (length > MAX_ITEMS) throw new CborError("CBOR array is too long");
        const out: CborValue[] = [];
        for (let i = 0; i < length; i++) out.push(read(depth + 1));
        return out;
      }
      case 5: {
        const length = readLength(info);
        if (length > MAX_ITEMS) throw new CborError("CBOR map is too long");
        const out = new Map<CborValue, CborValue>();
        for (let i = 0; i < length; i++) {
          const key = read(depth + 1);
          if (typeof key !== "number" && typeof key !== "string") throw new CborError("CBOR map keys must be integers or text");
          if (out.has(key)) throw new CborError("CBOR map has a duplicate key");
          out.set(key, read(depth + 1));
        }
        return out;
      }
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        throw new CborError("CBOR floats and other simple values are not supported");
      default:
        throw new CborError("CBOR tags are not supported");
    }
  };

  const value = read(0);
  return { value, end: position };
}

/** Decode a buffer that must contain exactly one CBOR item. */
export function decodeCbor(bytes: Uint8Array): CborValue {
  const { value, end } = decodeCborItem(bytes, 0);
  if (end !== bytes.length) throw new CborError("Unexpected bytes after the CBOR item");
  return value;
}

/** Encode the same subset. Used by tests to build authenticator responses. */
export function encodeCbor(value: CborValue): Uint8Array {
  const chunks: number[] = [];
  const head = (major: number, length: number) => {
    if (length < 24) chunks.push((major << 5) | length);
    else if (length < 0x100) chunks.push((major << 5) | 24, length);
    else if (length < 0x10000) chunks.push((major << 5) | 25, length >> 8, length & 0xff);
    else chunks.push((major << 5) | 26, (length >>> 24) & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff);
  };
  const write = (item: CborValue) => {
    if (item === false) chunks.push(0xf4);
    else if (item === true) chunks.push(0xf5);
    else if (item === null) chunks.push(0xf6);
    else if (typeof item === "number") {
      if (!Number.isInteger(item)) throw new CborError("Only integers can be encoded");
      if (item >= 0) head(0, item);
      else head(1, -1 - item);
    } else if (typeof item === "bigint") {
      throw new CborError("bigint encoding is not supported");
    } else if (typeof item === "string") {
      const encoded = new TextEncoder().encode(item);
      head(3, encoded.length);
      chunks.push(...encoded);
    } else if (item instanceof Uint8Array) {
      head(2, item.length);
      chunks.push(...item);
    } else if (Array.isArray(item)) {
      head(4, item.length);
      item.forEach(write);
    } else {
      head(5, item.size);
      for (const [key, entry] of item) { write(key); write(entry); }
    }
  };
  write(value);
  return Uint8Array.from(chunks);
}
