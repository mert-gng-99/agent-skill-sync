import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  slugForPath,
  stagedMemoryDir,
  stagedSkillsDir,
  stagedSharedDir,
  stagedTranscriptsDir,
} from '../paths.mjs';
import { mergeShared, extractShared } from '../settings-merge.mjs';
import { mirrorDir } from '../mirror.mjs';

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
    // --hook: a session can start in any folder, so this must never turn an
    // arbitrary directory into a new tracked project on its own - see the
    // --hook handling in bin/agent-sync.mjs.
    ['SessionStart', `${hookCommand()} pull --hook`],
    ['Stop', `${hookCommand()} push --hook`],
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
  async collect({ projectId, cwd, config }) {
    await fs.mkdir(stagedSharedDir(), { recursive: true });

    // Mirrored, not overlaid: a memory note or skill folder the user deleted
    // must actually disappear from the staged copy, or it comes right back
    // on the next sync (see mirrorDir).
    await mirrorDir(this.projectMemoryDir(cwd), stagedMemoryDir(projectId));
    await mirrorDir(path.join(claudeHome(), 'skills'), stagedSkillsDir());

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

    if (config?.syncTranscripts) {
      await this.collectTranscripts({ projectId, cwd });
    }
  },

  /**
   * Mirrors this project's session transcripts (*.jsonl) into the canonical
   * store, keyed by project id rather than this machine's path-derived slug -
   * so a session started here can be found again on a different machine,
   * under a different absolute path, once distributeTranscripts places it in
   * that machine's own slug folder for `claude --resume` to see.
   *
   * Off by default (config.syncTranscripts): unlike memory notes, transcripts
   * are large, grow without bound, and were never curated for sharing - a
   * pasted secret lands here verbatim, which is exactly why this pair still
   * goes through the same push-time secret gate as everything else.
   */
  async collectTranscripts({ projectId, cwd }) {
    const dest = stagedTranscriptsDir(projectId);
    await fs.mkdir(dest, { recursive: true });
    const src = path.join(claudeHome(), 'projects', slugForPath(cwd));
    const entries = await fs.readdir(src).catch(() => []);
    for (const name of entries) {
      if (!name.endsWith('.jsonl')) continue;
      await fs.copyFile(path.join(src, name), path.join(dest, name)).catch(() => {});
    }
  },

  /**
   * Inverse of collectTranscripts: after a pull, copies every session this
   * project has accumulated across machines into this machine's own project
   * folder. `claude --resume` only looks at the local slug folder, so a
   * session recorded elsewhere is invisible to it until this runs.
   */
  async distributeTranscripts({ projectId, cwd }) {
    const src = stagedTranscriptsDir(projectId);
    const entries = await fs.readdir(src).catch(() => []);
    if (entries.length === 0) return;
    const dest = path.join(claudeHome(), 'projects', slugForPath(cwd));
    await fs.mkdir(dest, { recursive: true });
    for (const name of entries) {
      if (!name.endsWith('.jsonl')) continue;
      await fs.copyFile(path.join(src, name), path.join(dest, name)).catch(() => {});
    }
  },
};
