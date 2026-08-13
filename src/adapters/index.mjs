import fs from 'node:fs/promises';
import path from 'node:path';
import { claude } from './claude.mjs';
import { codex, opencode } from './agents-md.mjs';
import { singleFileAdapter } from './simple.mjs';
import { stagedMemoryDir, stagedSkillsDir, stagedSharedDir } from '../paths.mjs';
import { renderDigest, upsertBlock } from '../render.mjs';

const gemini = singleFileAdapter({
  id: 'gemini',
  label: 'Gemini CLI',
  projectFile: 'GEMINI.md',
  globalFile: '.gemini/GEMINI.md',
  detectPath: '.gemini',
});

const aider = singleFileAdapter({
  id: 'aider',
  label: 'Aider',
  projectFile: 'CONVENTIONS.md',
  globalFile: null,
  detectPath: '.aider.conf.yml',
});

const cursor = singleFileAdapter({
  id: 'cursor',
  label: 'Cursor',
  projectFile: '.cursor/rules/agent-sync.mdc',
  globalFile: null,
  detectPath: '.cursor',
});

export const ADAPTERS = [claude, codex, opencode, gemini, aider, cursor];

export function byId(id) {
  return ADAPTERS.find((a) => a.id === id) ?? null;
}

export function selectAdapters(targets) {
  return (targets ?? []).map(byId).filter(Boolean);
}

/**
 * Works out every file each selected adapter wants written, then drops
 * duplicates by absolute path - codex and opencode both target AGENTS.md and
 * it must only be written once.
 */
export function planWrites({ adapters, projectId, cwd }) {
  const writes = [];
  const seen = new Set();
  for (const adapter of adapters) {
    const dir = adapter.projectMemoryDir(cwd);
    if (dir && !seen.has(dir)) {
      seen.add(dir);
      writes.push({ adapter: adapter.id, file: dir, kind: 'memory-dir' });
    }
    const file = adapter.projectInstructionsPath(cwd);
    if (file && !seen.has(file)) {
      seen.add(file);
      writes.push({ adapter: adapter.id, file, kind: 'digest' });
    }
  }
  return writes;
}

async function readMemoryFiles(projectId) {
  const dir = stagedMemoryDir(projectId);
  const names = (await fs.readdir(dir).catch(() => [])).filter((n) => n.endsWith('.md'));
  const files = [];
  for (const name of names.sort()) {
    files.push({ name, content: await fs.readFile(path.join(dir, name), 'utf8') });
  }
  return files;
}

export async function applyAdapters({ config, projectId, cwd, dryRun }) {
  const adapters = selectAdapters(config.targets);
  if (adapters.length === 0) return [];

  const memoryFiles = await readMemoryFiles(projectId);
  const skillNames = (await fs.readdir(stagedSkillsDir()).catch(() => [])).sort();
  const body = renderDigest({ projectId, memoryFiles, skillNames });
  const written = [];

  for (const write of planWrites({ adapters, projectId, cwd })) {
    if (dryRun) {
      written.push({ adapter: write.adapter, file: write.file });
      continue;
    }
    if (write.kind === 'memory-dir') {
      await fs.mkdir(write.file, { recursive: true });
      for (const file of memoryFiles) {
        await fs.writeFile(path.join(write.file, file.name), file.content, 'utf8');
      }
    } else {
      await fs.mkdir(path.dirname(write.file), { recursive: true });
      const existing = await fs.readFile(write.file, 'utf8').catch(() => '');
      await fs.writeFile(write.file, upsertBlock(existing, body), 'utf8');
    }
    written.push({ adapter: write.adapter, file: write.file });
  }

  // Claude is the only adapter carrying settings, and only when selected.
  if (adapters.some((a) => a.id === 'claude') && !dryRun) {
    const sharedPath = path.join(stagedSharedDir(), 'settings-shared.json');
    const shared = JSON.parse(await fs.readFile(sharedPath, 'utf8').catch(() => '{}'));
    await claude.mergeSettings(shared);
  }

  return written;
}

/**
 * Reads authored content out of the tools and into the canonical staged tree.
 * Must run before runSync on the way out, otherwise there is nothing to push.
 * Only adapters that declare `collect` participate; today that is Claude alone.
 */
export async function collectFromTools({ config, projectId, cwd }) {
  for (const adapter of selectAdapters(config.targets)) {
    if (typeof adapter.collect === 'function') await adapter.collect({ projectId, cwd });
  }
}

export async function detectInstalled() {
  const out = [];
  for (const adapter of ADAPTERS) {
    out.push({ id: adapter.id, label: adapter.label, installed: await adapter.detect() });
  }
  return out;
}
