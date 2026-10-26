// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  chooseInboundSite,
  imapMailboxName,
  rememberMessage,
  remembersMessage,
  shouldPollMailbox,
} from "../../../src/lib/email/inbound-route.js";

const sites = [
  { id: "root", addresses: ["noreply@platform.test"] },
  { id: "support", addresses: ["support@example.test"] },
  { id: "shop", addresses: ["shop@example.test"] },
];

describe("inbound mail routing", () => {
  it("files a claimed reply on the site that owns the ticket", () => {
    expect(chooseInboundSite({
      mailboxSiteId: "root",
      claimedSiteId: "support",
      recipients: ["noreply@platform.test"],
      sites,
    })).toBe("support");
  });

  it("files an unclaimed message on the one site whose address it was sent to", () => {
    expect(chooseInboundSite({
      mailboxSiteId: "root",
      recipients: ["support@example.test"],
      sites,
    })).toBe("support");
  });

  it("keeps the message on the mailbox owner when two sites share the address", () => {
    expect(chooseInboundSite({
      mailboxSiteId: "root",
      recipients: ["support@example.test", "shop@example.test"],
      sites,
    })).toBe("root");
  });

  it("does not open a mailbox for a subsite that must use platform mail", () => {
    expect(shouldPollMailbox({ root: false, ownAllowed: false }, { imapEnabled: true, imapHost: "imap.example.test", imapUser: "a" })).toBe(false);
    expect(shouldPollMailbox({ root: true, ownAllowed: true }, { imapEnabled: true, imapHost: "imap.example.test", imapUser: "a" })).toBe(true);
    expect(shouldPollMailbox({ root: false, ownAllowed: true }, { imapEnabled: false, imapHost: "imap.example.test", imapUser: "a" })).toBe(false);
  });

  it("remembers a message id and rejects a folder name that is not a mailbox", () => {
    expect(remembersMessage(rememberMessage(["a"], "b"), "b")).toBe(true);
    expect(imapMailboxName("INBOX")).toBe("INBOX");
    expect(imapMailboxName("../etc")).toBe("INBOX");
  });
});
