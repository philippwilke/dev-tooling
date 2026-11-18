import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_REGISTRY,
  checkScope,
  cleanEnv,
  findConfiguredToken,
  main,
  normalizeRegistry,
  normalizeScope,
  parseArgs,
} from '../src/index.js';

const fakeNpm = ({ registry = DEFAULT_REGISTRY, whoami = { code: 0, stdout: 'philippwilke', stderr: '' } } = {}) =>
  async (args) => {
    if (args[0] === 'config') return { code: 0, stdout: String(registry), stderr: '' };
    if (args[0] === 'whoami') return whoami;
    throw new Error(`unexpected npm call: ${args.join(' ')}`);
  };
const tokenFound = async () => ({ found: true });
const tokenMissing = async () => ({ found: false, missingVariables: [] });

describe('normalizers', () => {
  it('adds a trailing slash and rejects empty values', () => {
    assert.equal(normalizeRegistry('https://npm.pkg.github.com'), 'https://npm.pkg.github.com/');
    assert.equal(normalizeRegistry('undefined'), null);
    assert.equal(normalizeRegistry(''), null);
  });

  it('prefixes and lowercases scopes', () => {
    assert.equal(normalizeScope('PhilippWilke'), '@philippwilke');
    assert.throws(() => normalizeScope('@bad scope'));
  });
});

describe('parseArgs', () => {
  it('collects repeated and inline scopes', () => {
    const options = parseArgs(['--scope', '@a', '--scope=b', '--offline', '--registry', 'https://r.example']);
    assert.deepEqual(options.scopes, ['@a', '@b']);
    assert.equal(options.registry, 'https://r.example/');
    assert.equal(options.offline, true);
  });

  it('rejects unknown options and missing values', () => {
    assert.throws(() => parseArgs(['--nope']));
    assert.throws(() => parseArgs(['--scope']));
  });
});

describe('cleanEnv', () => {
  it('drops scope registry overrides injected by npx but keeps other config', () => {
    const env = cleanEnv({ 'npm_config_@philippwilke:registry': 'https://registry.npmjs.org/', npm_config_userconfig: '/x', PATH: '/bin' });
    assert.deepEqual(env, { npm_config_userconfig: '/x', PATH: '/bin' });
  });
});

describe('checkScope', () => {
  const base = { scope: '@philippwilke', expectedRegistry: DEFAULT_REGISTRY, offline: false };

  it('passes when mapped and authenticated', async () => {
    const result = await checkScope({ ...base, runNpm: fakeNpm(), findToken: tokenFound });
    assert.equal(result.ok, true);
    assert.match(result.info[0], /authenticated as philippwilke/);
  });

  it('fails when the scope is not mapped', async () => {
    const result = await checkScope({ ...base, runNpm: fakeNpm({ registry: 'undefined' }), findToken: tokenFound });
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /not mapped/);
  });

  it('fails when the scope points elsewhere', async () => {
    const result = await checkScope({ ...base, runNpm: fakeNpm({ registry: 'https://registry.npmjs.org/' }), findToken: tokenFound });
    assert.match(result.errors[0], /expected https:\/\/npm\.pkg\.github\.com\//);
  });

  it('reports a rejected token separately from a missing one', async () => {
    const whoami = { code: 1, stdout: '', stderr: 'npm error code E401' };
    const rejected = await checkScope({ ...base, runNpm: fakeNpm({ whoami }), findToken: tokenFound });
    const missing = await checkScope({ ...base, runNpm: fakeNpm({ whoami: { ...whoami, stderr: 'npm error code ENEEDAUTH' } }), findToken: tokenMissing });
    assert.match(rejected.errors[0], /rejected/);
    assert.match(missing.errors[0], /not authenticated/);
  });

  it('names empty environment variables referenced in .npmrc', async () => {
    const whoami = { code: 1, stdout: '', stderr: 'npm error code ENEEDAUTH' };
    const findToken = async () => ({ found: false, missingVariables: ['NODE_AUTH_TOKEN'] });
    const result = await checkScope({ ...base, runNpm: fakeNpm({ whoami }), findToken });
    assert.match(result.errors[0], /NODE_AUTH_TOKEN/);
  });

  it('falls back to the offline check on network errors', async () => {
    const whoami = { code: 1, stdout: '', stderr: 'npm error code ENOTFOUND' };
    const result = await checkScope({ ...base, runNpm: fakeNpm({ whoami }), findToken: tokenFound });
    assert.equal(result.ok, true);
    assert.equal(result.warnings.length, 1);
  });

  it('skips whoami in offline mode', async () => {
    const result = await checkScope({ ...base, offline: true, runNpm: fakeNpm({ whoami: null }), findToken: tokenFound });
    assert.equal(result.ok, true);
  });
});

describe('findConfiguredToken', () => {
  const files = (map) => async (file) => {
    if (file in map) return map[file];
    throw Object.assign(new Error('missing'), { code: 'ENOENT' });
  };

  it('accepts a literal token and resolves placeholders', async () => {
    const read = files({ '/p/.npmrc': '//npm.pkg.github.com/:_authToken=${TOKEN}\n' });
    const found = await findConfiguredToken(DEFAULT_REGISTRY, { cwd: '/p', env: { TOKEN: 'x' }, homedir: '/h', read });
    const missing = await findConfiguredToken(DEFAULT_REGISTRY, { cwd: '/p', env: {}, homedir: '/h', read });
    assert.equal(found.found, true);
    assert.deepEqual(missing, { found: false, missingVariables: ['TOKEN'] });
  });

  it('ignores comments and other hosts', async () => {
    const read = files({ '/h/.npmrc': '# //npm.pkg.github.com/:_authToken=x\n//registry.npmjs.org/:_authToken=y\n' });
    const result = await findConfiguredToken(DEFAULT_REGISTRY, { cwd: '/p', env: {}, homedir: '/h', read });
    assert.equal(result.found, false);
  });
});

describe('main', () => {
  const quiet = { log: () => {}, logError: () => {} };

  it('returns 2 without scopes', async () => {
    assert.equal(await main([], { cwd: '/nonexistent', env: {}, ...quiet }), 2);
  });

  it('returns 0 or 1 depending on the checks', async () => {
    const ok = await main(['--scope', '@philippwilke'], { cwd: '/nonexistent', env: {}, runNpm: fakeNpm(), findToken: tokenFound, ...quiet });
    const bad = await main(['--scope', '@philippwilke'], { cwd: '/nonexistent', env: {}, runNpm: fakeNpm({ registry: 'undefined' }), findToken: tokenFound, ...quiet });
    assert.equal(ok, 0);
    assert.equal(bad, 1);
  });
});
