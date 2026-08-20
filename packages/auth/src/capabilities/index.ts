import { ROLE_CAPABILITIES, type UserCapability } from "@justflows/sdk";

export interface Actor {
  userId: string;
  siteId: string;
  role: string;
  /** Extra capabilities granted individually */
  extraCapabilities?: UserCapability[];
}

/**
 * Check whether an actor has a capability.
 * Always checks capabilities, never role names directly.
 */
export function can(actor: Actor, capability: UserCapability): boolean {
  const roleCaps = ROLE_CAPABILITIES[actor.role] ?? [];
  if (roleCaps.includes(capability)) return true;
  return actor.extraCapabilities?.includes(capability) ?? false;
}

export function requireCan(actor: Actor, capability: UserCapability): void {
  if (!can(actor, capability)) {
    throw new AuthorizationError(`Missing capability: ${capability}`);
  }
}

export class AuthorizationError extends Error {
  readonly code = "UNAUTHORIZED";
  constructor(message: string) {
    super(message);
    this.name = "AuthorizationError";
  }
}
