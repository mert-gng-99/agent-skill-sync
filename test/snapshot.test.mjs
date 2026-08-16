import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { takeSnapshot } from '../src/snapshot.mjs';
import { useIsolatedHome } from './helpers/isolated-home.mjs';
import { homeDir } from '../src/paths.mjs';

useIsolatedHome();

async function makeSourceDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'as-snapshot-src-'));
  await fs.writeFile(path.join(dir, 'note.md'), 'hello');
  return dir;
}

test('takeSnapshot copies each pair under a timestamped directory', async () => {
  const dir = await makeSourceDir();
  const target = await takeSnapshot([{ name: 'skills', dir }], 20);
  const content = await fs.readFile(path.join(target, 'skills', 'note.md'), 'utf8');
  assert.equal(content, 'hello');
});

test('takeSnapshot prunes down to snapshotKeep, oldest first', async () => {
  const dir = await makeSourceDir();
  const root = path.join(homeDir(), 'snapshots');
  // Pre-seed fake older snapshots - sorted lexicographically like real
  // ISO-stamped ones, so "a-oldest".."c-old" are the ones due for pruning.
  for (const name of ['a-oldest', 'b-old', 'c-old']) {
    await fs.mkdir(path.join(root, name), { recursive: true });
  }
  await takeSnapshot([{ name: 'skills', dir }], 2);

  const remaining = (await fs.readdir(root)).sort();
  assert.equal(remaining.length, 2);
  assert.ok(!remaining.includes('a-oldest'), 'oldest snapshot should have been pruned');
});

test('takeSnapshot does not throw when a source directory does not exist yet', async () => {
  const missing = path.join(os.tmpdir(), 'as-snapshot-does-not-exist');
  await assert.doesNotReject(() => takeSnapshot([{ name: 'skills', dir: missing }], 20));
});

test('a snapshot that cannot be pruned is skipped, not thrown - see EPERM on Windows', async () => {
  // Reproduces a real crash: a file inside an old snapshot locked by an
  // antivirus scan or indexer made fs.rm reject with EPERM, and since
  // takeSnapshot had no catch around the prune loop, that aborted the
  // whole pull/push it was only supposed to be a safety net for.
  const dir = await makeSourceDir();
  const root = path.join(homeDir(), 'snapshots');
  await fs.mkdir(path.join(root, 'a-oldest'), { recursive: true });
  await fs.mkdir(path.join(root, 'b-old'), { recursive: true });

  const { rm: realRm } = fs;
  fs.rm = async (target, opts) => {
    if (String(target).includes('a-oldest')) {
      const err = new Error('operation not permitted');
      err.code = 'EPERM';
      throw err;
    }
    return realRm(target, opts);
  };
  try {
    await assert.doesNotReject(() => takeSnapshot([{ name: 'skills', dir }], 1));
  } finally {
    fs.rm = realRm;
  }
});
