// SPDX-License-Identifier: MIT

/** Last-mile protection shared by MCP and the assistant, including plugin output.
 * This is defense in depth, not a sandbox for installed server-side plugins.
 */
export const REDACTED = "[REDACTED: security-sensitive data]";

export function sensitiveName(name: string): boolean {
  const normalized = name.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return (
    /password|passwd|secret|token|credential|privatekey|apikey|authorization|cookie|session|connectionstring|databaseurl|dsn|encryptionkey|signingkey|recoverycode|backupcode|totp|mfa|smtpuser|smtppass|accesskey/.test(
      normalized,
    ) ||
    normalized === "env" ||
    normalized === "environment"
  );
}

export function safeAgentText(text: string): string {
  // Refuse complete blobs rather than trying to preserve pieces of an env file,
  // private key, credential URL, authorization header, or serialized secret.
  if (
    /(?:^|[\\/\s"'])\.env(?:[.\s"'\\/]|$)/i.test(text) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.\-]+|\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i.test(
      text,
    ) ||
    /(?:^|[\n\r{,;])\s*(?:export\s+)?["']?[\w.-]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API[_-]?KEY|PRIVATE[_-]?KEY|CREDENTIAL|DATABASE[_-]?URL|SMTP[_-]?PASS)[\w.-]*["']?\s*[:=]\s*\S/i.test(
      text,
    ) ||
    /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/.test(
      text,
    )
  )
    return REDACTED;
  // Catch known installation secrets even when embedded in an innocently named field.
  for (const [name, value] of Object.entries(process.env)) {
    if (sensitiveName(name) && value && value.length >= 8 && text.includes(value)) return REDACTED;
  }
  return text;
}

/** Normalize first: toJSON, Buffers and exotic objects must not bypass inspection.
 * Unserializable/oversized output fails closed, never falling back to raw text.
 */
export function safeAgentData(value: unknown): unknown {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return null;
    if (serialized.length > 8 * 1024 * 1024) return REDACTED;
    const visit = (node: unknown, depth: number): unknown => {
      if (depth > 64) return REDACTED;
      if (typeof node === "string") {
        // Plugin handlers sometimes return JSON as a string.
        try {
          const parsed: unknown = JSON.parse(node);
          if (parsed && typeof parsed === "object") return JSON.stringify(visit(parsed, depth + 1));
        } catch {
          /* Ordinary text. */
        }
        return safeAgentText(node);
      }
      if (Array.isArray(node)) return node.map((item) => visit(item, depth + 1));
      if (node && typeof node === "object") {
        const record = node as Record<string, unknown>;
        if (record.type === "Buffer") return REDACTED;
        // Settings rows: { key/name: "smtp_password", value: "..." }.
        if (
          [record.key, record.name, record.setting_key].some(
            (name) => typeof name === "string" && sensitiveName(name),
          )
        )
          return REDACTED;
        return Object.fromEntries(
          Object.entries(record).map(([key, item]) => [
            key,
            sensitiveName(key) ? REDACTED : visit(item, depth + 1),
          ]),
        );
      }
      return node;
    };
    return visit(JSON.parse(serialized), 0);
  } catch {
    return REDACTED;
  }
}
