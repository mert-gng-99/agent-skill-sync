import fs from 'node:fs/promises';
import path from 'node:path';
import { homeDir } from './paths.mjs';

function stamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

/**
 * Copies the given local directories into a timestamped snapshot before a pull
 * overwrites anything, then prunes all but the newest `snapshotKeep` snapshots.
 * `pairs` is an array of { name, dir }.
 */
export async function takeSnapshot(pairs, snapshotKeep = 20) {
  const root = path.join(homeDir(), 'snapshots');
  const target = path.join(root, stamp());
  for (const { name, dir } of pairs) {
    try {
      await fs.cp(dir, path.join(target, name), { recursive: true });
    } catch {
      // A source that does not exist yet simply has nothing to back up.
    }
  }
  const existing = (await fs.readdir(root).catch(() => [])).sort();
  for (const old of existing.slice(0, Math.max(0, existing.length - snapshotKeep))) {
    await fs.rm(path.join(root, old), { recursive: true, force: true });
  }
  return target;
}
