# Packaging a `.jfpkg`

A `.jfpkg` is a gzipped ustar archive. The installer extracts it with Node
builtins (no native `tar` addon) and requires `justflows.json` at the **root**
of the archive.

Minimum plugin layout after extract:

```
justflows.json
dist/index.js
```

Pack from the plugin folder so the manifest is not nested:

```bash
cd plugins/acme-seo
pnpm build
COPYFILE_DISABLE=1 tar -czf ../../acme-seo.jfpkg justflows.json dist
```

macOS `tar` otherwise adds `._*` AppleDouble files; `COPYFILE_DISABLE=1`
avoids that.

Install by dropping the file on Admin → **Plugins**. The host does not run
`npm install` or compile TypeScript from the archive — ship JavaScript.

Since 0.1.2 the installer refuses an unsigned `.jfpkg` unless you pin its
SHA-256 digest in `JUSTFLOWS_TRUSTED_PACKAGE_DIGESTS`, or you set
`JUSTFLOWS_ALLOW_UNSIGNED_PACKAGES=1` (local development only).

The installer also rejects path traversal, oversized archives, and invalid
manifests. See `packages/installer/src/archive-safety.ts`.
