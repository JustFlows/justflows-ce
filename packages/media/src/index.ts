// SPDX-License-Identifier: MIT

export { MediaService } from "./media-service.js";
export type { MediaItem, UploadOptions } from "./media-service.js";
export { LocalStorageAdapter } from "./adapters/local-adapter.js";
export { S3StorageAdapter } from "./adapters/s3-adapter.js";
export type { StorageAdapter, StoredObject } from "./adapters/storage-adapter.js";
export type { LocalAdapterOptions } from "./adapters/local-adapter.js";
export type { S3AdapterOptions, S3ObjectResponse } from "./adapters/s3-adapter.js";
export { signV4, sha256Hex, uriEncode, encodeKeyPath } from "./adapters/sigv4.js";
export type { SigV4Credentials, SigV4Request } from "./adapters/sigv4.js";
export {
  generateDerivatives,
  extractImageMetadata,
  validateUpload,
  DEFAULT_DERIVATIVES,
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
} from "./derivatives/image-processor.js";
export {
  generateResponsiveSet,
  effectiveWidths,
  clampFocal,
  isRasterImageMimeType,
  formatMimeType,
  formatExtension,
  DEFAULT_RESPONSIVE_CONFIG,
  CENTER_FOCAL,
  RASTER_IMAGE_MIME_TYPES,
} from "./derivatives/responsive.js";
export type {
  OutputFormat,
  ResponsiveImageConfig,
  FocalPoint,
  GeneratedVariant,
  SourceInfo,
  ResponsiveSet,
} from "./derivatives/responsive.js";
