import sharp from "sharp";

export interface ImageDerivative {
  name: string;
  width: number;
  height?: number;
  format: "webp" | "avif" | "jpeg";
  quality: number;
}

export const DEFAULT_DERIVATIVES: ImageDerivative[] = [
  { name: "thumbnail", width: 150, height: 150, format: "webp", quality: 80 },
  { name: "small", width: 400, format: "webp", quality: 82 },
  { name: "medium", width: 800, format: "webp", quality: 85 },
  { name: "large", width: 1600, format: "webp", quality: 87 },
];

export interface ProcessedDerivative {
  name: string;
  data: Buffer;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
}

export interface ImageMetadata {
  width: number;
  height: number;
  format: string;
  hasAlpha: boolean;
  sizeBytes: number;
}

export async function extractImageMetadata(data: Buffer): Promise<ImageMetadata> {
  const meta = await sharp(data).metadata();
  return {
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    format: meta.format ?? "unknown",
    hasAlpha: meta.hasAlpha ?? false,
    sizeBytes: data.byteLength,
  };
}

export async function generateDerivatives(
  source: Buffer,
  derivatives: ImageDerivative[] = DEFAULT_DERIVATIVES,
): Promise<ProcessedDerivative[]> {
  const results: ProcessedDerivative[] = [];

  for (const def of derivatives) {
    let pipeline = sharp(source).resize(def.width, def.height, {
      fit: def.height ? "cover" : "inside",
      withoutEnlargement: true,
    });

    let mimeType: string;
    if (def.format === "webp") {
      pipeline = pipeline.webp({ quality: def.quality });
      mimeType = "image/webp";
    } else if (def.format === "avif") {
      pipeline = pipeline.avif({ quality: def.quality });
      mimeType = "image/avif";
    } else {
      pipeline = pipeline.jpeg({ quality: def.quality });
      mimeType = "image/jpeg";
    }

    const data = await pipeline.toBuffer({ resolveWithObject: false });
    const meta = await sharp(data).metadata();

    results.push({
      name: def.name,
      data,
      mimeType,
      width: meta.width ?? def.width,
      height: meta.height ?? def.height ?? 0,
      sizeBytes: data.byteLength,
    });
  }

  return results;
}

export const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml",
  "application/pdf",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/ogg",
]);

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

export function validateUpload(data: Buffer, mimeType: string): void {
  if (data.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error(`File too large: max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
  }
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error(`File type not allowed: ${mimeType}`);
  }
}
