import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { syncPairs, runSync } from '../src/sync.mjs';

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
