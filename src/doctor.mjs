import fs from 'node:fs/promises';
import path from 'node:path';
import { collectManifest } from './manifest.mjs';
import { loadRegistry } from './registry.mjs';
import { scanForSecrets, findProviderConflictArtifacts } from './secrets.mjs';

const OK = 'ok';
const WARN = 'warn';
const FAIL = 'fail';

export async function runDoctor({ syncRoot, localRoots = [] }) {
  const checks = [];

  // 1. Is syncRoot reachable and writable?
  try {
    await fs.mkdir(syncRoot, { recursive: true });
    const probe = path.join(syncRoot, '.agent-sync-write-probe');
    await fs.writeFile(probe, 'ok');
    await fs.rm(probe);
    checks.push({ name: 'syncRoot writable', status: OK, details: syncRoot });
  } catch (err) {
    checks.push({ name: 'syncRoot writable', status: FAIL, details: err.message });
    return checks; // Nothing else can be checked without the sync root.
  }

  const remote = await collectManifest(syncRoot);
  const names = [...remote.keys()];

  // 2. Cloud provider conflict artifacts.
  const artifacts = findProviderConflictArtifacts(names);
  checks.push({
    name: 'cloud provider conflict copies',
    status: artifacts.length ? WARN : OK,
    details: artifacts.join(', ') || 'none',
  });

  // 3. Our own conflict files awaiting resolution.
  const ours = names.filter((n) => n.includes('.conflict-'));
  checks.push({
    name: 'unresolved sync conflicts',
    status: ours.length ? WARN : OK,
    details: ours.join(', ') || 'none',
  });

  // 4. Registry consistency: memory folders with no registry entry.
  const registry = await loadRegistry(syncRoot);
  const known = new Set(Object.keys(registry.projects));
  const memoryDirs = new Set(
    names.filter((n) => n.startsWith('memory/')).map((n) => n.split('/')[1])
  );
  const orphans = [...memoryDirs].filter((d) => d !== '_global' && !known.has(d));
  checks.push({
    name: 'registry consistency',
    status: orphans.length ? WARN : OK,
    details: orphans.length ? `memory without registry entry: ${orphans.join(', ')}` : 'none',
  });

  // 5. Secret scan across everything that would leave this machine.
  const findings = [];
  for (const { dir } of localRoots) {
    const local = await collectManifest(dir);
    for (const rel of local.keys()) {
      const abs = path.join(dir, ...rel.split('/'));
      const text = await fs.readFile(abs, 'utf8').catch(() => '');
      for (const hit of scanForSecrets(text)) findings.push(`${rel}:${hit.line} (${hit.kind})`);
    }
  }
  checks.push({
    name: 'secret scan',
    status: findings.length ? WARN : OK,
    details: findings.join(', ') || 'none',
  });

  return checks;
}
