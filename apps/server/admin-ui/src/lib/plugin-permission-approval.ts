// SPDX-License-Identifier: MIT

interface ApprovalRequest {
  code?: string;
  name?: string;
  permissions?: unknown;
}

type Send = (approvedPermissions: string[] | undefined, signal: AbortSignal) => Promise<Response>;
type Confirm = (name: string, permissions: string[]) => boolean;

async function requestedPermissions(res: Response): Promise<{ name: string; permissions: string[] } | null> {
  if (res.status !== 409) return null;
  const body = (await res.clone().json().catch(() => null)) as ApprovalRequest | null;
  if (body?.code !== "permission_approval_required" || !Array.isArray(body.permissions)) return null;
  return { name: body.name ?? "", permissions: body.permissions.map(String) };
}

/**
 * Send a plugin install or update, asking once if it adds permissions.
 *
 * The server refuses the package until the administrator approves. Each attempt
 * gets its own timeout, so time spent reading the dialog does not abort the
 * retry. A declined approval returns the refusal for the caller to show.
 */
export async function sendWithPermissionApproval(
  send: Send,
  confirmApproval: Confirm,
  timeoutMs: number,
): Promise<Response> {
  const attempt = async (approved?: string[]): Promise<Response> => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await send(approved, controller.signal);
    } finally {
      window.clearTimeout(timer);
    }
  };

  const first = await attempt();
  const request = await requestedPermissions(first);
  if (!request || !confirmApproval(request.name, request.permissions)) return first;
  return attempt(request.permissions);
}
