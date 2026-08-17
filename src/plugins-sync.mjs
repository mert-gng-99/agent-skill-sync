import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { pluginChoicesPath } from './paths.mjs';

const execCommand = promisify(exec);

/**
 * npm's global installer puts three files on a Windows PATH for a single bin
 * entry - `claude`, `claude.cmd`, `claude.ps1` - because there is no native
 * shebang support. A shell resolves the extensionless `claude` shim fine, but
 * Node's child_process spawns Win32 processes directly and only finds `.cmd`/
 * `.exe`/`.bat` there, so `execFile('claude', ...)` fails with ENOENT even
 * though `claude --version` works from the same machine's terminal.
 */
export function claudeBin(platform = process.platform) {
  return platform === 'win32' ? 'claude.cmd' : 'claude';
}

// A .cmd is a batch script, not a native executable - Windows' CreateProcess
// cannot launch it directly (EINVAL), only cmd.exe can, so this must go
// through a shell. That means the command is a single string, not a quoted
// argv, so every value reaching here (plugin ids, marketplace names, repo
// slugs - all sourced from settings synced in from another machine) is
// checked against a strict allowlist first. Anything else is refused rather
// than silently mis-executed or, worse, breaking out of the intended command.
const SAFE_ARG = /^[\w@./-]+$/;

export async function safeExec(cmd, args, { runner = execCommand } = {}) {
  for (const arg of args) {
    if (!SAFE_ARG.test(arg)) throw new Error(`refusing to run: unsafe argument "${arg}"`);
  }
  return runner([cmd, ...args].join(' '));
}

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
export async function listInstalledPluginIds({ exec = safeExec } = {}) {
  try {
    const { stdout } = await exec(claudeBin(), ['plugin', 'list', '--json']);
    return new Set(JSON.parse(stdout).map((p) => p.id));
  } catch {
    return null;
  }
}

/**
 * Read-only twin of the check inside `syncPlugins` - no prompt, no install,
 * just the list. A hook has no terminal to ask on but can still print a
 * heads-up with this, so a missing plugin is never silently invisible just
 * because nobody happened to run `pull` by hand.
 */
export async function checkMissingPlugins({ enabledPlugins, exec = safeExec } = {}) {
  const installedIds = await listInstalledPluginIds({ exec });
  if (installedIds === null) return [];
  const choices = await loadPluginChoices();
  return computeMissingPlugins({ enabledPlugins, installedIds, choices });
}

async function marketplaceKnown(name, { exec }) {
  try {
    const { stdout } = await exec(claudeBin(), ['plugin', 'marketplace', 'list', '--json']);
    return JSON.parse(stdout).some((m) => m.name === name);
  } catch {
    return false;
  }
}

async function installOne(id, { extraKnownMarketplaces, exec }) {
  const marketplace = id.split('@')[1];
  if (!(await marketplaceKnown(marketplace, { exec }))) {
    const source = extraKnownMarketplaces?.[marketplace]?.source?.repo;
    if (source) await exec(claudeBin(), ['plugin', 'marketplace', 'add', source]);
  }
  await exec(claudeBin(), ['plugin', 'install', id]);
}

/**
 * Interactive by design - only ever call this from a command a human just
 * typed in a terminal. A hook or the VS Code extension has no stdin to ask
 * on, and `ask` would hang the session waiting for input that never comes.
 */
export async function syncPlugins({ enabledPlugins, extraKnownMarketplaces, ask, exec = safeExec }) {
  const missing = await checkMissingPlugins({ enabledPlugins, exec });
  if (missing.length === 0) return [];

  const choices = await loadPluginChoices();
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
