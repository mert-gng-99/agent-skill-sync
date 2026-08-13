import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectManifest, IGNORED_NAMES } from '../src/manifest.mjs';
import { takeSnapshot } from '../src/snapshot.mjs';
import { useIsolatedHome } from './helpers/isolated-home.mjs';

useIsolatedHome();

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-manifest-'));
  await fs.mkdir(path.join(dir, 'nested'), { recursive: true });
  await fs.writeFile(path.join(dir, 'a.md'), 'hello');
  await fs.writeFile(path.join(dir, 'nested', 'b.md'), 'world');
  await fs.writeFile(path.join(dir, '.DS_Store'), 'junk');
  await fs.writeFile(path.join(dir, 'state.json'), '{}');
  return dir;
}

test('walks nested files and hashes them', async () => {
  const dir = await fixture();
  const m = await collectManifest(dir);
  assert.deepEqual([...m.keys()].sort(), ['a.md', 'nested/b.md']);
  assert.match(m.get('a.md'), /^[a-f0-9]{64}$/);
});

test('identical content in different files hashes the same', async () => {
  const dir = await fixture();
  await fs.writeFile(path.join(dir, 'copy.md'), 'hello');
  const m = await collectManifest(dir);
  assert.equal(m.get('copy.md'), m.get('a.md'));
});

test('missing directory yields an empty manifest instead of throwing', async () => {
  const m = await collectManifest(path.join(os.tmpdir(), 'cs-does-not-exist-12345'));
  assert.equal(m.size, 0);
});

test('ignored names include system files and state/config json', () => {
  assert.ok(IGNORED_NAMES.has('.DS_Store'));
  assert.ok(IGNORED_NAMES.has('Thumbs.db'));
  assert.ok(IGNORED_NAMES.has('state.json'));
  assert.ok(IGNORED_NAMES.has('config.json'));
});

test('skips .git directories entirely - a skill cloned from a repo must not sync its internals', async () => {
  const dir = await fixture();
  await fs.mkdir(path.join(dir, '.git', 'objects'), { recursive: true });
  await fs.writeFile(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main');
  await fs.writeFile(path.join(dir, '.git', 'objects', 'deadbeef'), 'blob');
  await fs.mkdir(path.join(dir, 'nested', '.git'), { recursive: true });
  await fs.writeFile(path.join(dir, 'nested', '.git', 'config'), '[core]');

  const m = await collectManifest(dir);
  assert.deepEqual([...m.keys()].sort(), ['a.md', 'nested/b.md']);
});

test('takeSnapshot creates snapshot directory and copies pairs', async () => {
  const dir = await fixture();
  const snapPath = await takeSnapshot([{ name: 'test-src', dir }], 5);
  assert.ok(snapPath.includes('snapshots'));
  const content = await fs.readFile(path.join(snapPath, 'test-src', 'a.md'), 'utf8');
  assert.equal(content, 'hello');
});
