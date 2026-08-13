import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveIdentity, newProjectId, MARKER_FILENAME } from '../src/identity.mjs';
import { upsertProject, loadRegistry, saveRegistry, registryPath } from '../src/registry.mjs';

const registry = {
  version: 1,
  projects: {
    'avukatsite-7f3a9c': {
      name: 'avukatsite',
      gitRemote: 'https://github.com/u/avukatsite.git',
      paths: {},
    },
    'site-111111': { name: 'site', paths: {} },
    'site-222222': { name: 'site', paths: {} },
  },
};

test('an existing marker wins over everything else', () => {
  const r = resolveIdentity({ folderName: 'anything', marker: 'avukatsite-7f3a9c', gitRemote: null, registry });
  assert.deepEqual(r, { id: 'avukatsite-7f3a9c', source: 'marker', ambiguous: false });
});

test('git remote links a differently-located clone to the same project', () => {
  const r = resolveIdentity({
    folderName: 'avukatsite-copy',
    marker: null,
    gitRemote: 'https://github.com/u/avukatsite.git',
    registry,
  });
  assert.deepEqual(r, { id: 'avukatsite-7f3a9c', source: 'gitRemote', ambiguous: false });
});

test('a unique folder name links the project on a second machine', () => {
  const r = resolveIdentity({ folderName: 'avukatsite', marker: null, gitRemote: null, registry });
  assert.deepEqual(r, { id: 'avukatsite-7f3a9c', source: 'folderName', ambiguous: false });
});

test('an ambiguous folder name creates a new id and flags it', () => {
  const r = resolveIdentity({ folderName: 'site', marker: null, gitRemote: null, registry });
  assert.equal(r.source, 'new');
  assert.equal(r.ambiguous, true);
  assert.match(r.id, /^site-[a-f0-9]{6}$/);
});

test('an unknown project gets a fresh id without being flagged', () => {
  const r = resolveIdentity({ folderName: 'brandnew', marker: null, gitRemote: null, registry });
  assert.equal(r.source, 'new');
  assert.equal(r.ambiguous, false);
});

test('generated ids are filesystem safe', () => {
  assert.match(newProjectId("Drive'ım Projesi"), /^drive-m-projesi-[a-f0-9]{6}$/);
});

test('upsertProject records this machine path without dropping the others', () => {
  const reg = upsertProject(
    { version: 1, projects: { x: { name: 'x', paths: { pc: 'C:\\x' } } } },
    { id: 'x', name: 'x', gitRemote: null, machineId: 'macbook', absPath: '/x' }
  );
  assert.deepEqual(reg.projects.x.paths, { pc: 'C:\\x', macbook: '/x' });
});

test('MARKER_FILENAME is .claude-project-id', () => {
  assert.equal(MARKER_FILENAME, '.claude-project-id');
});

test('loadRegistry and saveRegistry round-trip to disk', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-reg-'));
  const p = registryPath(tmpDir);
  assert.ok(p.endsWith('registry.json'));

  const emptyReg = await loadRegistry(tmpDir);
  assert.deepEqual(emptyReg, { version: 1, projects: {} });

  const testReg = { version: 1, projects: { p1: { name: 'test', paths: { m1: '/path' } } } };
  await saveRegistry(tmpDir, testReg);

  const loaded = await loadRegistry(tmpDir);
  assert.equal(loaded.projects.p1.name, 'test');
});
