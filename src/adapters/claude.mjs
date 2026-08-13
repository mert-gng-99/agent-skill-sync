import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugForPath, stagedMemoryDir, stagedSkillsDir, stagedSharedDir } from '../paths.mjs';
import { mergeShared, extractShared } from '../settings-merge.mjs';

const MARK = 'agent-sync';

export function claudeHome() {
  return path.join(os.homedir(), '.claude');
}

export function hookCommand() {
  const bin = fileURLToPath(new URL('../../bin/agent-sync.mjs', import.meta.url));
  // Quoted because home directories and cloud folders routinely contain spaces.
  return `node "${bin}"`;
}

/** Adds our two hooks without disturbing anything the user already configured. */
export function buildHooks(existingSettings) {
  const settings = { ...existingSettings, hooks: { ...(existingSettings.hooks ?? {}) } };
  for (const [event, command] of [
    ['SessionStart', `${hookCommand()} pull`],
    ['Stop', `${hookCommand()} push`],
  ]) {
    const current = (settings.hooks[event] ?? []).filter(
      (entry) => !JSON.stringify(entry).includes(MARK)
    );
    settings.hooks[event] = [...current, { hooks: [{ type: 'command', command }] }];
  }
  return settings;
}

export const claude = {
  id: 'claude',
  label: 'Claude Code',
  async detect() {
    return fs
      .access(claudeHome())
      .then(() => true)
      .catch(() => false);
  },
  globalInstructionsPath() {
    return path.join(claudeHome(), 'CLAUDE.md');
  },
  projectMemoryDir(cwd) {
    return path.join(claudeHome(), 'projects', slugForPath(cwd), 'memory');
  },
  projectInstructionsPath() {
    // Claude reads the memory directory directly, so no digest file is needed.
    return null;
  },
  async installHooks() {
    const settingsPath = path.join(claudeHome(), 'settings.json');
    const existing = JSON.parse(await fs.readFile(settingsPath, 'utf8').catch(() => '{}'));
    await fs.mkdir(claudeHome(), { recursive: true });
    await fs.writeFile(
      settingsPath,
      JSON.stringify(buildHooks(existing), null, 2) + '\n',
      'utf8'
    );
  },
  async mergeSettings(sharedSettings) {
    const settingsPath = path.join(claudeHome(), 'settings.json');
    const existing = JSON.parse(await fs.readFile(settingsPath, 'utf8').catch(() => '{}'));
    await fs.writeFile(
      settingsPath,
      JSON.stringify(mergeShared(existing, sharedSettings), null, 2) + '\n',
      'utf8'
    );
  },

  /**
   * Claude is the only adapter that feeds content back into the canonical
   * store, because it is where the user actually authors memory and skills.
   * Without this the staged tree would stay empty and nothing would ever sync.
   */
  async collect({ projectId, cwd }) {
    await fs.mkdir(stagedMemoryDir(projectId), { recursive: true });
    await fs.mkdir(stagedSkillsDir(), { recursive: true });
    await fs.mkdir(stagedSharedDir(), { recursive: true });

    await fs
      .cp(this.projectMemoryDir(cwd), stagedMemoryDir(projectId), { recursive: true })
      .catch(() => {});
    await fs
      .cp(path.join(claudeHome(), 'skills'), stagedSkillsDir(), { recursive: true })
      .catch(() => {});
    await fs
      .cp(this.globalInstructionsPath(), path.join(stagedSharedDir(), 'CLAUDE.md'))
      .catch(() => {});

    const settings = JSON.parse(
      await fs.readFile(path.join(claudeHome(), 'settings.json'), 'utf8').catch(() => '{}')
    );
    await fs.writeFile(
      path.join(stagedSharedDir(), 'settings-shared.json'),
      JSON.stringify(extractShared(settings), null, 2) + '\n',
      'utf8'
    );
  },
};
