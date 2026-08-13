import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ADAPTERS, byId, selectAdapters, planWrites, applyAdapters } from '../src/adapters/index.mjs';
import { claude } from '../src/adapters/claude.mjs';
import { slugForPath, stagedTranscriptsDir } from '../src/paths.mjs';
import { useIsolatedHome } from './helpers/isolated-home.mjs';

useIsolatedHome();

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

test('collectTranscripts mirrors this project\'s session files into the canonical store, keyed by project id', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'as-transcripts-proj-'));
  const localProjectDir = path.join(os.homedir(), '.claude', 'projects', slugForPath(cwd));
  await fs.mkdir(localProjectDir, { recursive: true });
  await fs.writeFile(path.join(localProjectDir, 'session-a.jsonl'), '{"role":"user"}\n');
  await fs.writeFile(path.join(localProjectDir, 'not-a-transcript.txt'), 'ignore me');
  await fs.mkdir(path.join(localProjectDir, 'memory'), { recursive: true }); // must not be swept up too

  await claude.collectTranscripts({ projectId: 'proj-collect-1', cwd });

  const dest = stagedTranscriptsDir('proj-collect-1');
  assert.deepEqual(await fs.readdir(dest), ['session-a.jsonl']);
  assert.equal(await fs.readFile(path.join(dest, 'session-a.jsonl'), 'utf8'), '{"role":"user"}\n');
});

test('distributeTranscripts writes accumulated sessions into this machine\'s own project folder', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'as-transcripts-proj-'));
  const dest = stagedTranscriptsDir('proj-distribute-1');
  await fs.mkdir(dest, { recursive: true });
  await fs.writeFile(path.join(dest, 'session-from-other-machine.jsonl'), '{"role":"assistant"}\n');

  await claude.distributeTranscripts({ projectId: 'proj-distribute-1', cwd });

  const localProjectDir = path.join(os.homedir(), '.claude', 'projects', slugForPath(cwd));
  const content = await fs.readFile(
    path.join(localProjectDir, 'session-from-other-machine.jsonl'),
    'utf8'
  );
  assert.equal(content, '{"role":"assistant"}\n');
});

test('collect only mirrors transcripts when syncTranscripts is enabled', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'as-transcripts-proj-'));
  const localProjectDir = path.join(os.homedir(), '.claude', 'projects', slugForPath(cwd));
  await fs.mkdir(localProjectDir, { recursive: true });
  await fs.writeFile(path.join(localProjectDir, 'session-b.jsonl'), '{}');

  await claude.collect({ projectId: 'proj-gate-1', cwd, config: { syncTranscripts: false } });
  await assert.rejects(() => fs.readdir(stagedTranscriptsDir('proj-gate-1')));

  await claude.collect({ projectId: 'proj-gate-1', cwd, config: { syncTranscripts: true } });
  assert.deepEqual(await fs.readdir(stagedTranscriptsDir('proj-gate-1')), ['session-b.jsonl']);
});

test('applyAdapters distributes transcripts end to end when enabled', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'as-transcripts-e2e-'));
  const dest = stagedTranscriptsDir('proj-e2e-1');
  await fs.mkdir(dest, { recursive: true });
  await fs.writeFile(path.join(dest, 'session-x.jsonl'), '{"from":"other machine"}\n');

  await applyAdapters({
    config: { targets: ['claude'], syncTranscripts: true },
    projectId: 'proj-e2e-1',
    cwd,
    dryRun: false,
  });

  const localProjectDir = path.join(os.homedir(), '.claude', 'projects', slugForPath(cwd));
  const content = await fs.readFile(path.join(localProjectDir, 'session-x.jsonl'), 'utf8');
  assert.equal(content, '{"from":"other machine"}\n');
});

test('applyAdapters never touches transcripts when the flag is off', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'as-transcripts-e2e-off-'));
  const dest = stagedTranscriptsDir('proj-e2e-2');
  await fs.mkdir(dest, { recursive: true });
  await fs.writeFile(path.join(dest, 'session-y.jsonl'), '{}');

  await applyAdapters({
    config: { targets: ['claude'], syncTranscripts: false },
    projectId: 'proj-e2e-2',
    cwd,
    dryRun: false,
  });

  const localProjectDir = path.join(os.homedir(), '.claude', 'projects', slugForPath(cwd));
  await assert.rejects(() => fs.readFile(path.join(localProjectDir, 'session-y.jsonl')));
});
