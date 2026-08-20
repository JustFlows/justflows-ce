// SPDX-License-Identifier: MIT

export { MediaService } from "./media-service.js";
export type { MediaItem, UploadOptions } from "./media-service.js";
export { LocalStorageAdapter } from "./adapters/local-adapter.js";
export { S3StorageAdapter } from "./adapters/s3-adapter.js";
export type { StorageAdapter } from "./adapters/storage-adapter.js";
export type { LocalAdapterOptions } from "./adapters/local-adapter.js";
export type { S3AdapterOptions } from "./adapters/s3-adapter.js";
export {
  generateDerivatives,
  extractImageMetadata,
  validateUpload,
  DEFAULT_DERIVATIVES,
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
} from "./derivatives/image-processor.js";
