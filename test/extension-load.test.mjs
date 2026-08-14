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

test('activate registers the four contributed commands', async () => {
  const context = { subscriptions: [] };
  await extension.activate(context);

  const ids = vscodeStub.__registeredCommands.map((c) => c.id).sort();
  assert.deepEqual(ids, ['agent-sync.doctor', 'agent-sync.link', 'agent-sync.projects', 'agent-sync.sync']);
  assert.ok(context.subscriptions.length > 0, 'everything registered must be disposable');
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
  await extension.activate(context); // fires an un-awaited requireExisting:true sync internally
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
