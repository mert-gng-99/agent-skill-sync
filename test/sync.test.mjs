import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { syncPairs, runSync, withoutConflictArtifacts } from '../src/sync.mjs';
import { isConflictArtifact } from '../src/apply.mjs';
import { useIsolatedHome } from './helpers/isolated-home.mjs';
import { stagedSharedDir } from '../src/paths.mjs';

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

test('the transcripts pair only exists when syncTranscripts is enabled', () => {
  const off = syncPairs({ syncRoot: '/sync', machineId: 'macbook', syncTranscripts: false });
  assert.ok(!off.some((p) => p.name === 'transcripts'), 'must be absent, not just empty - cost is zero');

  const on = syncPairs({ syncRoot: '/sync', machineId: 'macbook', syncTranscripts: true });
  const pair = on.find((p) => p.name === 'transcripts');
  assert.ok(pair);
  assert.ok(pair.remoteDir.startsWith('/sync'));
});

test('the vault pair only exists when vaultPath is set', () => {
  const off = syncPairs({ syncRoot: '/sync', machineId: 'macbook', vaultPath: '' });
  assert.ok(!off.some((p) => p.name === 'vault'), 'must be absent, not just empty - cost is zero');

  const on = syncPairs({ syncRoot: '/sync', machineId: 'macbook', vaultPath: '/Users/x/Documents/EchoOS' });
  const pair = on.find((p) => p.name === 'vault');
  assert.ok(pair);
  assert.equal(pair.localDir, '/Users/x/Documents/EchoOS');
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

const FAKE_KEY = 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

async function stagedFixture() {
  await fs.rm(stagedSharedDir(), { recursive: true, force: true });
  await fs.mkdir(stagedSharedDir(), { recursive: true });
  await fs.writeFile(path.join(stagedSharedDir(), 'safe.md'), 'We chose Postgres.');
  await fs.writeFile(path.join(stagedSharedDir(), 'leaky.md'), `API key: ${FAKE_KEY}\n`);
  const syncRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'as-secret-root-'));
  return { syncRoot, config: { syncRoot, machineId: 'macbook', targets: [], snapshotKeep: 5 } };
}

test('a staged file that looks like a secret is withheld from the push', async () => {
  const { syncRoot, config } = await stagedFixture();
  const res = await runSync({ config, dryRun: false });

  assert.deepEqual(res.blocked.map((b) => b.relPath), ['leaky.md']);
  assert.ok(res.plan.some((p) => p.relPath === 'safe.md'), 'clean file must still be planned');
  assert.ok(!res.plan.some((p) => p.relPath === 'leaky.md'), 'blocked file must leave the plan');

  await fs.readFile(path.join(syncRoot, 'shared', 'safe.md'), 'utf8');
  await assert.rejects(
    () => fs.readFile(path.join(syncRoot, 'shared', 'leaky.md')),
    'the secret must never reach syncRoot'
  );
});

test('the withheld file stays on disk locally - nothing is destroyed', async () => {
  const { config } = await stagedFixture();
  await runSync({ config, dryRun: false });
  const kept = await fs.readFile(path.join(stagedSharedDir(), 'leaky.md'), 'utf8');
  assert.match(kept, /sk-ant-api03/);
});

test('force pushes the flagged file anyway, for false positives', async () => {
  const { syncRoot, config } = await stagedFixture();
  const res = await runSync({ config, dryRun: false, force: true });

  assert.deepEqual(res.blocked, []);
  const landed = await fs.readFile(path.join(syncRoot, 'shared', 'leaky.md'), 'utf8');
  assert.match(landed, /sk-ant-api03/);
});

test('secrets already in syncRoot are still pulled - the gate is outbound only', async () => {
  const { syncRoot, config } = await stagedFixture();
  await fs.rm(stagedSharedDir(), { recursive: true, force: true });
  await fs.mkdir(path.join(syncRoot, 'shared'), { recursive: true });
  await fs.writeFile(path.join(syncRoot, 'shared', 'inbound.md'), `key: ${FAKE_KEY}\n`);

  const res = await runSync({ config, dryRun: false });
  assert.deepEqual(res.blocked, []);
  await fs.readFile(path.join(stagedSharedDir(), 'inbound.md'), 'utf8');
});
