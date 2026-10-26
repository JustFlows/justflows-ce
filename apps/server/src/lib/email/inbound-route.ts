// SPDX-License-Identifier: MIT

/** A site that can receive an inbound message, with the addresses it answers. */
export interface InboundSiteAddress {
  id: string;
  addresses: string[];
}

export function normalizeMailAddress(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * The site a polled message belongs to.
 * A claim from a plugin wins. Otherwise one other site's address in the
 * recipients wins. Two matches, or none, stay on the mailbox owner.
 */
export function chooseInboundSite(input: {
  mailboxSiteId: string;
  claimedSiteId?: string;
  recipients: string[];
  sites: InboundSiteAddress[];
}): string {
  const known = new Set(input.sites.map((site) => site.id));
  known.add(input.mailboxSiteId);
  const claimed = (input.claimedSiteId ?? "").trim();
  if (claimed && known.has(claimed) && claimed !== input.mailboxSiteId) return claimed;
  const recipients = new Set(
    input.recipients.map(normalizeMailAddress).filter((value) => value.includes("@")),
  );
  const hits = [
    ...new Set(
      input.sites
        .filter(
          (site) =>
            site.id !== input.mailboxSiteId &&
            site.addresses.some((address) => recipients.has(normalizeMailAddress(address))),
        )
        .map((site) => site.id),
    ),
  ];
  if (hits.length === 1) return hits[0]!;
  return input.mailboxSiteId;
}

/** A subsite without its own mail settings does not open a mailbox. The main site does. */
export function shouldPollMailbox(
  scope: { root: boolean; ownAllowed: boolean },
  config: { imapEnabled?: boolean; imapHost?: string; imapUser?: string },
): boolean {
  if (!scope.root && !scope.ownAllowed) return false;
  return config.imapEnabled === true && Boolean(config.imapHost?.trim()) && Boolean(config.imapUser?.trim());
}

/** Folder name safe to send to an IMAP server. Anything else is INBOX. */
export function imapMailboxName(value: string | undefined): string {
  const name = (value ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/.test(name)) return "INBOX";
  return name;
}

export function remembersMessage(seen: readonly string[], id: string): boolean {
  return Boolean(id) && seen.includes(id);
}

export function rememberMessage(seen: readonly string[], id: string, limit = 500): string[] {
  if (!id || seen.includes(id)) return [...seen];
  return [...seen, id].slice(-limit);
}
