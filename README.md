# dev-tooling

Shared development tooling for Philipp Wilke's projects: small CLIs and reusable GitHub Actions workflows. Everything here is generic and public; project-specific workflows (deployments, infrastructure) live in their own repositories.

| Path | What |
|---|---|
| [`packages/env-check`](packages/env-check) | `@philippwilke/env-check` — checks that npm is mapped to and authenticated against the registry of private scopes |
| [`.github/workflows/npm-release.yml`](.github/workflows/npm-release.yml) | Reusable workflow: build, test and publish an npm package to npmjs.org and/or GitHub Packages |
| [`rulesets/release-tags.json`](rulesets/release-tags.json) | Ruleset that lets only repository admins create, move or delete tags |

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
| `prerelease-dist-tag` | `next` | Dist-tag for prerelease versions such as `1.1.0-beta.1`; other versions are published as `latest`, so prereleases never satisfy ranges like `^1.0.0` by default |
| `allowed-actors` | owner | Comma-separated logins allowed to trigger a release; empty means the repository owner only |
| `require-default-branch` | `true` | Refuse to publish a commit that is not contained in the default branch |

Before anything else the workflow checks who triggered the release and that the commit is on the default branch, so a tag pushed by automation or on a stray branch publishes nothing. These guards live in the caller's repository and catch mistakes; protecting the tags themselves is the job of a ruleset (below).

The workflow then runs `npm ci` (if a lockfile exists), `npm run build` and `npm test` (if defined), then publishes. A version that already exists on a registry is skipped; any other registry error fails the run. Packages must not set `publishConfig.registry`, because the workflow selects the registry.

### Trusted publishing on npmjs.org

npmjs.org accepts OIDC publishes only from a registered workflow, and a trusted publisher can only be registered for a package that already exists. Publish the first version in one of two ways:

- **Manually (preferred, no token involved):** in the package directory run `npm login`, `npm version <version> --no-git-tag-version` and `npm publish --access public`; discard the `package.json` change afterwards. Then push the release tag so the workflow publishes the same version to GitHub Packages (npmjs.org is skipped because the version exists), and continue with step 4.
- **Through the pipeline with a short-lived bootstrap token:**

1. On npmjs.com create a granular access token: read and write on the package's scope, shortest expiration, *Bypass 2FA* enabled (required for non-interactive publishing).
2. Store it as the repository secret `NPM_BOOTSTRAP_TOKEN` and pass it to the workflow as `secrets: npm-token: ${{ secrets.NPM_BOOTSTRAP_TOKEN }}`.
3. Push the release tag. The workflow publishes with the token and requests provenance explicitly.
4. Register the **calling** workflow (not `npm-release.yml`) as trusted publisher in the package settings on npmjs.com, or
   `npm trust github <package> --file release.yml --repo <owner>/<repo> --allow-publish`.
5. Delete the secret, revoke the token, and set *Publishing access* to "Require two-factor authentication and disallow tokens".

From then on the workflow publishes via OIDC; an unset `npm-token` is ignored.

### Protecting release tags

A tag push publishes, so only repository admins should be able to create, move or delete tags. [`rulesets/release-tags.json`](rulesets/release-tags.json) defines that as a reusable ruleset (all tags; creation, update and deletion restricted; admins bypass). Apply it once per repository, either with *Settings → Rules → Rulesets → New ruleset → Import a ruleset*, or:

```bash
gh api -X POST repos/<owner>/<repo>/rulesets --input rulesets/release-tags.json
```

Rulesets need a public repository or GitHub Pro for private ones. Without them, the workflow's actor and branch checks still apply.

Dependabot (see [`.github/dependabot.yml`](.github/dependabot.yml)) keeps the SHA-pinned actions current.

## Releasing this repository's packages

Push a tag `<package>@<version>`, e.g. `env-check@1.0.0`. [`release.yml`](.github/workflows/release.yml) publishes to npmjs.org and GitHub Packages, so the package resolves whichever registry the `@philippwilke` scope points to.

## License

[MIT](LICENSE)
