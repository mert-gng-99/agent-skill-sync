import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { useIsolatedHome } from './helpers/isolated-home.mjs';

// activate() now touches config.json (see applyVsCodeSettings in extension.cjs);
// without this it would read and write the real machine's ~/.agent-sync.
useIsolatedHome();

const require = createRequire(import.meta.url);

// The extension host resolves `vscode` for real extensions; here we point it at
// a stub so the entry point can be loaded exactly as VS Code would load it.
const stubPath = require.resolve('./stubs/vscode.cjs');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return request === 'vscode' ? stubPath : originalResolve.call(this, request, ...rest);
};

const vscodeStub = require('./stubs/vscode.cjs');
const extension = require('../extension/extension.cjs');

test('the entry point loads the way the extension host loads it', () => {
  // A packaged extension that cannot even be required is invisible to every
  // other test: the manifest still validates and the suite still passes.
  assert.equal(typeof extension.activate, 'function');
  assert.equal(typeof extension.deactivate, 'function');
});

test('activate registers the five contributed commands', async () => {
  const context = { subscriptions: [] };
  await extension.activate(context);

  const ids = vscodeStub.__registeredCommands.map((c) => c.id).sort();
  assert.deepEqual(ids, [
    'agent-sync.doctor',
    'agent-sync.link',
    'agent-sync.menu',
    'agent-sync.projects',
    'agent-sync.sync',
  ]);
  assert.ok(context.subscriptions.length > 0, 'everything registered must be disposable');
});

test('the status bar item opens the menu, not a direct sync', async () => {
  // Regression: a single click used to run "Sync now" straight away, with no
  // way to reach the other commands (Settings included) short of the Command
  // Palette. The status bar item must be bound to the menu picker instead.
  const context = { subscriptions: [] };
  await extension.activate(context);
  assert.equal(vscodeStub.__statusBarItems.at(-1).command, 'agent-sync.menu');
});

test('picking "Open Settings" from the menu opens the agent-sync settings page', async () => {
  vscodeStub.window.showQuickPick = async (items) =>
    items.find((i) => i.label.includes('Open Settings'));

  const context = { subscriptions: [] };
  await extension.activate(context);
  const handler = vscodeStub.__registeredCommands.filter((c) => c.id === 'agent-sync.menu').at(-1).handler;
  await handler();

  assert.deepEqual(vscodeStub.__executedCommands.at(-1), ['workbench.action.openSettings', 'agent-sync']);

  vscodeStub.window.showQuickPick = async () => undefined;
});

test('dismissing the menu (Escape) does nothing', async () => {
  const context = { subscriptions: [] };
  await extension.activate(context);
  const handler = vscodeStub.__registeredCommands.filter((c) => c.id === 'agent-sync.menu').at(-1).handler;
  const before = vscodeStub.__executedCommands.length;
  await handler(); // default stub: showQuickPick resolves undefined
  assert.equal(vscodeStub.__executedCommands.length, before);
});

test('a missing or invalid config.json is classified as "not configured"', () => {
  const missing = new Error("ENOENT: no such file or directory, open '/home/x/.agent-sync/config.json'");
  missing.code = 'ENOENT';
  assert.equal(extension.isConfigError(missing), true);

  const invalid = new Error('Invalid config at /home/x/.agent-sync/config.json: machineId must contain only letters, digits, dash or underscore');
  assert.equal(extension.isConfigError(invalid), true);
});

test('an unrelated ENOENT elsewhere is not mistaken for "not configured"', () => {
  // Reproduces a real false alarm: a staged skill file briefly missing due to
  // a concurrent sync race surfaced as "agent-sync is not set up on this
  // machine yet. Run node bin/agent-sync.mjs init" - sending the user
  // chasing a setup problem that never existed.
  const err = new Error(
    "ENOENT: no such file or directory, open 'C:\\Users\\x\\.agent-sync\\staged\\skills\\hallmark\\foo.md'"
  );
  err.code = 'ENOENT';
  assert.equal(extension.isConfigError(err), false);
});

test('serialize() never runs two calls of the wrapped function at the same time', async () => {
  let concurrent = 0;
  let maxConcurrent = 0;
  const slow = async () => {
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise((resolve) => setTimeout(resolve, 10));
    concurrent -= 1;
  };
  const serialized = extension.serialize(slow);
  await Promise.all([serialized(), serialized(), serialized()]);
  assert.equal(maxConcurrent, 1);
});

test('serialize() still runs every call, in order, even after an earlier one rejects', async () => {
  // A real sync failure must not jam the queue - the next focus-change or
  // click still has to go through.
  const calls = [];
  const fn = async (n) => {
    calls.push(n);
    if (n === 1) throw new Error('boom');
    return n;
  };
  const serialized = extension.serialize(fn);
  const results = await Promise.allSettled([serialized(1), serialized(2), serialized(3)]);
  assert.deepEqual(calls, [1, 2, 3]);
  assert.equal(results[0].status, 'rejected');
  assert.deepEqual(
    results.slice(1).map((r) => r.value),
    [2, 3]
  );
});

test('the engine is reachable from the CommonJS entry point', async () => {
  // extension.cjs pulls the ESM engine in with a dynamic import. If those paths
  // are wrong - or the engine files are missing from a package - this throws.
  const engine = await import('../src/sync.mjs');
  assert.equal(typeof engine.runSync, 'function');
  assert.equal(typeof engine.syncPairs, 'function');
});

test('unset VS Code settings never clobber an existing config.json', () => {
  // VS Code reports "" / [] for settings the user never touched. Without this
  // guard, activating the extension on a machine already set up via the CLI
  // would silently wipe its syncRoot back to empty.
  const fileConfig = { syncRoot: '/Volumes/Drive/agent-sync', machineId: 'macbook', targets: ['claude'] };
  const merged = extension.mergeVsCodeSettings(fileConfig, { syncRoot: '', machineId: '', targets: [] });
  assert.deepEqual(merged, fileConfig);
});

test('a setting the user actually changed in the UI overrides the file', () => {
  const fileConfig = { syncRoot: '/old/path', machineId: 'macbook', targets: ['claude'] };
  const merged = extension.mergeVsCodeSettings(fileConfig, {
    syncRoot: '/new/path',
    machineId: '',
    targets: ['claude', 'codex'],
  });
  assert.deepEqual(merged, { syncRoot: '/new/path', machineId: 'macbook', targets: ['claude', 'codex'] });
});

test('merging never mutates the file config that was passed in', () => {
  const fileConfig = { syncRoot: '/x', machineId: 'macbook', targets: [] };
  extension.mergeVsCodeSettings(fileConfig, { syncRoot: '/y', machineId: '', targets: [] });
  assert.equal(fileConfig.syncRoot, '/x');
});

test('an unset syncTranscripts leaves the file value alone, true or false', () => {
  assert.equal(
    extension.mergeVsCodeSettings({ syncTranscripts: true }, { syncTranscripts: undefined })
      .syncTranscripts,
    true
  );
  assert.equal(
    extension.mergeVsCodeSettings({ syncTranscripts: false }, { syncTranscripts: undefined })
      .syncTranscripts,
    false
  );
});

test('an explicit false overrides the file - booleans have no "empty" to hide behind', () => {
  // Unlike syncRoot/targets, false is a real, meaningful value here - it must
  // not be mistaken for "the user never touched this setting."
  const merged = extension.mergeVsCodeSettings({ syncTranscripts: true }, { syncTranscripts: false });
  assert.equal(merged.syncTranscripts, false);
});

test('a vaultPath set in VS Code settings overrides the file', () => {
  const fileConfig = { syncRoot: '/x', machineId: 'macbook', vaultPath: '' };
  const merged = extension.mergeVsCodeSettings(fileConfig, {
    syncRoot: '',
    machineId: '',
    targets: [],
    vaultPath: '/Users/x/Documents/EchoOS',
  });
  assert.equal(merged.vaultPath, '/Users/x/Documents/EchoOS');
});

test('an empty vaultPath in VS Code settings never clobbers a linked vault', () => {
  const fileConfig = { syncRoot: '/x', machineId: 'macbook', vaultPath: '/already/linked' };
  const merged = extension.mergeVsCodeSettings(fileConfig, {
    syncRoot: '',
    machineId: '',
    targets: [],
    vaultPath: '',
  });
  assert.equal(merged.vaultPath, '/already/linked');
});

test('picking a known project from the QuickPick actually links it, not just shows a guess', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'as-ext-link-'));
  const syncRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'as-ext-link-root-'));
  await fs.writeFile(
    path.join(syncRoot, 'registry.json'),
    JSON.stringify({
      version: 1,
      projects: { 'other-project-abc123': { name: 'other-project', paths: {} } },
    })
  );
  const configDir = path.join(os.homedir(), '.agent-sync');
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(
    path.join(configDir, 'config.json'),
    JSON.stringify({
      syncRoot,
      machineId: 'test-machine',
      targets: [],
      syncTranscripts: false,
      snapshotKeep: 20,
    })
  );

  vscodeStub.workspace.workspaceFolders = [{ uri: { fsPath: cwd } }];
  // Simulates the user selecting the known project from the picker.
  vscodeStub.window.showQuickPick = async (items) => items.find((i) => i.id === 'other-project-abc123');

  const context = { subscriptions: [] };
  await extension.activate(context);
  const handler = vscodeStub.__registeredCommands
    .filter((c) => c.id === 'agent-sync.link')
    .at(-1).handler;
  await handler();

  const marker = await fs.readFile(path.join(cwd, '.claude-project-id'), 'utf8');
  assert.equal(marker.trim(), 'other-project-abc123');

  vscodeStub.workspace.workspaceFolders = undefined;
  vscodeStub.window.showQuickPick = async () => undefined;
});

test('the "Show all projects" command prints the registry to the Output panel', async () => {
  const syncRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'as-ext-projects-root-'));
  await fs.writeFile(
    path.join(syncRoot, 'registry.json'),
    JSON.stringify({
      version: 1,
      projects: { 'demo-abc123': { name: 'demo', paths: { macbook: '/x', pc1: 'C:\\x' } } },
    })
  );
  const configDir = path.join(os.homedir(), '.agent-sync');
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(
    path.join(configDir, 'config.json'),
    JSON.stringify({
      syncRoot,
      machineId: 'test-machine',
      targets: [],
      syncTranscripts: false,
      snapshotKeep: 20,
    })
  );

  const context = { subscriptions: [] };
  await extension.activate(context);
  const handler = vscodeStub.__registeredCommands
    .filter((c) => c.id === 'agent-sync.projects')
    .at(-1).handler;
  await handler();

  assert.ok(vscodeStub.__outputLines.includes('demo (demo-abc123)'));
  assert.ok(vscodeStub.__outputLines.includes('  macbook: /x'));
  assert.ok(vscodeStub.__outputLines.includes('  pc1: C:\\x'));
});

async function seedConfig(syncRoot) {
  const configDir = path.join(os.homedir(), '.agent-sync');
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(
    path.join(configDir, 'config.json'),
    JSON.stringify({
      syncRoot,
      machineId: 'test-machine',
      targets: [],
      syncTranscripts: false,
      snapshotKeep: 20,
    })
  );
}

test('automatic triggers never turn an unlinked folder into a new project', async () => {
  // Reproduces a real incident: Desktop (a container of unrelated projects,
  // not a project itself) was open as the workspace, and startup/focus sync
  // silently wrote a marker and AGENTS.md straight into it.
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'as-ext-noauto-'));
  const syncRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'as-ext-noauto-root-'));
  await seedConfig(syncRoot);

  vscodeStub.workspace.workspaceFolders = [{ uri: { fsPath: cwd } }];
  const context = { subscriptions: [] };
  await extension.activate(context); // awaits its own requireExisting:true sync before checking auto-resume
  await extension.deactivate(); // this one we can await directly - same guard

  await assert.rejects(() => fs.readFile(path.join(cwd, '.claude-project-id')));

  vscodeStub.workspace.workspaceFolders = undefined;
});

test('the explicit "Sync now" command is still allowed to create a new project', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'as-ext-explicit-'));
  const syncRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'as-ext-explicit-root-'));
  await seedConfig(syncRoot);

  vscodeStub.workspace.workspaceFolders = [{ uri: { fsPath: cwd } }];
  const context = { subscriptions: [] };
  await extension.activate(context);
  const handler = vscodeStub.__registeredCommands.filter((c) => c.id === 'agent-sync.sync').at(-1).handler;
  await handler();

  await fs.readFile(path.join(cwd, '.claude-project-id'), 'utf8'); // must now exist

  vscodeStub.workspace.workspaceFolders = undefined;
});

test('autoResumeLastSession is off by default and does nothing when disabled', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'as-ext-resume-off-'));
  const syncRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'as-ext-resume-off-root-'));
  await seedConfig(syncRoot);

  vscodeStub.workspace.workspaceFolders = [{ uri: { fsPath: cwd } }];
  vscodeStub.__openedUris.length = 0;
  const context = { subscriptions: [] };
  await extension.activate(context);

  assert.deepEqual(vscodeStub.__openedUris, []);
  vscodeStub.workspace.workspaceFolders = undefined;
});

test('autoResumeLastSession opens the newest local session via the official deep link', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'as-ext-resume-on-'));
  const syncRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'as-ext-resume-on-root-'));
  await seedConfig(syncRoot);
  await fs.writeFile(path.join(cwd, '.claude-project-id'), 'proj-resume-test\n');

  const { slugForPath } = await import('../src/paths.mjs');
  const dir = path.join(os.homedir(), '.claude', 'projects', slugForPath(cwd));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'session-abc.jsonl'), '{}');

  vscodeStub.workspace.getConfiguration = () => ({
    get: (key, fallback) => (key === 'autoResumeLastSession' ? true : fallback),
    inspect: () => ({ workspaceValue: undefined, globalValue: undefined }),
  });
  vscodeStub.workspace.workspaceFolders = [{ uri: { fsPath: cwd } }];
  vscodeStub.__openedUris.length = 0;
  const context = { subscriptions: [] };
  await extension.activate(context);

  assert.equal(vscodeStub.__openedUris.length, 1);
  assert.match(vscodeStub.__openedUris[0], /vscode:\/\/anthropic\.claude-code\/open\?session=session-abc$/);

  vscodeStub.workspace.workspaceFolders = undefined;
  vscodeStub.workspace.getConfiguration = () => ({
    get: (key, fallback) => fallback,
    inspect: () => ({ workspaceValue: undefined, globalValue: undefined }),
  });
});
