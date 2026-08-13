import fs from 'node:fs/promises';
import path from 'node:path';
import { ACTION } from './sync-engine.mjs';
import { hashContent } from './state.mjs';

function pad(n) {
  return String(n).padStart(2, '0');
}

export function conflictName(relPath, machineId, date) {
  const stamp =
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
  const ext = path.posix.extname(relPath);
  const stem = ext ? relPath.slice(0, -ext.length) : relPath;
  return `${stem}.conflict-${machineId}-${stamp}${ext}`;
}

async function copy(fromRoot, toRoot, relPath) {
  const src = path.join(fromRoot, ...relPath.split('/'));
  const dest = path.join(toRoot, ...relPath.split('/'));
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const data = await fs.readFile(src);
  await fs.writeFile(dest, data);
  return hashContent(data);
}

/**
 * Executes a plan. Returns the hash of every settled file so the caller can
 * write it into state.json, plus the list of conflicts for reporting.
 */
export async function applyPlan(plan, { localRoot, remoteRoot, machineId, dryRun }) {
  const applied = [];
  const conflicts = [];
  for (const { relPath, action } of plan) {
    if (dryRun) {
      if (action === ACTION.CONFLICT) conflicts.push({ relPath, keptAs: null });
      else applied.push({ relPath, action, hash: null });
      continue;
    }
    if (action === ACTION.PUSH) {
      applied.push({ relPath, action, hash: await copy(localRoot, remoteRoot, relPath) });
    } else if (action === ACTION.PULL) {
      applied.push({ relPath, action, hash: await copy(remoteRoot, localRoot, relPath) });
    } else if (action === ACTION.CONFLICT) {
      // Keep the local version under a stamped name, then let remote take the
      // canonical path. Nothing is ever discarded.
      const keptAs = conflictName(relPath, machineId, new Date());
      const mine = await fs.readFile(path.join(localRoot, ...relPath.split('/')));
      const keptPath = path.join(localRoot, ...keptAs.split('/'));
      await fs.mkdir(path.dirname(keptPath), { recursive: true });
      await fs.writeFile(keptPath, mine);
      const hash = await copy(remoteRoot, localRoot, relPath);
      applied.push({ relPath, action, hash });
      conflicts.push({ relPath, keptAs });
    }
  }
  return { applied, conflicts };
}
