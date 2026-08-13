import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DEFAULT_CONFIG, validateConfig, configPath, loadConfig, saveConfig } from '../src/config.mjs';

test('defaults keep transcripts off and retain 20 snapshots', () => {
  assert.equal(DEFAULT_CONFIG.syncTranscripts, false);
  assert.equal(DEFAULT_CONFIG.snapshotKeep, 20);
});

test('rejects a config without syncRoot', () => {
  const r = validateConfig({ machineId: 'macbook' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('syncRoot')));
});

test('rejects a machineId that would break conflict filenames', () => {
  const r = validateConfig({ syncRoot: '/x', machineId: 'my machine/1' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('machineId')));
});

test('rejects an unknown target id', () => {
  const r = validateConfig({ syncRoot: '/x', machineId: 'macbook', targets: ['emacs'] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('emacs')));
});

test('an empty target list is valid - sync still runs, nothing is written to tools', () => {
  assert.equal(validateConfig({ syncRoot: '/x', machineId: 'macbook', targets: [] }).ok, true);
});

test('accepts a valid config', () => {
  assert.deepEqual(
    validateConfig({ syncRoot: '/x', machineId: 'macbook', targets: ['claude', 'codex'] }),
    { ok: true, errors: [] }
  );
});

test('configPath returns path under homeDir', () => {
  const p = configPath();
  assert.ok(p.endsWith(path.join('.agent-sync', 'config.json')));
});
