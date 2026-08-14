import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KNOWN_TARGETS } from '../src/config.mjs';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

// The extension manifest lives in the repo root package.json, not in
// extension/. vsce only packages files beneath the manifest's directory, so a
// manifest inside extension/ would ship the entry point without the engine.
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const source = fs.readFileSync(path.join(root, 'extension', 'extension.cjs'), 'utf8');

test('declares the four commands the README promises', () => {
  const ids = manifest.contributes.commands.map((c) => c.command).sort();
  assert.deepEqual(ids, ['agent-sync.doctor', 'agent-sync.link', 'agent-sync.projects', 'agent-sync.sync']);
});

test('activates on startup so window events can be observed', () => {
  assert.ok(manifest.activationEvents.includes('onStartupFinished'));
});

test('exposes syncRoot, machineId, targets and syncTranscripts as settings', () => {
  const keys = Object.keys(manifest.contributes.configuration.properties).sort();
  assert.deepEqual(keys, [
    'agent-sync.machineId',
    'agent-sync.syncRoot',
    'agent-sync.syncTranscripts',
    'agent-sync.targets',
  ]);
});

test('syncTranscripts is a real checkbox, defaulting off', () => {
  const prop = manifest.contributes.configuration.properties['agent-sync.syncTranscripts'];
  assert.equal(prop.type, 'boolean');
  assert.equal(prop.default, false);
});

test('the targets setting offers a pick-list matching every known adapter', () => {
  // Keeps the Settings UI's dropdown in lockstep with config.mjs's own list -
  // a new adapter that forgets this entry is invisible in the UI, not broken.
  const targetsProp = manifest.contributes.configuration.properties['agent-sync.targets'];
  assert.deepEqual(targetsProp.items.enum.slice().sort(), [...KNOWN_TARGETS].sort());
});

test('has no runtime dependencies, matching the engine', () => {
  assert.deepEqual(manifest.dependencies ?? {}, {});
});

test('the entry point is CommonJS, which is what the extension host requires', () => {
  assert.equal(manifest.main, 'extension/extension.cjs');
  assert.ok(fs.existsSync(path.join(root, 'extension', 'extension.cjs')));
  assert.ok(
    !fs.existsSync(path.join(root, 'extension', 'extension.mjs')),
    'the ESM entry point must not linger - the host would fail to require it'
  );
});

test('packaging keeps the engine: nothing excludes src/ or bin/', () => {
  const ignore = fs.readFileSync(path.join(root, '.vscodeignore'), 'utf8');
  const lines = ignore.split(/\r?\n/).map((l) => l.trim());
  assert.ok(!lines.some((l) => l.startsWith('src')), 'src/ must ship - it is the engine');
  assert.ok(!lines.some((l) => l.startsWith('extension')), 'extension/ must ship');
});

test('the extension performs both halves of the round trip', () => {
  // Without collectFromTools the extension can only pull: nothing the user
  // authored during the session would ever reach syncRoot.
  assert.match(source, /collectFromTools/);
  assert.match(source, /applyAdapters/);
});

test('the link command lets you pick a project instead of only showing a guess', () => {
  // Previously this command only called showInformationMessage with the
  // auto-resolved guess - no way to act on it if the guess was wrong.
  const handler = source.slice(source.indexOf("registerCommand('agent-sync.link'"));
  assert.match(handler, /showQuickPick/);
  assert.match(handler, /linkProject/);
});

test('window blur triggers a sync, not only focus', () => {
  const handler = source.slice(source.indexOf('onDidChangeWindowState'));
  assert.ok(
    !/if\s*\(\s*s\.focused\s*\)\s*sync/.test(handler),
    'blur must also sync - a focus-only guard drops the push'
  );
});
