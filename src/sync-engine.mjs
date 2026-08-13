export const ACTION = {
  SKIP: 'skip',
  PUSH: 'push',
  PULL: 'pull',
  CONFLICT: 'conflict',
};

/**
 * Pure three-way decision. `null` means the file is absent on that side.
 * Deletions are deliberately never propagated: an absent side loses to a
 * present one, so a file removed on one machine is restored from the other.
 */
export function decide({ localHash, remoteHash, baseHash }) {
  if (localHash === remoteHash) return ACTION.SKIP;
  if (localHash === null) return ACTION.PULL;
  if (remoteHash === null) return ACTION.PUSH;
  if (remoteHash === baseHash) return ACTION.PUSH;
  if (localHash === baseHash) return ACTION.PULL;
  return ACTION.CONFLICT;
}

export function buildPlan(localMap, remoteMap, baseFiles = {}) {
  const relPaths = new Set([...localMap.keys(), ...remoteMap.keys()]);
  const plan = [];
  for (const relPath of [...relPaths].sort()) {
    const action = decide({
      localHash: localMap.get(relPath) ?? null,
      remoteHash: remoteMap.get(relPath) ?? null,
      baseHash: baseFiles[relPath] ?? null,
    });
    if (action !== ACTION.SKIP) plan.push({ relPath, action });
  }
  return plan;
}
