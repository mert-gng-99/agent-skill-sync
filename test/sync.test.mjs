import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { syncPairs, runSync, withoutConflictArtifacts } from '../src/sync.mjs';
import { isConflictArtifact } from '../src/apply.mjs';
import { useIsolatedHome } from './helpers/isolated-home.mjs';

useIsolatedHome();

test('the suite runs against an isolated home, never the real one', () => {
  assert.match(process.env.HOME, /agent-sync-home-/);
});

test('pairs cover skills, global memory and shared docs', () => {
  const pairs = syncPairs({ syncRoot: '/sync', machineId: 'macbook' });
  const names = pairs.map((p) => p.name).sort();
  assert.deepEqual(names, ['memory', 'shared', 'skills']);
});

test('every pair maps a local directory to a remote one', () => {
  for (const pair of syncPairs({ syncRoot: '/sync', machineId: 'macbook' })) {
    assert.ok(pair.localDir.length > 0, `${pair.name} needs a localDir`);
    assert.ok(pair.remoteDir.startsWith('/sync'), `${pair.name} must live under syncRoot`);
  }
});

test('runSync executes end-to-end sync plan', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-sync-run-'));
  const config = { syncRoot: tmpRoot, machineId: 'macbook', snapshotKeep: 5 };
  const res = await runSync({ config, dryRun: false });
  assert.ok(Array.isArray(res.plan));
  assert.ok(Array.isArray(res.conflicts));
});

test('conflict artifacts are recognised by their filename', () => {
  assert.equal(isConflictArtifact('shared/settings-shared.conflict-pc-20260813-0632.json'), true);
  assert.equal(isConflictArtifact('memory/p/note.conflict-macbook-20260101-0000.md'), true);
  assert.equal(isConflictArtifact('shared/settings-shared.json'), false);
  assert.equal(isConflictArtifact('memory/p/note.md'), false);
});

test('sync drops conflict artifacts from both sides so they are never propagated', () => {
  const manifest = new Map([
    ['note.md', 'h1'],
    ['note.conflict-pc-20260813-0632.md', 'h2'],
    ['deep/other.md', 'h3'],
  ]);
  assert.deepEqual([...withoutConflictArtifacts(manifest).keys()].sort(), ['deep/other.md', 'note.md']);
});
