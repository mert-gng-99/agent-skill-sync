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
