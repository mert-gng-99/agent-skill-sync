import os from 'node:os';
import path from 'node:path';

/**
 * Reproduces Claude Code's project directory encoding: every character that is
 * not an ASCII alphanumeric becomes a dash. Verified against a live install.
 * Lives here rather than in the claude adapter because the local slug is also
 * how the engine addresses per-project state.
 */
export function slugForPath(absPath) {
  return absPath.replace(/[^a-zA-Z0-9]/g, '-');
}

/** agent-sync's own directory. Never inside any single agent's folder. */
export function homeDir() {
  return path.join(os.homedir(), '.agent-sync');
}

/** Local mirror of syncRoot. Adapters read from here; nothing else writes it. */
export function stagedDir() {
  return path.join(homeDir(), 'staged');
}

export function stagedSkillsDir() {
  return path.join(stagedDir(), 'skills');
}

export function stagedMemoryDir(projectId) {
  return path.join(stagedDir(), 'memory', projectId);
}

export function stagedSharedDir() {
  return path.join(stagedDir(), 'shared');
}

export function stagedTranscriptsDir(projectId) {
  return path.join(stagedDir(), 'transcripts', projectId);
}
