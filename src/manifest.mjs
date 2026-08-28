import fs from 'node:fs/promises';
import path from 'node:path';
import { hashContent } from './state.mjs';

export const IGNORED_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'state.json', 'config.json']);

// A skill or memory folder can itself be a git checkout (e.g. cloned from a
// marketplace). Its .git internals are not content anyone authored - syncing
// them ships hundreds of loose objects and pack files for no reason, and
// stock sample hook scripts routinely false-positive the secret scanner.
// Same reasoning for .claude (a synced vault's own hook/tool install - see
// the vault sync pair in sync.mjs) and .obsidian (Obsidian's local UI/cache
// state) - neither is authored content either.
const IGNORED_DIRS = new Set(['.git', '.claude', '.obsidian']);

/**
 * Returns a map of POSIX-style relative path -> content hash. Relative paths
 * always use forward slashes so a manifest is comparable across platforms.
 */
export async function collectManifest(rootDir) {
  const out = new Map();
  async function walk(dir, prefix) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // Missing or unreadable directory is an empty manifest.
    }
    for (const entry of entries) {
      if (IGNORED_NAMES.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        await walk(abs, rel);
      } else if (entry.isFile()) {
        out.set(rel, hashContent(await fs.readFile(abs)));
      }
    }
  }
  await walk(rootDir, '');
  return out;
}
