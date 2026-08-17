import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  computeMissingPlugins,
  loadPluginChoices,
  savePluginChoices,
  listInstalledPluginIds,
  checkMissingPlugins,
  syncPlugins,
  claudeBin,
  safeExec,
} from '../src/plugins-sync.mjs';
import { pluginChoicesPath } from '../src/paths.mjs';
import { useIsolatedHome } from './helpers/isolated-home.mjs';

useIsolatedHome();

test('computeMissingPlugins finds an enabled plugin this machine does not have installed', () => {
  const missing = computeMissingPlugins({
    enabledPlugins: { 'ui-ux-pro-max@ui-ux-pro-max-skill': true },
    installedIds: new Set(),
    choices: {},
  });
  assert.deepEqual(missing, ['ui-ux-pro-max@ui-ux-pro-max-skill']);
});

test('computeMissingPlugins ignores a plugin already installed here', () => {
  const missing = computeMissingPlugins({
    enabledPlugins: { 'superpowers@claude-plugins-official': true },
    installedIds: new Set(['superpowers@claude-plugins-official']),
    choices: {},
  });
  assert.deepEqual(missing, []);
});

test('computeMissingPlugins ignores an entry the incoming settings disabled', () => {
  const missing = computeMissingPlugins({
    enabledPlugins: { 'figma@claude-plugins-official': false },
    installedIds: new Set(),
    choices: {},
  });
  assert.deepEqual(missing, []);
});

test('computeMissingPlugins never re-offers a plugin the user already declined here', () => {
  const missing = computeMissingPlugins({
    enabledPlugins: { 'vercel@claude-plugins-official': true },
    installedIds: new Set(),
    choices: { 'vercel@claude-plugins-official': 'skipped' },
  });
  assert.deepEqual(missing, []);
});

test('computeMissingPlugins handles an empty or missing enabledPlugins map', () => {
  assert.deepEqual(
    computeMissingPlugins({ enabledPlugins: undefined, installedIds: new Set(), choices: {} }),
    []
  );
});

test('plugin choices round-trip through disk, empty when never written', async () => {
  assert.deepEqual(await loadPluginChoices(), {});
  await savePluginChoices({ 'x@y': 'skipped' });
  assert.deepEqual(await loadPluginChoices(), { 'x@y': 'skipped' });
  const onDisk = JSON.parse(await fs.readFile(pluginChoicesPath(), 'utf8'));
  assert.deepEqual(onDisk, { 'x@y': 'skipped' });
});

test('claudeBin resolves to the .cmd shim on Windows and the plain name everywhere else', () => {
  assert.equal(claudeBin('win32'), 'claude.cmd');
  assert.equal(claudeBin('darwin'), 'claude');
  assert.equal(claudeBin('linux'), 'claude');
});

test('safeExec refuses an argument outside the allowlist before it ever reaches the shell', async () => {
  const runner = async () => {
    throw new Error('must not be called for an unsafe argument');
  };
  await assert.rejects(
    () => safeExec('claude.cmd', ['plugin', 'install', 'evil"; rm -rf /'], { runner }),
    /unsafe argument/
  );
});

test('safeExec runs allowlisted arguments as a single shell command string', async () => {
  const calls = [];
  const runner = async (command) => {
    calls.push(command);
    return { stdout: 'ok' };
  };
  const result = await safeExec('claude.cmd', ['plugin', 'list', '--json'], { runner });
  assert.equal(result.stdout, 'ok');
  assert.deepEqual(calls, ['claude.cmd plugin list --json']);
});

test('listInstalledPluginIds parses `claude plugin list --json` output into a Set of ids', async () => {
  const exec = async (cmd, args) => {
    assert.equal(cmd, claudeBin());
    assert.deepEqual(args, ['plugin', 'list', '--json']);
    return { stdout: JSON.stringify([{ id: 'a@b' }, { id: 'c@d' }]) };
  };
  const ids = await listInstalledPluginIds({ exec });
  assert.deepEqual([...ids].sort(), ['a@b', 'c@d']);
});

test('listInstalledPluginIds returns null, not a throw, when the claude CLI is unavailable', async () => {
  const exec = async () => {
    throw new Error('spawn claude ENOENT');
  };
  assert.equal(await listInstalledPluginIds({ exec }), null);
});

test('checkMissingPlugins is read-only: it never prompts or installs, only reports', async () => {
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push(args.join(' '));
    if (args.join(' ') === 'plugin list --json') return { stdout: '[]' };
    throw new Error(`must not call anything beyond plugin list, got: ${args.join(' ')}`);
  };
  const missing = await checkMissingPlugins({ enabledPlugins: { 'a@mp': true }, exec });
  assert.deepEqual(missing, ['a@mp']);
  assert.deepEqual(calls, ['plugin list --json']);
});

test('checkMissingPlugins respects a prior decline, same as the interactive path', async () => {
  const exec = async (cmd, args) => {
    if (args.join(' ') === 'plugin list --json') return { stdout: '[]' };
    return { stdout: '' };
  };
  await syncPlugins({ enabledPlugins: { 'quiet-decline@mp': true }, extraKnownMarketplaces: {}, ask: async () => 'n', exec });
  const missing = await checkMissingPlugins({ enabledPlugins: { 'quiet-decline@mp': true }, exec });
  assert.deepEqual(missing, []);
});

test('checkMissingPlugins returns an empty list, not an error, when the claude CLI is unavailable', async () => {
  const exec = async () => {
    throw new Error('spawn claude ENOENT');
  };
  assert.deepEqual(await checkMissingPlugins({ enabledPlugins: { 'a@mp': true }, exec }), []);
});

test('syncPlugins skips everything silently when the claude CLI cannot be reached - never blocks a sync', async () => {
  const exec = async () => {
    throw new Error('spawn claude ENOENT');
  };
  const ask = async () => {
    throw new Error('must not prompt when there is nothing to check against');
  };
  const installed = await syncPlugins({
    enabledPlugins: { 'a@b': true },
    extraKnownMarketplaces: {},
    ask,
    exec,
  });
  assert.deepEqual(installed, []);
});

test('syncPlugins asks once per missing plugin and installs only the ones the user accepts', async () => {
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push(args.join(' '));
    if (args.join(' ') === 'plugin list --json') {
      return { stdout: JSON.stringify([]) };
    }
    if (args.join(' ') === 'plugin marketplace list --json') {
      return { stdout: JSON.stringify([{ name: 'known-mp' }]) };
    }
    return { stdout: '' };
  };
  const answers = { 'Install a@known-mp, synced from another machine? [y/N]: ': 'y',
    'Install b@known-mp, synced from another machine? [y/N]: ': 'n' };
  const ask = async (question) => answers[question] ?? 'n';

  const installed = await syncPlugins({
    enabledPlugins: { 'a@known-mp': true, 'b@known-mp': true },
    extraKnownMarketplaces: {},
    ask,
    exec,
  });

  assert.deepEqual(installed, ['a@known-mp']);
  assert.ok(calls.includes('plugin install a@known-mp'));
  assert.ok(!calls.includes('plugin install b@known-mp'));
  // Known marketplace, so it must not try to re-add it.
  assert.ok(!calls.some((c) => c.startsWith('plugin marketplace add')));
});

test('syncPlugins adds an unknown marketplace before installing from it', async () => {
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push(args.join(' '));
    if (args.join(' ') === 'plugin list --json') return { stdout: '[]' };
    if (args.join(' ') === 'plugin marketplace list --json') return { stdout: '[]' };
    return { stdout: '' };
  };
  const ask = async () => 'y';

  await syncPlugins({
    enabledPlugins: { 'a@fresh-mp': true },
    extraKnownMarketplaces: { 'fresh-mp': { source: { source: 'github', repo: 'someone/repo' } } },
    ask,
    exec,
  });

  assert.ok(calls.includes('plugin marketplace add someone/repo'));
  const addIndex = calls.indexOf('plugin marketplace add someone/repo');
  const installIndex = calls.indexOf('plugin install a@fresh-mp');
  assert.ok(addIndex < installIndex, 'marketplace must be added before the plugin is installed');
});

test('syncPlugins records a decline so the same plugin is never asked about again', async () => {
  const exec = async (cmd, args) => {
    if (args.join(' ') === 'plugin list --json') return { stdout: '[]' };
    return { stdout: '' };
  };
  const ask = async () => 'n';

  await syncPlugins({ enabledPlugins: { 'decline@mp': true }, extraKnownMarketplaces: {}, ask, exec });
  assert.equal((await loadPluginChoices())['decline@mp'], 'skipped');

  // A second run with a fresh ask that always throws proves it was not asked again.
  const askAgain = async () => {
    throw new Error('must not ask again after a decline');
  };
  const installed = await syncPlugins({
    enabledPlugins: { 'decline@mp': true },
    extraKnownMarketplaces: {},
    ask: askAgain,
    exec,
  });
  assert.deepEqual(installed, []);
});

test('syncPlugins does not permanently give up after a failed install - it asks again next time', async () => {
  const exec = async (cmd, args) => {
    if (args.join(' ') === 'plugin list --json') return { stdout: '[]' };
    if (args.join(' ') === 'plugin marketplace list --json') return { stdout: '[{"name":"failmp"}]' };
    if (args.join(' ') === 'plugin install fail@failmp') throw new Error('network error');
    return { stdout: '' };
  };
  const ask = async () => 'y';

  const installed = await syncPlugins({
    enabledPlugins: { 'fail@failmp': true },
    extraKnownMarketplaces: {},
    ask,
    exec,
  });
  assert.deepEqual(installed, []);
  assert.equal((await loadPluginChoices())['fail@failmp'], undefined);
});
