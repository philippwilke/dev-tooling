# dev-tooling

Shared development tooling for Philipp Wilke's projects: small CLIs and reusable GitHub Actions workflows. Everything here is generic and public; project-specific workflows (deployments, infrastructure) live in their own repositories.

| Path | What |
|---|---|
| [`packages/env-check`](packages/env-check) | `@philippwilke/env-check` — checks that npm is mapped to and authenticated against the registry of private scopes |
| [`.github/workflows/npm-release.yml`](.github/workflows/npm-release.yml) | Reusable workflow: build, test and publish an npm package to npmjs.org and/or GitHub Packages |

## Reusable npm release workflow

Call it from a workflow in the package's repository, pinned to a commit of this repository:

```yaml
# .github/workflows/release.yml in the consuming repository
on:
  push:
    tags: ['[0-9]+.[0-9]+.[0-9]+*']

permissions: {}

jobs:
  release:
    permissions:
      contents: read
      id-token: write   # trusted publishing on npmjs.org
      packages: write   # GitHub Packages
    uses: philippwilke/dev-tooling/.github/workflows/npm-release.yml@<commit-sha>
    with:
      version: ${{ github.ref_name }}
      publish-github: true
      publish-npmjs: false
```

| Input | Default | Meaning |
|---|---|---|
| `version` | — | Semver version without a leading `v`; written into `package.json` before publishing |
| `package-directory` | `.` | Directory containing `package.json` |
| `publish-npmjs` | `false` | Publish publicly to npmjs.org via trusted publishing, with provenance |
| `publish-github` | `true` | Publish to GitHub Packages with the caller's `GITHUB_TOKEN`; the package scope must equal the repository owner |
| `node-version` | `24` | Node.js version |
| `npm-version` | `11.21.3` | npm CLI version (trusted publishing needs ≥ 11.5.1) |

The workflow runs `npm ci` (if a lockfile exists), `npm run build` and `npm test` (if defined), then publishes. A version that already exists on a registry is skipped; any other registry error fails the run. Packages must not set `publishConfig.registry`, because the workflow selects the registry.

### Trusted publishing on npmjs.org

npmjs.org accepts OIDC publishes only from a registered workflow, and only for a package that already exists:

1. Publish the first version manually from the package directory: `npm publish --access public`.
2. Register the **calling** workflow (not `npm-release.yml`):
   `npm trust github <package> --file release.yml --repo <owner>/<repo> --allow-publish`
   (or in the package settings on npmjs.com).
3. In the package settings, disallow token publishing so only the workflow can publish.

### Recommended repository settings

- A tag ruleset restricting who may create release tags, since a tag push publishes.
- Dependabot (see [`.github/dependabot.yml`](.github/dependabot.yml)) keeps the SHA-pinned actions current.

## Releasing this repository's packages

Push a tag `<package>@<version>`, e.g. `env-check@1.0.0`. [`release.yml`](.github/workflows/release.yml) publishes to npmjs.org and GitHub Packages, so the package resolves whichever registry the `@philippwilke` scope points to.

## License

[MIT](LICENSE)
