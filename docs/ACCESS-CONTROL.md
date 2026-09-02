# Access control

Justflows authorizes actions by capability, never by a role name at a new
security boundary. Built-in roles remain available, while administrators can
create site-local roles and add per-user grants, explicit denies, and content
resource scopes in Admin → Users.

## Resolution

The server calculates effective access from the selected role, then adds user
grants, removes user denies, and finally evaluates the capability's resource
scope. A deny always wins. Supported scope dimensions are site, content type,
locale, and ownership (`self` or `any`). Empty dimensions are unrestricted.

An administrator cannot edit their own access policy. The last built-in
administrator guard remains active, and every role or user-policy change is
written to the audit log and invalidates the affected user's existing cookies.

## Server API

- `GET /api/roles` lists built-in/custom roles and the capability catalog.
- `POST /api/roles` creates a custom role.
- `PATCH /api/roles/:id` edits a custom role.
- `DELETE /api/roles/:id` deletes an unassigned custom role.
- `GET /api/users/:id` includes `roleId`, `accessPolicy`, and
  `effectiveCapabilities`.
- `PATCH /api/users/:id` accepts `roleId`, `grants`, `denies`, and `scopes`.

Role mutations require `users:manage`; reads require `users:read`. Plugins see
the resolved preview as `PluginHttpRequest.session.capabilities` and `.scopes`.
The host remains the enforcement boundary.

## Device sessions

Every new login or registration receives a database-backed device session.
Account Security lists active devices and identifies the current one. A user
can revoke one other device or all other devices; normal logout revokes only
the current device. Password changes and administrator resets still invalidate
all previously issued cookies.

Legacy cookies without a device-session id remain supported until they expire;
logging out such a cookie uses account-wide revocation because it cannot be
identified individually.
