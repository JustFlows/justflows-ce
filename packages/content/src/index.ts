// SPDX-License-Identifier: MIT

export { ContentService, NotFoundError, ConflictError } from "./service/content-service.js";
export { slugify, uniqueSlug } from "./service/slugify.js";
export type {
  ContentItem,
  ContentRevision,
  CreateContentInput,
  UpdateContentInput,
  ContentQuery,
  ContentPage,
  BlockDocument,
  BlockNode,
  ContentStatus,
} from "./service/types.js";
export {
  BUILTIN_CONTENT_TYPES,
  BUILTIN_CONTENT_TYPE_SLUGS,
  CONTENT_TYPE_FIELD_KINDS,
  ContentFieldDefinitionSchema,
  ContentFieldKeySchema,
  ContentTypeFieldsSchema,
  ContentTypeSlugSchema,
  RESERVED_FIELD_KEYS,
  isBuiltinContentTypeSlug,
  normalizeContentTypeSlug,
} from "./service/content-types.js";
export type {
  BuiltinContentTypeSlug,
  ContentFieldDefinition,
  ContentFieldKind,
} from "./service/content-types.js";

