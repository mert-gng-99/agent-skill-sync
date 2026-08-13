import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { homeDir } from './paths.mjs';

const EMPTY_STATE = { version: 1, files: {} };

export function hashContent(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function statePath() {
  return path.join(homeDir(), 'state.json');
}

export async function loadState() {
  try {
    return { ...EMPTY_STATE, ...JSON.parse(await fs.readFile(statePath(), 'utf8')) };
  } catch {
    // No state yet, or unreadable: treat every file as new rather than failing.
    return { ...EMPTY_STATE, files: {} };
  }
}

export async function saveState(state) {
  await fs.mkdir(homeDir(), { recursive: true });
  await fs.writeFile(statePath(), JSON.stringify(state, null, 2) + '\n', 'utf8');
}
