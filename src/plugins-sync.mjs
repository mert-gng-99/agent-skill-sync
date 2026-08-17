import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pluginChoicesPath } from './paths.mjs';

const run = promisify(execFile);

export async function loadPluginChoices() {
  try {
    return JSON.parse(await fs.readFile(pluginChoicesPath(), 'utf8'));
  } catch {
    return {};
  }
}

export async function savePluginChoices(choices) {
  await fs.mkdir(path.dirname(pluginChoicesPath()), { recursive: true });
  await fs.writeFile(pluginChoicesPath(), JSON.stringify(choices, null, 2) + '\n', 'utf8');
}

/**
 * Pure decision logic, kept separate from the `claude` CLI calls so it is
 * testable without a real install. A plugin only qualifies once: enabled in
 * the settings synced from another machine, not already here, and not
 * something the user already said no to on this machine.
 */
export function computeMissingPlugins({ enabledPlugins, installedIds, choices }) {
  return Object.entries(enabledPlugins ?? {})
    .filter(([id, wanted]) => wanted && !installedIds.has(id) && !choices[id])
    .map(([id]) => id);
}

/**
 * Null (not a throw) means the `claude` CLI could not be reached - a
 * different machine's plugin config, a PATH problem, anything. Callers treat
 * that as "nothing we can check right now", never as a reason to fail a sync.
 */
export async function listInstalledPluginIds({ exec = run } = {}) {
  try {
    const { stdout } = await exec('claude', ['plugin', 'list', '--json']);
    return new Set(JSON.parse(stdout).map((p) => p.id));
  } catch {
    return null;
  }
}

async function marketplaceKnown(name, { exec }) {
  try {
    const { stdout } = await exec('claude', ['plugin', 'marketplace', 'list', '--json']);
    return JSON.parse(stdout).some((m) => m.name === name);
  } catch {
    return false;
  }
}

async function installOne(id, { extraKnownMarketplaces, exec }) {
  const marketplace = id.split('@')[1];
  if (!(await marketplaceKnown(marketplace, { exec }))) {
    const source = extraKnownMarketplaces?.[marketplace]?.source?.repo;
    if (source) await exec('claude', ['plugin', 'marketplace', 'add', source]);
  }
  await exec('claude', ['plugin', 'install', id]);
}

/**
 * Interactive by design - only ever call this from a command a human just
 * typed in a terminal. A hook or the VS Code extension has no stdin to ask
 * on, and `ask` would hang the session waiting for input that never comes.
 */
export async function syncPlugins({ enabledPlugins, extraKnownMarketplaces, ask, exec = run }) {
  const installedIds = await listInstalledPluginIds({ exec });
  if (installedIds === null) return [];

  const choices = await loadPluginChoices();
  const missing = computeMissingPlugins({ enabledPlugins, installedIds, choices });
  const installed = [];

  for (const id of missing) {
    const yes = /^y/i.test(await ask(`Install ${id}, synced from another machine? [y/N]: `));
    if (!yes) {
      choices[id] = 'skipped';
      continue;
    }
    try {
      await installOne(id, { extraKnownMarketplaces, exec });
      installed.push(id);
    } catch {
      // Leave this one undecided - a transient network failure should not
      // permanently give up on it the way a real "no" does.
    }
  }

  await savePluginChoices(choices);
  return installed;
}
