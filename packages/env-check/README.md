# @philippwilke/env-check

Fails fast, with a clear message, when npm cannot reach a private package scope — instead of a cryptic 401 halfway through `npm install`.

For each scope it checks that:

1. the scope is mapped to the expected registry (`@scope:registry=…` in an `.npmrc`),
2. npm is authenticated there (`npm whoami`), distinguishing a missing token, an empty environment variable referenced in `.npmrc`, and a rejected token.

If the registry is unreachable, it falls back to checking that a token is configured. Zero dependencies; Node.js 20 or later.

## Usage

The checker is published both to npmjs.org and GitHub Packages. Run it via `npx` with the scope pointed at the public registry, so it installs even when the private registry is not set up yet:

```json
{
  "scripts": {
    "check:env": "npx --yes --@philippwilke:registry=https://registry.npmjs.org/ @philippwilke/env-check@1"
  },
  "envCheck": {
    "scopes": ["@philippwilke"],
    "registry": "https://npm.pkg.github.com/"
  }
}
```

The override applies only to installing the checker; the check itself reads your real configuration. Run `npm run check:env` after cloning, or as a CI step before `npm ci`.

### Options

```
pw-env-check [--scope @scope]... [--registry URL] [--offline] [--quiet]
```

| Option | Default | Meaning |
|---|---|---|
| `--scope` | `envCheck.scopes` | Scope to check; repeatable |
| `--registry` | `envCheck.registry` or `https://npm.pkg.github.com/` | Registry the scopes must point to |
| `--offline` | off | Only check that a token is configured; skip `npm whoami` |
| `--quiet` | off | Print problems only |

Exit codes: `0` all checks passed, `1` a check failed, `2` usage error.

## Typical fixes

```ini
# .npmrc in the project (commit this)
@philippwilke:registry=https://npm.pkg.github.com/
//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_READ_TOKEN}
```

Locally, export `GITHUB_PACKAGES_READ_TOKEN` with a GitHub token that has `read:packages`. In GitHub Actions, set it from `secrets.GITHUB_TOKEN` and grant the repository read access in the package settings.

## License

MIT
