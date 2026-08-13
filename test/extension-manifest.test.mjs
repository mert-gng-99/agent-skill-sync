import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, 'extension', 'package.json'), 'utf8')
);

test('declares the three commands the README promises', () => {
  const ids = manifest.contributes.commands.map((c) => c.command).sort();
  assert.deepEqual(ids, ['agent-sync.doctor', 'agent-sync.link', 'agent-sync.sync']);
});

test('activates on startup so window events can be observed', () => {
  assert.ok(manifest.activationEvents.includes('onStartupFinished'));
});

test('exposes syncRoot, machineId and targets as settings', () => {
  const keys = Object.keys(manifest.contributes.configuration.properties).sort();
  assert.deepEqual(keys, ['agent-sync.machineId', 'agent-sync.syncRoot', 'agent-sync.targets']);
});

test('has no runtime dependencies, matching the engine', () => {
  assert.deepEqual(manifest.dependencies ?? {}, {});
});

test('the extension performs both halves of the round trip', () => {
  const source = fs.readFileSync(
    path.join(root, 'extension', 'extension.mjs'), 'utf8'
  );
  // Without collectFromTools the extension can only pull: nothing the user
  // authored during the session would ever reach syncRoot.
  assert.match(source, /collectFromTools/);
  assert.match(source, /applyAdapters/);
});

test('window blur triggers a sync, not only focus', () => {
  const source = fs.readFileSync(
    path.join(root, 'extension', 'extension.mjs'), 'utf8'
  );
  const handler = source.slice(source.indexOf('onDidChangeWindowState'));
  assert.ok(
    !/if\s*\(\s*s\.focused\s*\)\s*sync/.test(handler),
    'blur must also sync - a focus-only guard drops the push'
  );
});
