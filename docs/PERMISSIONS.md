# Permissions and capabilities

Two different lists.

## Plugin permissions (manifest)

Declared on the plugin. Core uses them to decide which APIs `PluginContext`
exposes. Sensitive permissions are called out in Admin:

- `network:outbound`
- `users:manage`
- `settings:manage`
- `auth:hook`

The full enum is `PluginPermissionSchema` in `packages/sdk/src/plugin.ts`:
content/media/users/settings CRUD, `admin:extend`, `jobs:register`,
`auth:hook`, `network:outbound`.

`content:create` is required for `ctx.content.ensureType` and `ensurePage`.
Publishing a page also requires `content:publish`. Deleting a type and its
entries (`ctx.content.deleteType`) requires `content:delete`.

UI gating is not a security boundary. Server routes still check the signed-in
user.

## User capabilities (roles)

Administrators, editors, authors, and so on get capabilities from
`packages/sdk/src/capabilities.ts`. Check capabilities in server code; do not
hard-code role names.

Sites may also create custom roles through Admin → Users. A user's effective
access is resolved in this order:

1. capabilities from the selected built-in or custom role;
2. optional per-user grants;
3. explicit per-user denies (a deny always wins);
4. resource scopes for site, content type, locale, and ownership.

Use `requireCapability()` at HTTP boundaries and `userCan()` where the resource
is loaded inside a handler. Pass the resource's `siteId`, `contentType`,
`locale`, and `ownerId` so scoped grants are enforceable server-side. Hiding a
button in Admin is only a convenience.

Plugin HTTP handlers receive `session.capabilities` and `session.scopes` as a
read-only preview of the host-resolved policy. Plugins must still declare their
own manifest permissions; user access never expands a plugin's sandbox.

## Plugin-defined user capabilities

Core contains only platform capabilities. A plugin registers its own domains
while activating; inactive or uninstalled plugins therefore do not leave
irrelevant choices in the role editor:

```ts
async activate(ctx) {
  ctx.capabilities.register({
    id: "orders:refund",
    label: "Refund orders",
    group: "Orders",
    description: "Issue full or partial refunds",
    defaultRoles: ["administrator"],
  });
}
```

Identifiers use lower-case `domain:action` syntax. A plugin cannot replace a
core capability or another plugin's registration. Registrations are removed
automatically on deactivation. Stored custom roles keep their raw identifiers,
but an inactive capability is neither shown as assignable nor included in
effective access until its owning plugin registers it again.

A plugin that contributes an admin page still runs in the signed-in user's
session. An author without `plugins:install` cannot upload packages even if a
plugin UI looks like it could.
