import { test } from 'node:test';
import assert from 'node:assert/strict';
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

test('activate registers the three contributed commands', async () => {
  const context = { subscriptions: [] };
  await extension.activate(context);

  const ids = vscodeStub.__registeredCommands.map((c) => c.id).sort();
  assert.deepEqual(ids, ['agent-sync.doctor', 'agent-sync.link', 'agent-sync.sync']);
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
