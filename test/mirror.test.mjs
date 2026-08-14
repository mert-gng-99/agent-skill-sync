import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mirrorDir } from '../src/mirror.mjs';

async function fixture() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'as-mirror-'));
  const src = path.join(base, 'src');
  const dest = path.join(base, 'dest');
  await fs.mkdir(src, { recursive: true });
  return { src, dest };
}

test('copies everything from src into dest', async () => {
  const { src, dest } = await fixture();
  await fs.writeFile(path.join(src, 'a.md'), 'hello');
  await mirrorDir(src, dest);
  assert.equal(await fs.readFile(path.join(dest, 'a.md'), 'utf8'), 'hello');
});

test('removes a file from dest that no longer exists in src - the actual bug', async () => {
  // Reproduces: a user deletes a memory note or a skill folder, and the next
  // sync brought it right back because the old copy step only ever added
  // files, never removed the ones that vanished from the source.
  const { src, dest } = await fixture();
  await fs.mkdir(dest, { recursive: true });
  await fs.writeFile(path.join(dest, 'stale.md'), 'should be gone');
  await fs.writeFile(path.join(src, 'kept.md'), 'kept');

  await mirrorDir(src, dest);

  await assert.rejects(() => fs.readFile(path.join(dest, 'stale.md')));
  assert.equal(await fs.readFile(path.join(dest, 'kept.md'), 'utf8'), 'kept');
});

test('removes a whole subfolder from dest that no longer exists in src', async () => {
  const { src, dest } = await fixture();
  await fs.mkdir(path.join(dest, 'old-skill'), { recursive: true });
  await fs.writeFile(path.join(dest, 'old-skill', 'SKILL.md'), '# old');
  await fs.mkdir(path.join(src, 'new-skill'), { recursive: true });
  await fs.writeFile(path.join(src, 'new-skill', 'SKILL.md'), '# new');

  await mirrorDir(src, dest);

  await assert.rejects(() => fs.readdir(path.join(dest, 'old-skill')));
  assert.equal(
    await fs.readFile(path.join(dest, 'new-skill', 'SKILL.md'), 'utf8'),
    '# new'
  );
});

test('a missing source clears dest rather than throwing', async () => {
  const { dest } = await fixture();
  await fs.mkdir(dest, { recursive: true });
  await fs.writeFile(path.join(dest, 'stale.md'), 'x');
  const missingSrc = path.join(dest, '..', 'does-not-exist');

  await mirrorDir(missingSrc, dest);

  // Callers already treat "directory missing" the same as "empty" via
  // .catch(() => []) - matches every other reader in this codebase.
  assert.deepEqual(await fs.readdir(dest).catch(() => []), []);
});

test('a missing destination is created fresh, not an error', async () => {
  const { src, dest } = await fixture();
  await fs.writeFile(path.join(src, 'a.md'), 'hi');
  await mirrorDir(src, dest); // dest never existed
  assert.equal(await fs.readFile(path.join(dest, 'a.md'), 'utf8'), 'hi');
});
