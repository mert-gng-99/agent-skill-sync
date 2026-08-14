import fs from 'node:fs/promises';

/**
 * Makes `dest` an exact copy of `src`: wipes dest first, then copies src
 * fresh. Plain `fs.cp` only overlays - it copies what exists in src but
 * never removes a file from dest that vanished from src - so a memory note
 * or a skill folder the user deleted would survive forever in the staged
 * copy and get written straight back on the next sync. Wiping first is the
 * simplest way to make deletions actually stick; at agent-sync's scale
 * (skills and memory notes, not large data sets) the cost is negligible.
 */
export async function mirrorDir(src, dest) {
  await fs.rm(dest, { recursive: true, force: true });
  await fs.cp(src, dest, { recursive: true }).catch(() => {});
}
