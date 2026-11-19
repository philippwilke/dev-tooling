# dev-tooling

Public development tools by Philipp Wilke: small CLIs, published to npmjs.org. Everything here is generic and meant to be used by anyone. Reusable GitHub Actions workflows are not part of this repository.

| Package | What |
|---|---|
| [`packages/env-check`](packages/env-check) | `@philippwilke/env-check` — checks that npm is mapped to and authenticated against the registry of private scopes |

## Releasing

Push a tag `<package>@<version>` for a package in `packages/<package>`, e.g. `env-check@1.0.1`. [`release.yml`](.github/workflows/release.yml) then:

1. checks that the repository owner pushed the tag and that its commit is on `main`;
2. writes the version into `package.json`, installs, builds and tests;
3. publishes to npmjs.org through trusted publishing (with provenance) and to GitHub Packages, so the package resolves whichever registry the `@philippwilke` scope points to. A version already on a registry is skipped.

Prerelease versions such as `1.1.0-beta.1` are published under the dist-tag `next`, everything else under `latest`.

### A new package

npmjs.org registers a trusted publisher only for a package that already exists, so the first version is published by hand:

1. In `packages/<package>`: `npm login`, `npm version <version> --no-git-tag-version`, `npm publish --access public`, then discard the `package.json` change.
2. On npmjs.com, in the package's settings, add a trusted publisher: GitHub Actions, repository `philippwilke/dev-tooling`, workflow `release.yml`. Then set *Publishing access* to "Require two-factor authentication and disallow tokens".
3. Push the tag `<package>@<version>`; the workflow skips npmjs.org and publishes the same version to GitHub Packages.

## License

[MIT](LICENSE)
