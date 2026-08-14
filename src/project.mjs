import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MARKER_FILENAME, resolveIdentity } from './identity.mjs';
import { loadRegistry, saveRegistry, upsertProject } from './registry.mjs';
import { stagedDir, stagedMemoryDir } from './paths.mjs';

const run = promisify(execFile);

/**
 * Claude Code hooks fire for every session regardless of cwd. A session
 * started with no cwd argument opens in the user's home directory, and
 * without this guard that directory gets "projectified": a marker file and
 * an AGENTS.md/GEMINI.md digest land straight in $HOME. The home directory
 * is never a project on its own - it is excluded outright rather than left
 * to folder-name or git-remote matching.
 */
export function isUnsyncableDirectory(cwd) {
  return path.resolve(cwd) === path.resolve(os.homedir());
}

export async function readMarker(cwd) {
  try {
    return (await fs.readFile(path.join(cwd, MARKER_FILENAME), 'utf8')).trim() || null;
  } catch {
    return null;
  }
}

export async function readGitRemote(cwd) {
  try {
    const { stdout } = await run('git', ['remote', 'get-url', 'origin'], { cwd });
    return stdout.trim() || null;
  } catch {
    return null; // Not a repo, or no origin. Both are fine.
  }
}

/** Uses .git/info/exclude so the user's own .gitignore is never modified. */
export async function addToGitExclude(cwd, name) {
  const gitDir = path.join(cwd, '.git');
  try {
    await fs.stat(gitDir);
  } catch {
    return; // Not a git working tree
  }
  const infoDir = path.join(gitDir, 'info');
  await fs.mkdir(infoDir, { recursive: true });
  const excludePath = path.join(infoDir, 'exclude');
  let current = '';
  try {
    current = await fs.readFile(excludePath, 'utf8');
  } catch {
    current = '';
  }
  if (current.split(/\r?\n/).includes(name)) return;
  const sep = current.endsWith('\n') || current === '' ? '' : '\n';
  await fs.writeFile(excludePath, `${current}${sep}${name}\n`, 'utf8');
}

/**
 * Resolves which project this directory belongs to, writes the marker and
 * registry entry, and links Claude Code's memory directory to the synced copy.
 */
export async function ensureIdentity(config, cwd, { write = true } = {}) {
  if (isUnsyncableDirectory(cwd)) {
    return { id: null, source: 'home-directory', ambiguous: false };
  }
  const registry = await loadRegistry(config.syncRoot);
  const gitRemote = await readGitRemote(cwd);
  const identity = resolveIdentity({
    folderName: path.basename(cwd),
    marker: await readMarker(cwd),
    gitRemote,
    registry,
  });

  if (write) {
    await fs.writeFile(path.join(cwd, MARKER_FILENAME), identity.id + '\n', 'utf8');
    await addToGitExclude(cwd, MARKER_FILENAME);
    await saveRegistry(
      config.syncRoot,
      upsertProject(registry, {
        id: identity.id,
        name: path.basename(cwd),
        gitRemote,
        machineId: config.machineId,
        absPath: cwd,
      })
    );
    await ensureStagedMemory(identity.id);
  }
  return identity;
}

/**
 * Guarantees this project has a canonical memory directory. Getting that
 * content into each tool's own location is the adapters' job, not this
 * module's - the engine stays agent-agnostic.
 */
async function ensureStagedMemory(projectId) {
  await fs.mkdir(stagedMemoryDir(projectId), { recursive: true });
}

export async function linkProject(config, cwd, projectId) {
  if (!projectId) {
    process.stderr.write('Usage: agent-sync link <project-id>\n');
    return 1;
  }
  const registry = await loadRegistry(config.syncRoot);
  if (!registry.projects[projectId]) {
    process.stderr.write(`Unknown project id: ${projectId}\n`);
    return 1;
  }
  await fs.writeFile(path.join(cwd, MARKER_FILENAME), projectId + '\n', 'utf8');
  await addToGitExclude(cwd, MARKER_FILENAME);
  await saveRegistry(
    config.syncRoot,
    upsertProject(registry, {
      id: projectId,
      name: registry.projects[projectId].name,
      gitRemote: await readGitRemote(cwd),
      machineId: config.machineId,
      absPath: cwd,
    })
  );
  await ensureStagedMemory(projectId);
  process.stdout.write(`Linked ${cwd} to ${projectId}\n`);
  return 0;
}

/** The only path that deletes anything, because sync itself never does. */
export async function forgetFile(config, relPath, dryRun) {
  if (!relPath) {
    process.stderr.write('Usage: agent-sync forget <relative-path>\n');
    return 1;
  }
  const targets = [
    path.join(config.syncRoot, ...relPath.split('/')),
    path.join(stagedDir(), ...relPath.split('/')),
  ];
  for (const target of targets) {
    process.stdout.write(`${dryRun ? '[dry-run] ' : ''}delete ${target}\n`);
    if (!dryRun) await fs.rm(target, { force: true });
  }
  return 0;
}
