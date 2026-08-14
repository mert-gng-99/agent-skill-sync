import crypto from 'node:crypto';

export const MARKER_FILENAME = '.claude-project-id';

export function newProjectId(name) {
  const stem = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
  return `${stem}-${crypto.randomBytes(3).toString('hex')}`;
}

/**
 * Four-step resolution, in priority order:
 *   1. marker file in the project root
 *   2. git remote URL matching a registry entry
 *   3. folder name matching exactly one registry entry
 *   4. otherwise a new id; `ambiguous` marks the case where the folder name
 *      matched several projects, so doctor can ask the user to sort it out.
 */
export function resolveIdentity({ folderName, marker, gitRemote, registry }) {
  const entries = Object.entries(registry.projects ?? {});

  if (marker) return { id: marker, source: 'marker', ambiguous: false };

  if (gitRemote) {
    const hit = entries.find(([, p]) => p.gitRemote === gitRemote);
    if (hit) return { id: hit[0], source: 'gitRemote', ambiguous: false };
  }

  const byName = entries.filter(([, p]) => p.name === folderName);
  if (byName.length === 1) return { id: byName[0][0], source: 'folderName', ambiguous: false };

  return { id: newProjectId(folderName), source: 'new', ambiguous: byName.length > 1 };
}
