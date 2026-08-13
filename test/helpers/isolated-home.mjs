import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Points HOME at a throwaway directory for the lifetime of this test process.
 * os.homedir() reads HOME on POSIX and USERPROFILE on Windows at call time, and
 * every agent-sync path helper is lazy, so this redirects ~/.agent-sync into the
 * sandbox. Without it, `npm test` overwrites the developer's real state.json and
 * evicts their real snapshots.
 *
 * Call it at module top level, before any test runs. node --test gives each file
 * its own process, so files cannot leak this into one another.
 */
export function useIsolatedHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sync-home-'));
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  return dir;
}
