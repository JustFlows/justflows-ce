# Custom code

**Admin → Security → Custom code** adds JavaScript and markup to public pages:
analytics, tag managers, chat widgets, verification tags, and small scripts. It
is meant for code you trust and have reviewed. Every visitor's browser runs it.

## Who can use it

Only people with the `code:manage` capability can open the page or its API
(`/api/custom-code`). Administrators have it by default. No other built-in
role does, and a custom role gets it only when you add it explicitly. Snippets
are stored apart from content, so content editors and the content APIs cannot
reach them.

## Snippets

Each snippet has:

| Field | Meaning |
| --- | --- |
| Type | **From the library**: a vetted service filled in with named settings, such as a measurement ID. **Inline script**: your own JavaScript, without `<script>` tags. **External script**: a script URL. **Markup**: meta tags, pixels, and frames. |
| Where | The head, the start of the body, or the end of the body. |
| Pages | Every page, or only the pages you choose. |
| Consent | **Always**, or wait for preferences, analytics, or marketing consent. |
| Environments | Empty to run everywhere, or a list such as `production`. |

The library has Google Analytics 4, Google Tag Manager, Plausible, Matomo, Meta
Pixel, and Microsoft Clarity. Their settings are checked against the format each
service uses, and the host writes the script, so no raw code is pasted.

Markup is sanitized when you save: scripts, styles, event handlers, and non-https
URLs are removed. Scripts are stored exactly as entered and only ever written into
the page by the host.

Custom code does not run on editor previews or on private account pages.

## Content Security Policy

Custom code works with the site's Content Security Policy. Justflows never adds
`'unsafe-inline'`:

- Each inline script, your own or a library snippet's, is allowed by the SHA-256
  hash of its exact text. Changing one character needs a save, which updates the
  hash.
- External scripts, pixels, and frames load only from **Allowed origins**, the
  https origins you list (`https://cdn.example.com` or `https://*.example.com`).
  A library snippet adds the origins its service needs. Origins are added to the
  policy only while a snippet is on.
- A policy that already allows `'unsafe-inline'` is left as it is.

A tag manager loads more scripts from inside its container. Add their origins to
the allowlist, or the browser blocks them.

## Consent

A snippet that needs consent is written as
`<script type="text/plain" data-jf-consent="analytics">`. A consent tool, such as
the Consent plugin, runs it once the visitor agrees to that category. Without a
consent tool installed, it never runs. Only scripts can wait for consent, so
markup always counts as necessary.

## Turning it off

- **Safe mode** on the page turns every snippet off at once, without deleting
  them. Use it when a snippet breaks the site.
- `JF_CUSTOM_CODE=off` in `.env` turns custom code off on that installation, for
  example on a staging copy, whatever the saved settings say.
- On hosted websites, a platform operator can switch **Custom code** off per
  website or in the defaults (Platform → limits). The page, its API, and every
  snippet on that website stop.
- `JF_ENVIRONMENT` names the environment (default `production`, or `development`
  outside production). A snippet limited to other environments does not run.

## History and audit

Each save is checked first: errors refuse the save, and warnings point out, for
example, tracking code that runs without consent or a script that uses `eval`.
Saved changes are recorded in the audit log as `custom_code.changed` with a summary
of what changed and who changed it. Safe mode is recorded as
`custom_code.safe_mode`. The page keeps the last 50 versions.
