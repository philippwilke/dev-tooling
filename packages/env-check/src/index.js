import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_REGISTRY = 'https://npm.pkg.github.com/';
const WHOAMI_TIMEOUT_MS = 15_000;
const NETWORK_ERROR = /\b(ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ENETUNREACH)\b/;
const AUTH_ERROR = /\b(E401|E403|ENEEDAUTH)\b|\b401\b|\b403\b/;
// A scope registry override used to install the checker (npx --@scope:registry=...) must
// never reach the check itself, which has to see the project's real configuration.
// Current npm does not export it to children; this guards against callers that do.
const SCOPE_REGISTRY_OVERRIDE = /^npm_config_@[^:]+:registry$/i;

export const USAGE = `Usage: pw-env-check [--scope @scope]... [--registry URL] [--offline] [--quiet]

Checks that each scope is mapped to the expected registry and that npm is
authenticated against it. Scopes and registry can also be set in package.json:

  "envCheck": { "scopes": ["@philippwilke"], "registry": "https://npm.pkg.github.com/" }

Options:
  --scope <name>     Scope to check; repeatable. Default: envCheck.scopes
  --registry <url>   Expected registry. Default: envCheck.registry or ${DEFAULT_REGISTRY}
  --offline          Only check that a token is configured; skip 'npm whoami'
  --quiet            Print problems only
  --help             Show this help`;

export class UsageError extends Error {}

export function normalizeRegistry(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'undefined' || trimmed === 'null') return null;
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

export function normalizeScope(value) {
  const trimmed = String(value ?? '').trim().toLowerCase();
  if (!trimmed) throw new UsageError('Empty scope name.');
  const scope = trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
  if (!/^@[a-z0-9][a-z0-9._-]*$/.test(scope)) throw new UsageError(`Invalid scope: ${value}`);
  return scope;
}

export function parseArgs(argv) {
  const options = { scopes: [], registry: null, offline: false, quiet: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, undefined];
    const value = () => {
      if (inline !== undefined) return inline;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new UsageError(`${flag} needs a value.`);
      i += 1;
      return next;
    };
    switch (flag) {
      case '--scope': options.scopes.push(normalizeScope(value())); break;
      case '--registry': options.registry = normalizeRegistry(value()); break;
      case '--offline': options.offline = true; break;
      case '--quiet': options.quiet = true; break;
      case '--help': case '-h': options.help = true; break;
      default: throw new UsageError(`Unknown option: ${arg}`);
    }
  }
  return options;
}

export async function readPackageConfig(cwd) {
  try {
    const pkg = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8'));
    const config = pkg.envCheck ?? {};
    return {
      scopes: Array.isArray(config.scopes) ? config.scopes.map(normalizeScope) : [],
      registry: normalizeRegistry(config.registry),
    };
  } catch (error) {
    if (error.code === 'ENOENT') return { scopes: [], registry: null };
    throw error;
  }
}

export function cleanEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !SCOPE_REGISTRY_OVERRIDE.test(key)));
}

export function createNpmRunner({ cwd, env = process.env }) {
  const childEnv = cleanEnv(env);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return (args, { timeout = WHOAMI_TIMEOUT_MS } = {}) =>
    new Promise((resolve) => {
      execFile(npm, args, { cwd, env: childEnv, timeout, shell: process.platform === 'win32' },
        (error, stdout, stderr) => {
          resolve({
            code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
            stdout: String(stdout).trim(),
            stderr: `${String(stderr).trim()} ${error && typeof error.code === 'string' ? error.code : ''}`.trim(),
          });
        });
    });
}

/** Offline fallback: is an _authToken for the registry host present in a known .npmrc? */
export async function findConfiguredToken(registry, { cwd, env = process.env, homedir = os.homedir(), read = readFile }) {
  const host = new URL(registry).host;
  const files = [
    path.join(cwd, '.npmrc'),
    env.NPM_CONFIG_USERCONFIG || env.npm_config_userconfig,
    path.join(homedir, '.npmrc'),
  ].filter(Boolean);
  const missingVariables = new Set();

  for (const file of files) {
    let content;
    try { content = await read(file, 'utf8'); } catch { continue; }
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || line.startsWith(';')) continue;
      const match = line.match(/^\/\/([^/]+)\/?.*:_authToken\s*=\s*(.*)$/);
      if (!match || match[1] !== host) continue;
      const token = match[2].trim().replace(/^["']|["']$/g, '');
      const placeholder = token.match(/^\$\{([^}]+)\}$/);
      if (placeholder) {
        if (env[placeholder[1]]?.trim()) return { found: true, file };
        missingVariables.add(placeholder[1]);
      } else if (token) {
        return { found: true, file };
      }
    }
  }
  return { found: false, missingVariables: [...missingVariables] };
}

/** Checks one scope. Returns { ok, errors, warnings, info }. */
export async function checkScope({ scope, expectedRegistry, offline, runNpm, findToken }) {
  const result = { scope, ok: false, errors: [], warnings: [], info: [] };
  const mapped = normalizeRegistry((await runNpm(['config', 'get', `${scope}:registry`])).stdout);

  if (!mapped) {
    result.errors.push(`${scope} is not mapped to a registry. Add to .npmrc:\n    ${scope}:registry=${expectedRegistry}`);
    return result;
  }
  if (mapped !== expectedRegistry) {
    result.errors.push(`${scope} points to ${mapped}, expected ${expectedRegistry}.`);
    return result;
  }

  const offlineCheck = async () => {
    const token = await findToken(expectedRegistry);
    if (token.found) return true;
    const hint = token.missingVariables?.length
      ? `Environment variable(s) referenced in .npmrc are empty: ${token.missingVariables.join(', ')}.`
      : `No auth token for ${new URL(expectedRegistry).host} found in .npmrc files.`;
    result.errors.push(`${scope}: ${hint}`);
    return false;
  };

  if (offline) {
    result.ok = await offlineCheck();
    if (result.ok) result.info.push(`${scope} → ${expectedRegistry} (token configured, not verified)`);
    return result;
  }

  const whoami = await runNpm(['whoami', `--registry=${expectedRegistry}`]);
  if (whoami.code === 0) {
    result.ok = true;
    result.info.push(`${scope} → ${expectedRegistry} (authenticated as ${whoami.stdout || 'unknown'})`);
    return result;
  }
  if (NETWORK_ERROR.test(whoami.stderr)) {
    result.warnings.push(`${scope}: ${expectedRegistry} unreachable; checked token presence only.`);
    result.ok = await offlineCheck();
    return result;
  }
  if (AUTH_ERROR.test(whoami.stderr)) {
    const token = await findToken(expectedRegistry);
    if (token.found) {
      result.errors.push(`${scope}: the token for ${expectedRegistry} was rejected. It may be expired or lack read:packages.`);
    } else if (token.missingVariables?.length) {
      result.errors.push(`${scope}: not authenticated. Environment variable(s) referenced in .npmrc are empty: ${token.missingVariables.join(', ')}.`);
    } else {
      result.errors.push(`${scope}: not authenticated against ${expectedRegistry}. Configure a token, e.g.\n    //${new URL(expectedRegistry).host}/:_authToken=\${GITHUB_PACKAGES_READ_TOKEN}`);
    }
    return result;
  }
  result.errors.push(`${scope}: 'npm whoami' failed: ${whoami.stderr || `exit code ${whoami.code}`}`);
  return result;
}

export async function main(argv, { cwd = process.cwd(), env = process.env, log = console.log, logError = console.error, runNpm, findToken } = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    logError(`${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (options.help) { log(USAGE); return 0; }

  const fromPackage = await readPackageConfig(cwd);
  const scopes = [...new Set(options.scopes.length ? options.scopes : fromPackage.scopes)];
  const expectedRegistry = options.registry ?? fromPackage.registry ?? DEFAULT_REGISTRY;
  if (!scopes.length) {
    logError(`No scopes to check. Pass --scope or set envCheck.scopes in package.json.\n\n${USAGE}`);
    return 2;
  }

  const npm = runNpm ?? createNpmRunner({ cwd, env });
  const token = findToken ?? ((registry) => findConfiguredToken(registry, { cwd, env }));
  let failed = false;

  for (const scope of scopes) {
    const result = await checkScope({ scope, expectedRegistry, offline: options.offline, runNpm: npm, findToken: token });
    result.warnings.forEach((message) => logError(`⚠ ${message}`));
    result.errors.forEach((message) => logError(`✖ ${message}`));
    if (!options.quiet) result.info.forEach((message) => log(`✔ ${message}`));
    failed ||= !result.ok;
  }
  if (failed && (env.CI || env.GITHUB_ACTIONS)) {
    logError('In CI, reference the token in .npmrc and set it from a secret, e.g. GITHUB_PACKAGES_READ_TOKEN: ${{ secrets.GITHUB_TOKEN }}.');
  }
  return failed ? 1 : 0;
}
