// SPDX-License-Identifier: MIT

import { CORE_WEBHOOK_EVENTS, listWebhookEventTypes } from "./webhooks.js";

/**
 * The platform event catalog exposed at `GET /api/manage/v1/events`. These are
 * the same event names a webhook endpoint subscribes to; every delivery is the
 * envelope `{ id, event, createdAt, data }`, and `data` follows the shape
 * described here. Plugin-registered event names are included without a schema.
 */

interface EventSchema {
  event: string;
  description: string;
  /** Shape of the delivery's `data` field. */
  data: Record<string, "string" | "string?" | "number" | "boolean" | "object">;
}

const CORE_EVENT_SCHEMAS: Record<string, Omit<EventSchema, "event">> = {
  "content.created": {
    description: "A content entry was created (as a draft).",
    data: { contentId: "string", siteId: "string", type: "string", translationGroupId: "string?" },
  },
  "content.updated": {
    description: "A content entry's live row changed.",
    data: { contentId: "string", siteId: "string", type: "string?" },
  },
  "content.published": {
    description: "A content entry became published.",
    data: { contentId: "string", siteId: "string", type: "string?" },
  },
  "content.unpublished": {
    description: "A published entry was returned to draft.",
    data: { contentId: "string", siteId: "string" },
  },
  "content.deleted": {
    description: "A content entry was moved to trash.",
    data: { contentId: "string", siteId: "string", type: "string?" },
  },
  "media.uploaded": {
    description: "A file was added to the media library.",
    data: { mediaId: "string", siteId: "string", url: "string", mimeType: "string" },
  },
  "media.deleted": {
    description: "A media item was moved to trash.",
    data: { mediaId: "string", siteId: "string" },
  },
  "user.created": { description: "A user account was created.", data: { userId: "string" } },
  "user.updated": { description: "A user account changed.", data: { userId: "string" } },
  "user.deleted": { description: "A user account was deleted.", data: { userId: "string" } },
  "auth.login": {
    description: "A user signed in.",
    data: { userId: "string", siteId: "string" },
  },
  "auth.logout": {
    description: "A user signed out.",
    data: { userId: "string", siteId: "string" },
  },
  "plugin.installed": { description: "A plugin was installed.", data: { pluginId: "string" } },
  "plugin.activated": { description: "A plugin was activated.", data: { pluginId: "string" } },
  "plugin.deactivated": { description: "A plugin was deactivated.", data: { pluginId: "string" } },
  "plugin.uninstalled": { description: "A plugin was removed.", data: { pluginId: "string" } },
  "theme.installed": { description: "A theme was installed.", data: { themeId: "string" } },
  "theme.activated": { description: "A theme was activated.", data: { themeId: "string" } },
  "core.updated": { description: "The Justflows core was updated.", data: { version: "string" } },
};

export async function listEventCatalog(): Promise<EventSchema[]> {
  const names = await listWebhookEventTypes();
  const core = new Set<string>(CORE_WEBHOOK_EVENTS);
  return names.map((event) => {
    const known = CORE_EVENT_SCHEMAS[event];
    if (known) return { event, ...known };
    return {
      event,
      description: core.has(event) ? "Core platform event." : "Registered by an active plugin.",
      data: {},
    };
  });
}
