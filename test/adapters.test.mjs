import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ADAPTERS, byId, selectAdapters, planWrites } from '../src/adapters/index.mjs';

test('every known target has an adapter', () => {
  const ids = ADAPTERS.map((a) => a.id).sort();
  assert.deepEqual(ids, ['aider', 'claude', 'codex', 'cursor', 'gemini', 'opencode']);
});

test('every adapter implements the full shape', () => {
  for (const a of ADAPTERS) {
    assert.equal(typeof a.id, 'string', `${a.id}: id`);
    assert.equal(typeof a.label, 'string', `${a.id}: label`);
    assert.equal(typeof a.detect, 'function', `${a.id}: detect`);
    assert.equal(typeof a.globalInstructionsPath, 'function', `${a.id}: globalInstructionsPath`);
    assert.equal(typeof a.projectMemoryDir, 'function', `${a.id}: projectMemoryDir`);
    assert.equal(typeof a.projectInstructionsPath, 'function', `${a.id}: projectInstructionsPath`);
  }
});

test('selectAdapters honours the targets list and ignores unknown ids', () => {
  assert.deepEqual(selectAdapters(['codex', 'nope']).map((a) => a.id), ['codex']);
  assert.deepEqual(selectAdapters([]).map((a) => a.id), []);
});

test('codex and opencode both aim at AGENTS.md', () => {
  const cwd = path.join(path.sep, 'proj');
  assert.equal(byId('codex').projectInstructionsPath(cwd), path.join(cwd, 'AGENTS.md'));
  assert.equal(byId('opencode').projectInstructionsPath(cwd), path.join(cwd, 'AGENTS.md'));
});

test('planWrites deduplicates the shared AGENTS.md target', () => {
  const cwd = path.join(path.sep, 'proj');
  const writes = planWrites({
    adapters: selectAdapters(['codex', 'opencode']),
    projectId: 'p',
    cwd,
  });
  const agentsWrites = writes.filter((w) => w.file === path.join(cwd, 'AGENTS.md'));
  assert.equal(agentsWrites.length, 1);
});

test('claude writes a memory directory, the others write single files', () => {
  const cwd = path.join(path.sep, 'proj');
  assert.ok(byId('claude').projectMemoryDir(cwd));
  assert.equal(byId('gemini').projectMemoryDir(cwd), null);
  assert.equal(byId('gemini').projectInstructionsPath(cwd), path.join(cwd, 'GEMINI.md'));
  assert.equal(byId('aider').projectInstructionsPath(cwd), path.join(cwd, 'CONVENTIONS.md'));
  assert.equal(
    byId('cursor').projectInstructionsPath(cwd),
    path.join(cwd, '.cursor', 'rules', 'agent-sync.mdc')
  );
});

test('only claude declares hook support', () => {
  assert.equal(typeof byId('claude').installHooks, 'function');
  for (const a of ADAPTERS.filter((x) => x.id !== 'claude')) {
    assert.equal(a.installHooks, null, `${a.id} must not claim hook support`);
  }
});

test('only claude feeds content back to the canonical store', () => {
  assert.equal(typeof byId('claude').collect, 'function');
  for (const a of ADAPTERS.filter((x) => x.id !== 'claude')) {
    assert.equal(a.collect, undefined, `${a.id} must not write to the canonical store`);
  }
});
