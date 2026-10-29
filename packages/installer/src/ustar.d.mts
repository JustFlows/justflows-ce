export class UstarError extends Error {
  constructor(message: string);
}

export interface UstarLimits {
  maxExpandedBytes: number;
  maxFileCount: number;
  maxDecompressionRatio: number;
  maxParseMs: number;
}

export interface UstarEntry {
  path: string;
  kind: "file" | "dir";
  data: Buffer;
}

export function parseUstar(tar: Buffer, limits?: UstarLimits, startedAt?: number): UstarEntry[];

export function extractTarGz(archive: Buffer, dest: string, limits?: UstarLimits): Promise<void>;
