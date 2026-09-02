# Email delivery

Administrators configure outgoing mail under **Settings → Outgoing mail**. The
built-in transports are local sendmail and SMTP. SMTP supports no encryption,
STARTTLS, and implicit SSL/TLS. Passwords are encrypted at rest and are never
returned by the API; leaving the password field blank preserves the stored value.

The From address defaults to the administration address. Reply-To and envelope
sender are optional and independent. Use **Send test email** to see the complete
transport response. Provider credentials and message payloads are redacted from
responses, logs, and support output.

Every send creates a delivery row with a privacy-masked recipient, message type,
subject, transport, status, attempt count, timestamps, provider response, and
safe error detail. Administrators can filter the latest 200 rows and retry a
dead letter. Retry payloads are encrypted; recipient hashes support suppression
checks without exposing addresses in the log.

Non-transactional messages may opt into suppression by passing
`transactional: false` and a stable `type` to the host mail service. A
suppression can cover that type or `*`. Transactional account and security mail
is not suppressed.

## Provider plugins

A plugin declaring `mail:transport` can register an API-based provider during
activation:

```ts
ctx.mail.register({
  id: "api",
  label: "Example Mail API",
  async send(message) {
    const result = await provider.send(message);
    return { response: result.detail, messageId: result.id, status: result.status };
  },
});
```

The transport appears as `plugin:<plugin-id>.<transport-id>`. Provider plugins
should keep API keys in `ctx.secrets`, honor the configured provider limits,
and return provider response identifiers without secrets.

SPF, DKIM, and DMARC are DNS/provider controls. Justflows surfaces guidance but
does not enforce or alter DNS records.
