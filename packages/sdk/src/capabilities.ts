/**
 * User capability definitions — stable public API.
 * Code should always check capabilities, never role names directly.
 */

export const USER_CAPABILITIES = [
  "content:read",
  "content:create",
  "content:update",
  "content:delete",
  "content:publish",
  "media:read",
  "media:upload",
  "media:delete",
  "comments:moderate",
  "users:read",
  "users:manage",
  "plugins:read",
  "plugins:install",
  "plugins:activate",
  "plugins:delete",
  "themes:read",
  "themes:install",
  "themes:activate",
  "themes:delete",
  "settings:read",
  "settings:manage",
  "updates:manage",
  "site:admin",
] as const;

export type UserCapability = (typeof USER_CAPABILITIES)[number];

export const ROLE_CAPABILITIES: Record<string, UserCapability[]> = {
  administrator: [...USER_CAPABILITIES],
  editor: [
    "content:read",
    "content:create",
    "content:update",
    "content:delete",
    "content:publish",
    "media:read",
    "media:upload",
    "media:delete",
    "comments:moderate",
    "users:read",
  ],
  author: [
    "content:read",
    "content:create",
    "content:update",
    "media:read",
    "media:upload",
  ],
  contributor: ["content:read", "content:create"],
  subscriber: ["content:read"],
};

export function roleHasCapability(role: string, capability: UserCapability): boolean {
  return ROLE_CAPABILITIES[role]?.includes(capability) ?? false;
}
