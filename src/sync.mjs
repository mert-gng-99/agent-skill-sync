import path from 'node:path';
import { stagedDir, stagedSkillsDir, stagedSharedDir } from './paths.mjs';
import { collectManifest } from './manifest.mjs';
import { buildPlan } from './sync-engine.mjs';
import { applyPlan } from './apply.mjs';
import { loadState, saveState } from './state.mjs';
import { takeSnapshot } from './snapshot.mjs';

/**
 * The three mirrored trees, all local sides living under ~/.agent-sync/staged.
 * The engine deliberately knows nothing about any agent's directories - getting
 * content into CLAUDE.md, AGENTS.md and friends is the adapters' job.
 * `memory` carries every project's notes at once because the whole set is only
 * a few hundred kilobytes.
 */
export function syncPairs(config) {
  return [
    { name: 'skills', localDir: stagedSkillsDir(), remoteDir: path.join(config.syncRoot, 'skills') },
    {
      name: 'memory',
      localDir: path.join(stagedDir(), 'memory'),
      remoteDir: path.join(config.syncRoot, 'memory'),
    },
    {
      name: 'shared',
      localDir: stagedSharedDir(),
      remoteDir: path.join(config.syncRoot, 'shared'),
    },
  ];
}

export async function runSync({ config, dryRun }) {
  const state = await loadState();
  const allConflicts = [];
  const fullPlan = [];

  if (!dryRun) {
    await takeSnapshot(
      syncPairs(config).map((p) => ({ name: p.name, dir: p.localDir })),
      config.snapshotKeep
    );
  }

  for (const pair of syncPairs(config)) {
    const local = await collectManifest(pair.localDir);
    const remote = await collectManifest(pair.remoteDir);
    const base = state.files[pair.name] ?? {};
    const plan = buildPlan(local, remote, base);

    const { applied, conflicts } = await applyPlan(plan, {
      localRoot: pair.localDir,
      remoteRoot: pair.remoteDir,
      machineId: config.machineId,
      dryRun,
    });

    if (!dryRun) {
      const nextBase = { ...base };
      for (const entry of applied) nextBase[entry.relPath] = entry.hash;
      // Files that were already identical keep their recorded hash.
      for (const [rel, hash] of local) if (remote.get(rel) === hash) nextBase[rel] = hash;
      state.files[pair.name] = nextBase;
    }

    fullPlan.push(...plan.map((p) => ({ ...p, pair: pair.name })));
    allConflicts.push(...conflicts.map((c) => ({ ...c, pair: pair.name })));
  }

  if (!dryRun) await saveState(state);
  return { plan: fullPlan, conflicts: allConflicts };
}
