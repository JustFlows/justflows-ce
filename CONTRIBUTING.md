# CONTRIBUTING.md

Thank you for contributing to Justflows!

## License

Justflows core is licensed under the **MIT License**.

By contributing, you agree that your contributions to core are licensed under MIT and
that you have the right to submit them.

Bundled plugins and themes keep **their own license** (see each package manifest).
Contributions to those packages follow that package's license.

## Developer Certificate of Origin (DCO)

We use the [Developer Certificate of Origin Version 1.1](https://developercertificate.org/).

By contributing, you certify that:

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I have the right to
    submit it under the open source license indicated in the file; or

(b) The contribution is based upon previous work that, to the best of my knowledge,
    is covered under an appropriate open source license and I have the right under
    that license to submit that work with modifications, whether created in whole or
    in part by me, under the same open source license (unless I am permitted to
    submit under a different license), as indicated in the file; or

(c) The contribution was provided directly to me by some other person who certified
    (a), (b) or (c) and I have not modified it.

(d) I understand and agree that this project and the contribution are public and that
    a record of the contribution (including all personal information I submit with it,
    including my sign-off) is maintained indefinitely and may be redistributed
    consistent with this project or the open source license(s) involved.
```

## Sign-off

Every commit must include a sign-off line:

```
Signed-off-by: Your Name <your.email@example.com>
```

Example:

```bash
git commit -s -m "fix(auth): validate session expiry"
```

## Code guidelines

- Match existing TypeScript style and package conventions
- Keep CMS core packages free of Express/React/EJS imports (see architecture docs)
- Add `// SPDX-License-Identifier: MIT` to new core source files
- Run tests and typecheck before opening a PR

## Plugin and theme contributions

Write a new plugin in `plugins/<your-plugin-name>/`. Copy `plugins/hello-world`
and change the id, manifest, and `src/`. See `plugins/README.md`.

Extensions declare **their own license** in the manifest. Official Marketplace
listings must use a **GPL-compatible license**. See `LICENSING.md` and
`licenses/03-plugins.md`.

## Questions

- Licensing: `legal@justflows.com`
- Security: see `SECURITY.md` or email `security@justflows.com`
- Conduct: see `CODE_OF_CONDUCT.md`
