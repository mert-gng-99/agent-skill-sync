import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runDoctor } from '../src/doctor.mjs';

async function fixture() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'as-doctor-'));
  const syncRoot = path.join(base, 'drive');
  const local = path.join(base, 'staged-shared');
  await fs.mkdir(syncRoot, { recursive: true });
  await fs.mkdir(local, { recursive: true });
  return { syncRoot, local };
}

function conflictCheck(checks) {
  return checks.find((c) => c.name === 'unresolved sync conflicts');
}

test('doctor finds conflict copies in the local trees, where they now live', async () => {
  const { syncRoot, local } = await fixture();
  await fs.writeFile(path.join(local, 'settings-shared.conflict-pc-20260813-0642.json'), '{}');

  const check = conflictCheck(await runDoctor({ syncRoot, localRoots: [{ dir: local }] }));
  assert.equal(check.status, 'warn');
  assert.match(check.details, /conflict-pc/);
});

test('doctor reports none when the local trees are clean', async () => {
  const { syncRoot, local } = await fixture();
  await fs.writeFile(path.join(local, 'settings-shared.json'), '{}');

  const check = conflictCheck(await runDoctor({ syncRoot, localRoots: [{ dir: local }] }));
  assert.equal(check.status, 'ok');
  assert.equal(check.details, 'none');
});
