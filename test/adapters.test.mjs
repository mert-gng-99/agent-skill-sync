import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ADAPTERS, byId, selectAdapters, planWrites, applyAdapters } from '../src/adapters/index.mjs';
import { claude } from '../src/adapters/claude.mjs';
import { slugForPath, stagedTranscriptsDir, stagedSkillsDir, stagedMemoryDir } from '../src/paths.mjs';
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

test('codex exposes a project skills directory Codex CLI actually reads', () => {
  // Confirmed against https://learn.chatgpt.com/docs/build-skills: Codex CLI
  // looks for skills under .agents/skills/ at the repo root (also checks
  // $HOME/.agents/skills and a couple of other locations).
  const cwd = path.join(path.sep, 'proj');
  assert.equal(byId('codex').projectSkillsDir(cwd), path.join(cwd, '.agents', 'skills'));
});

test('claude exposes a global skills directory, not a per-project one', () => {
  // Unlike codex's .agents/skills, ~/.claude/skills is shared by every
  // project on the machine - two different cwds must resolve to the same
  // path so planWrites's dedupe-by-path collapses them into a single write.
  const cwdA = path.join(path.sep, 'proj-a');
  const cwdB = path.join(path.sep, 'proj-b');
  const dir = byId('claude').projectSkillsDir(cwdA);
  assert.equal(dir, path.join(os.homedir(), '.claude', 'skills'));
  assert.equal(dir, byId('claude').projectSkillsDir(cwdB));
});

test('adapters without confirmed skill support declare none', () => {
  // Only claude and codex are confirmed (see above). Claiming this for the
  // others without verifying would silently write files nothing reads.
  for (const id of ['opencode', 'gemini', 'aider', 'cursor']) {
    assert.equal(typeof byId(id).projectSkillsDir, 'undefined', `${id} must not claim skill support`);
  }
});

test('applyAdapters distributes staged skills into ~/.claude/skills end to end', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'as-skills-e2e-'));
  await fs.mkdir(path.join(stagedSkillsDir(), 'hallmark'), { recursive: true });
  await fs.writeFile(path.join(stagedSkillsDir(), 'hallmark', 'SKILL.md'), '# hallmark');

  await applyAdapters({
    config: { targets: ['claude'] },
    projectId: 'proj-skills-e2e-1',
    cwd,
    dryRun: false,
  });

  const content = await fs.readFile(
    path.join(os.homedir(), '.claude', 'skills', 'hallmark', 'SKILL.md'),
    'utf8'
  );
  assert.equal(content, '# hallmark');
});

test('applyAdapters skill distribution is an overlay: pre-existing unmanaged skills survive', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'as-skills-overlay-'));
  const localSkills = path.join(os.homedir(), '.claude', 'skills');
  await fs.mkdir(path.join(localSkills, 'hand-written'), { recursive: true });
  await fs.writeFile(path.join(localSkills, 'hand-written', 'SKILL.md'), '# not managed by sync');
  await fs.mkdir(path.join(stagedSkillsDir(), 'synced'), { recursive: true });
  await fs.writeFile(path.join(stagedSkillsDir(), 'synced', 'SKILL.md'), '# synced');

  await applyAdapters({
    config: { targets: ['claude'] },
    projectId: 'proj-skills-overlay-1',
    cwd,
    dryRun: false,
  });

  assert.equal(
    await fs.readFile(path.join(localSkills, 'hand-written', 'SKILL.md'), 'utf8'),
    '# not managed by sync'
  );
  assert.equal(
    await fs.readFile(path.join(localSkills, 'synced', 'SKILL.md'), 'utf8'),
    '# synced'
  );
});

test('planWrites includes a skills-dir entry only for codex', () => {
  const cwd = path.join(path.sep, 'proj');
  const writes = planWrites({ adapters: selectAdapters(['codex', 'gemini']), projectId: 'p', cwd });
  const skillsWrite = writes.find((w) => w.kind === 'skills-dir');
  assert.ok(skillsWrite);
  assert.equal(skillsWrite.adapter, 'codex');
  assert.equal(skillsWrite.file, path.join(cwd, '.agents', 'skills'));
});

test('applyAdapters delivers skill folders where Codex CLI actually looks for them', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'as-codex-skills-'));
  await fs.mkdir(path.join(stagedSkillsDir(), 'demo-skill'), { recursive: true });
  await fs.writeFile(
    path.join(stagedSkillsDir(), 'demo-skill', 'SKILL.md'),
    '---\nname: demo-skill\ndescription: for testing\n---\ndo the thing\n'
  );

  await applyAdapters({ config: { targets: ['codex'] }, projectId: 'p', cwd, dryRun: false });

  const landed = await fs.readFile(path.join(cwd, '.agents', 'skills', 'demo-skill', 'SKILL.md'), 'utf8');
  assert.match(landed, /demo-skill/);
});

test('the file written for Cursor starts with alwaysApply frontmatter', async () => {
  // Cursor ignores a .mdc rule file with no frontmatter (confirmed against
  // https://cursor.com/docs/rules, 2026-08) - without this the memory digest
  // would land on disk but Cursor would never actually load it.
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'as-cursor-frontmatter-'));
  await applyAdapters({ config: { targets: ['cursor'] }, projectId: 'p', cwd, dryRun: false });

  const content = await fs.readFile(path.join(cwd, '.cursor', 'rules', 'agent-sync.mdc'), 'utf8');
  assert.ok(content.startsWith('---\n'));
  assert.match(content, /alwaysApply: true/);
  assert.match(content, /agent-sync:begin/);
});

test('gemini and aider are plain markdown, no frontmatter added', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'as-no-frontmatter-'));
  await applyAdapters({ config: { targets: ['gemini', 'aider'] }, projectId: 'p', cwd, dryRun: false });

  const gemini = await fs.readFile(path.join(cwd, 'GEMINI.md'), 'utf8');
  const aider = await fs.readFile(path.join(cwd, 'CONVENTIONS.md'), 'utf8');
  assert.ok(!gemini.startsWith('---\n'));
  assert.ok(!aider.startsWith('---\n'));
});

test('a hand-written Cursor frontmatter (custom description or globs) is never overwritten', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'as-cursor-custom-frontmatter-'));
  const file = path.join(cwd, '.cursor', 'rules', 'agent-sync.mdc');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, '---\ndescription: my own rule\nglobs: "*.ts"\n---\n\nold body\n');

  await applyAdapters({ config: { targets: ['cursor'] }, projectId: 'p', cwd, dryRun: false });

  const content = await fs.readFile(file, 'utf8');
  assert.match(content, /description: my own rule/);
  assert.match(content, /globs: "\*\.ts"/);
});

test('collect drops a memory note the user deleted, instead of resurrecting it forever', async () => {
  // Reproduces a real incident: fs.cp only overlays, so a note deleted from
  // Claude's memory dir stayed in the staged copy forever and got written
  // straight back on every later sync, even with no other machine involved.
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'as-collect-delete-'));
  const localMemoryDir = path.join(os.homedir(), '.claude', 'projects', slugForPath(cwd), 'memory');
  await fs.mkdir(localMemoryDir, { recursive: true });
  await fs.writeFile(path.join(localMemoryDir, 'keep.md'), 'keep');
  await fs.writeFile(path.join(localMemoryDir, 'delete-me.md'), 'gone soon');

  await claude.collect({ projectId: 'proj-delete-1', cwd, config: {} });
  assert.deepEqual(
    (await fs.readdir(stagedMemoryDir('proj-delete-1'))).sort(),
    ['delete-me.md', 'keep.md']
  );

  await fs.rm(path.join(localMemoryDir, 'delete-me.md'));
  await claude.collect({ projectId: 'proj-delete-1', cwd, config: {} });

  assert.deepEqual(await fs.readdir(stagedMemoryDir('proj-delete-1')), ['keep.md']);
});

test('collect drops a skill folder the user removed', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'as-collect-skill-delete-'));
  const skillsDir = path.join(os.homedir(), '.claude', 'skills');
  await fs.mkdir(path.join(skillsDir, 'old-skill'), { recursive: true });
  await fs.writeFile(path.join(skillsDir, 'old-skill', 'SKILL.md'), '# old');

  await claude.collect({ projectId: 'proj-delete-2', cwd, config: {} });
  assert.ok((await fs.readdir(stagedSkillsDir())).includes('old-skill'));

  await fs.rm(path.join(skillsDir, 'old-skill'), { recursive: true });
  await claude.collect({ projectId: 'proj-delete-2', cwd, config: {} });

  assert.ok(!(await fs.readdir(stagedSkillsDir())).includes('old-skill'));
});

test('mostRecentSessionId returns null when the project has no transcripts yet', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'as-resume-empty-'));
  assert.equal(await claude.mostRecentSessionId(cwd), null);
});

test('mostRecentSessionId picks the newest .jsonl by mtime, not by name', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'as-resume-'));
  const dir = path.join(os.homedir(), '.claude', 'projects', slugForPath(cwd));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'zzz-older.jsonl'), '{}');
  await fs.writeFile(path.join(dir, 'aaa-newer.jsonl'), '{}');
  // Force a deterministic mtime order regardless of how fast these two
  // writes landed - alphabetically "zzz" would sort last, so this also
  // proves the function sorts by time, not by name.
  const older = new Date(Date.now() - 60_000);
  const newer = new Date();
  await fs.utimes(path.join(dir, 'zzz-older.jsonl'), older, older);
  await fs.utimes(path.join(dir, 'aaa-newer.jsonl'), newer, newer);

  assert.equal(await claude.mostRecentSessionId(cwd), 'aaa-newer');
});
