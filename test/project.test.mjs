import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readMarker, readGitRemote, addToGitExclude, ensureIdentity, linkProject, forgetFile } from '../src/project.mjs';
import { useIsolatedHome } from './helpers/isolated-home.mjs';

useIsolatedHome();

test('reads and trims a marker file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-proj-'));
  await fs.writeFile(path.join(dir, '.claude-project-id'), 'avukatsite-7f3a9c\n');
  assert.equal(await readMarker(dir), 'avukatsite-7f3a9c');
});

test('a directory with no marker reads as null', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-proj-'));
  assert.equal(await readMarker(dir), null);
});

test('marker is excluded via .git/info/exclude, never .gitignore', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-proj-'));
  await fs.mkdir(path.join(dir, '.git', 'info'), { recursive: true });
  await fs.writeFile(path.join(dir, '.gitignore'), 'node_modules\n');
  await addToGitExclude(dir, '.claude-project-id');
  const exclude = await fs.readFile(path.join(dir, '.git', 'info', 'exclude'), 'utf8');
  assert.match(exclude, /\.claude-project-id/);
  assert.equal(await fs.readFile(path.join(dir, '.gitignore'), 'utf8'), 'node_modules\n');
});

test('excluding twice does not duplicate the entry', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-proj-'));
  await fs.mkdir(path.join(dir, '.git', 'info'), { recursive: true });
  await addToGitExclude(dir, '.claude-project-id');
  await addToGitExclude(dir, '.claude-project-id');
  const exclude = await fs.readFile(path.join(dir, '.git', 'info', 'exclude'), 'utf8');
  assert.equal(exclude.match(/\.claude-project-id/g).length, 1);
});

test('a non-git directory is left completely alone', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-proj-'));
  await addToGitExclude(dir, '.claude-project-id');
  assert.deepEqual(await fs.readdir(dir), []);
});

test('ensureIdentity resolves identity and writes marker and registry', async () => {
  const syncRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-sync-root-'));
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-work-'));
  const config = { syncRoot, machineId: 'macbook' };
  const identity = await ensureIdentity(config, cwd);
  assert.ok(identity.id.length > 0);
  assert.equal(await readMarker(cwd), identity.id);
});

test('linkProject links folder to existing project id', async () => {
  const syncRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-sync-root-'));
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-work-'));
  const config = { syncRoot, machineId: 'macbook' };
  const regPath = path.join(syncRoot, 'registry.json');
  await fs.writeFile(regPath, JSON.stringify({ version: 1, projects: { 'p-123': { name: 'p', paths: {} } } }));

  const code = await linkProject(config, cwd, 'p-123');
  assert.equal(code, 0);
  assert.equal(await readMarker(cwd), 'p-123');
});

test('forgetFile deletes targets in syncRoot and staged', async () => {
  const syncRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-sync-root-'));
  const fileInSync = path.join(syncRoot, 'shared', 'old.md');
  await fs.mkdir(path.dirname(fileInSync), { recursive: true });
  await fs.writeFile(fileInSync, 'old content');

  const config = { syncRoot, machineId: 'macbook' };
  const code = await forgetFile(config, 'shared/old.md', false);
  assert.equal(code, 0);
  await assert.rejects(() => fs.readFile(fileInSync));
});
