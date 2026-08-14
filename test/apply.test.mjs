import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ACTION } from '../src/sync-engine.mjs';
import { conflictName, applyPlan } from '../src/apply.mjs';

test('conflict filename keeps the extension and stamps the machine', () => {
  const name = conflictName('memory/x/note.md', 'macbook', new Date('2026-08-12T09:30:00Z'));
  assert.equal(name, 'memory/x/note.conflict-macbook-20260812-0930.md');
});

test('conflict filename handles files without an extension', () => {
  const name = conflictName('LICENSE', 'pc', new Date('2026-08-12T09:30:00Z'));
  assert.equal(name, 'LICENSE.conflict-pc-20260812-0930');
});

async function roots() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-apply-'));
  const localRoot = path.join(base, 'local');
  const remoteRoot = path.join(base, 'remote');
  await fs.mkdir(localRoot, { recursive: true });
  await fs.mkdir(remoteRoot, { recursive: true });
  return { localRoot, remoteRoot };
}

test('push copies local to remote, creating parent directories', async () => {
  const { localRoot, remoteRoot } = await roots();
  await fs.mkdir(path.join(localRoot, 'deep'), { recursive: true });
  await fs.writeFile(path.join(localRoot, 'deep', 'a.md'), 'local');
  await applyPlan([{ relPath: 'deep/a.md', action: ACTION.PUSH }], {
    localRoot, remoteRoot, machineId: 'macbook', dryRun: false,
  });
  assert.equal(await fs.readFile(path.join(remoteRoot, 'deep', 'a.md'), 'utf8'), 'local');
});

test('conflict preserves both sides', async () => {
  const { localRoot, remoteRoot } = await roots();
  await fs.writeFile(path.join(localRoot, 'n.md'), 'mine');
  await fs.writeFile(path.join(remoteRoot, 'n.md'), 'theirs');
  const res = await applyPlan([{ relPath: 'n.md', action: ACTION.CONFLICT }], {
    localRoot, remoteRoot, machineId: 'macbook', dryRun: false,
  });
  assert.equal(await fs.readFile(path.join(localRoot, 'n.md'), 'utf8'), 'theirs');
  const kept = res.conflicts[0].keptAs;
  assert.equal(await fs.readFile(path.join(localRoot, kept), 'utf8'), 'mine');
});

test('dryRun touches nothing', async () => {
  const { localRoot, remoteRoot } = await roots();
  await fs.writeFile(path.join(localRoot, 'a.md'), 'local');
  await applyPlan([{ relPath: 'a.md', action: ACTION.PUSH }], {
    localRoot, remoteRoot, machineId: 'macbook', dryRun: true,
  });
  await assert.rejects(() => fs.readFile(path.join(remoteRoot, 'a.md')));
});

test('dryRun still previews a real conflict filename, not null', async () => {
  // Confirmed live: `agent-sync push --dry-run` printed
  // "your version kept as null" because this path never computed a name.
  const { localRoot, remoteRoot } = await roots();
  const res = await applyPlan([{ relPath: 'n.md', action: ACTION.CONFLICT }], {
    localRoot, remoteRoot, machineId: 'macbook', dryRun: true,
  });
  assert.match(res.conflicts[0].keptAs, /^n\.conflict-macbook-\d{8}-\d{4}\.md$/);
});
