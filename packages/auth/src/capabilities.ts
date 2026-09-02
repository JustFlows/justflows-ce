import {
  ROLE_CAPABILITIES,
  effectiveCapabilities,
  scopeAllows,
  type AccessPolicy,
  type AccessResource,
  type UserCapability,
} from "@justflows/sdk";

export interface Actor {
  userId: string;
  siteId: string;
  role: string;
  /** Extra capabilities granted individually */
  extraCapabilities?: UserCapability[];
  roleCapabilities?: UserCapability[];
  accessPolicy?: AccessPolicy;
}

/**
 * Check whether an actor has a capability.
 * Always checks capabilities, never role names directly.
 */
export function can(actor: Actor, capability: UserCapability): boolean {
  const policy: AccessPolicy = {
    ...actor.accessPolicy,
    grants: [...(actor.accessPolicy?.grants ?? []), ...(actor.extraCapabilities ?? [])],
  };
  return effectiveCapabilities(
    actor.roleCapabilities ?? ROLE_CAPABILITIES[actor.role] ?? [],
    policy,
  ).includes(capability);
}

export function canAccess(
  actor: Actor,
  capability: UserCapability,
  resource: AccessResource = {},
): boolean {
  return can(actor, capability) && scopeAllows(actor.accessPolicy?.scopes?.[capability], resource, actor.userId);
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
