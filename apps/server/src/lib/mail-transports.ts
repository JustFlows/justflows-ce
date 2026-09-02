// SPDX-License-Identifier: MIT

export interface RegisteredMailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  envelopeSender?: string;
}

export interface RegisteredMailResult {
  response: string;
  messageId?: string;
  status?: "sent" | "deferred" | "failed" | "bounced";
}

export interface RegisteredMailTransport {
  id: string;
  label: string;
  send(message: RegisteredMailMessage): Promise<RegisteredMailResult>;
}

const transports = new Map<string, RegisteredMailTransport>();

export function registerMailTransport(
  owner: string,
  transport: RegisteredMailTransport,
): () => void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(transport.id)) {
    throw new Error("Mail transport id must be lowercase kebab-case");
  }
  if (!transport.label.trim() || transport.label.length > 80) {
    throw new Error("Mail transport label must contain 1–80 characters");
  }
  const key = `plugin:${owner}.${transport.id}`;
  if (transports.has(key)) throw new Error(`Mail transport "${key}" is already registered`);
  transports.set(key, transport);
  return () => transports.delete(key);
}

export function getRegisteredMailTransport(id: string): RegisteredMailTransport | undefined {
  return transports.get(id);
}

export function listRegisteredMailTransports(): Array<{ id: string; label: string }> {
  return [...transports].map(([id, transport]) => ({ id, label: transport.label }));
}

export function unregisterMailTransports(owner: string): void {
  for (const key of transports.keys())
    if (key.startsWith(`plugin:${owner}.`)) transports.delete(key);
}
