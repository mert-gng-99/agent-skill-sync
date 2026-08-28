import fs from 'node:fs/promises';
import path from 'node:path';
import { stagedDir, stagedSkillsDir, stagedSharedDir } from './paths.mjs';
import { collectManifest } from './manifest.mjs';
import { ACTION, buildPlan } from './sync-engine.mjs';
import { applyPlan, isConflictArtifact } from './apply.mjs';
import { loadState, saveState } from './state.mjs';
import { takeSnapshot } from './snapshot.mjs';
import { scanForSecrets } from './secrets.mjs';

/** Keeps conflict copies out of the sync entirely - see isConflictArtifact. */
export function withoutConflictArtifacts(manifest) {
  const out = new Map();
  for (const [rel, hash] of manifest) {
    if (!isConflictArtifact(rel)) out.set(rel, hash);
  }
  return out;
}

/**
 * Files heading out to syncRoot are the point of no return: once a credential
 * reaches a cloud folder it is replicated to every machine and kept in that
 * provider's version history, so a warning printed afterwards protects nothing.
 * Scan PUSH candidates here and withhold the ones that look like they carry
 * secrets. Nothing is destroyed - the file stays local and is reported - and
 * `force` sends it anyway when the match is a false positive.
 * Inbound files are not scanned: they are already shared, and blocking them
 * would only break the sync.
 */
async function withholdSecrets(plan, localDir, force) {
  if (force) return { safe: plan, blocked: [] };
  const safe = [];
  const blocked = [];
  for (const item of plan) {
    if (item.action !== ACTION.PUSH) {
      safe.push(item);
      continue;
    }
    const abs = path.join(localDir, ...item.relPath.split('/'));
    const findings = scanForSecrets(await fs.readFile(abs, 'utf8').catch(() => ''));
    if (findings.length) blocked.push({ relPath: item.relPath, findings });
    else safe.push(item);
  }
  return { safe, blocked };
}

/**
 * The mirrored trees, all local sides living under ~/.agent-sync/staged. The
 * engine deliberately knows nothing about any agent's directories - getting
 * content into CLAUDE.md, AGENTS.md and friends is the adapters' job.
 * `memory` carries every project's notes at once because the whole set is only
 * a few hundred kilobytes - `transcripts` does not share that justification
 * (session files are large and unbounded), which is why it only exists at all
 * when the user has opted in.
 */
export function syncPairs(config) {
  const pairs = [
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
  if (config.syncTranscripts) {
    pairs.push({
      name: 'transcripts',
      localDir: path.join(stagedDir(), 'transcripts'),
      remoteDir: path.join(config.syncRoot, 'transcripts'),
    });
  }
  // An avenoxbeyin (or similar) vault linked via `agent-sync vault <path>`.
  // localDir points directly at the vault itself, not a staged mirror - the
  // vault's own local git repo and .claude/.obsidian tool state are already
  // excluded by manifest.mjs's IGNORED_DIRS, so this is safe to sync as-is.
  if (config.vaultPath) {
    pairs.push({ name: 'vault', localDir: config.vaultPath, remoteDir: path.join(config.syncRoot, 'vault') });
  }
  return pairs;
}

export async function runSync({ config, dryRun, force = false }) {
  const state = await loadState();
  const allConflicts = [];
  const allBlocked = [];
  const fullPlan = [];

  if (!dryRun) {
    await takeSnapshot(
      syncPairs(config).map((p) => ({ name: p.name, dir: p.localDir })),
      config.snapshotKeep
    );
  }

  for (const pair of syncPairs(config)) {
    const local = withoutConflictArtifacts(await collectManifest(pair.localDir));
    const remote = withoutConflictArtifacts(await collectManifest(pair.remoteDir));
    const base = state.files[pair.name] ?? {};
    const plan = buildPlan(local, remote, base);
    const { safe, blocked } = await withholdSecrets(plan, pair.localDir, force);

    const { applied, conflicts } = await applyPlan(safe, {
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

    fullPlan.push(...safe.map((p) => ({ ...p, pair: pair.name })));
    allConflicts.push(...conflicts.map((c) => ({ ...c, pair: pair.name })));
    allBlocked.push(...blocked.map((b) => ({ ...b, pair: pair.name })));
  }

  if (!dryRun) await saveState(state);
  return { plan: fullPlan, conflicts: allConflicts, blocked: allBlocked };
}
