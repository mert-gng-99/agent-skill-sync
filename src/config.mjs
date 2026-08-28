import fs from 'node:fs/promises';
import path from 'node:path';
import { homeDir } from './paths.mjs';

/**
 * Every adapter that exists. Kept here rather than imported from the adapter
 * registry so that config validation stays free of side effects.
 */
export const KNOWN_TARGETS = ['claude', 'codex', 'opencode', 'gemini', 'aider', 'cursor'];

export const DEFAULT_CONFIG = {
  syncRoot: '',
  machineId: '',
  targets: [],
  syncTranscripts: true,
  snapshotKeep: 20,
  vaultPath: '',
};

export function configPath() {
  return path.join(homeDir(), 'config.json');
}

export function validateConfig(obj) {
  const errors = [];
  if (!obj || typeof obj.syncRoot !== 'string' || obj.syncRoot.trim() === '') {
    errors.push('syncRoot is required and must be a non-empty path');
  }
  // machineId lands inside conflict filenames, so keep it filesystem-safe.
  if (!obj || typeof obj.machineId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(obj.machineId)) {
    errors.push('machineId must contain only letters, digits, dash or underscore');
  }
  const targets = obj?.targets ?? [];
  if (!Array.isArray(targets)) {
    errors.push('targets must be an array');
  } else {
    for (const t of targets) {
      if (!KNOWN_TARGETS.includes(t)) errors.push(`unknown target: ${t}`);
    }
  }
  if (obj?.vaultPath !== undefined && typeof obj.vaultPath !== 'string') {
    errors.push('vaultPath must be a string');
  }
  return { ok: errors.length === 0, errors };
}

export async function loadConfig() {
  const raw = await fs.readFile(configPath(), 'utf8');
  const config = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  const { ok, errors } = validateConfig(config);
  if (!ok) throw new Error(`Invalid config at ${configPath()}: ${errors.join('; ')}`);
  return config;
}

export async function saveConfig(config) {
  await fs.mkdir(homeDir(), { recursive: true });
  await fs.writeFile(configPath(), JSON.stringify(config, null, 2) + '\n', 'utf8');
}
