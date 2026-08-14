import fs from 'node:fs/promises';
import path from 'node:path';

const EMPTY_REGISTRY = { version: 1, projects: {} };

export function registryPath(syncRoot) {
  return path.join(syncRoot, 'registry.json');
}

export async function loadRegistry(syncRoot) {
  try {
    const parsed = JSON.parse(await fs.readFile(registryPath(syncRoot), 'utf8'));
    return { ...EMPTY_REGISTRY, ...parsed, projects: parsed.projects ?? {} };
  } catch {
    return { version: 1, projects: {} };
  }
}

export async function saveRegistry(syncRoot, reg) {
  await fs.mkdir(syncRoot, { recursive: true });
  await fs.writeFile(registryPath(syncRoot), JSON.stringify(reg, null, 2) + '\n', 'utf8');
}

/**
 * Renders the registry as plain lines for a UI to print: which project,
 * which machines have it and at what path, when it was last touched. Every
 * fact here already lives in registry.json - this is display only, no new
 * data collected.
 */
export function formatRegistry(registry) {
  const entries = Object.entries(registry.projects ?? {});
  if (entries.length === 0) return ['No projects yet.'];

  const lines = [];
  for (const [id, project] of entries.sort(([, a], [, b]) => a.name.localeCompare(b.name))) {
    lines.push(`${project.name} (${id})`);
    if (project.gitRemote) lines.push(`  git: ${project.gitRemote}`);
    const machines = Object.entries(project.paths ?? {});
    if (machines.length === 0) {
      lines.push('  (no machine paths recorded)');
    } else {
      for (const [machineId, absPath] of machines) lines.push(`  ${machineId}: ${absPath}`);
    }
    if (project.lastSeen) lines.push(`  last seen: ${project.lastSeen}`);
    lines.push('');
  }
  lines.pop(); // drop the trailing blank line after the last project
  return lines;
}

export function upsertProject(reg, { id, name, gitRemote, machineId, absPath }) {
  const existing = reg.projects[id] ?? { name, paths: {} };
  reg.projects[id] = {
    ...existing,
    name: existing.name ?? name,
    ...(gitRemote ? { gitRemote } : {}),
    paths: { ...existing.paths, [machineId]: absPath },
    lastSeen: new Date().toISOString(),
  };
  return reg;
}
