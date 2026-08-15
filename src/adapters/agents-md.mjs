import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { singleFileAdapter } from './simple.mjs';

/**
 * AGENTS.md is the de-facto cross-tool convention. Codex and OpenCode both
 * read it, so they share this base and are deduplicated at write time.
 *
 * Codex additionally has a confirmed skill mechanism (the other one being
 * Claude, handled in claude.mjs): it loads SKILL.md content from
 * .agents/skills/ at the repo root (also checks $HOME/.agents/skills and a
 * couple of other locations), per https://learn.chatgpt.com/docs/build-skills.
 * That is why codex is written out by hand here instead of going through the
 * singleFileAdapter factory - projectSkillsDir has no equivalent on
 * opencode/gemini/aider/cursor, and none of them should claim it without the
 * same kind of verification.
 */
export const codex = {
  id: 'codex',
  label: 'Codex CLI',
  async detect() {
    return fs
      .access(path.join(os.homedir(), '.codex'))
      .then(() => true)
      .catch(() => false);
  },
  globalInstructionsPath() {
    return path.join(os.homedir(), '.codex', 'AGENTS.md');
  },
  projectMemoryDir() {
    return null;
  },
  projectInstructionsPath(cwd) {
    return path.join(cwd, 'AGENTS.md');
  },
  projectSkillsDir(cwd) {
    return path.join(cwd, '.agents', 'skills');
  },
  installHooks: null,
};

export const opencode = singleFileAdapter({
  id: 'opencode',
  label: 'OpenCode',
  projectFile: 'AGENTS.md',
  globalFile: '.config/opencode/AGENTS.md',
  detectPath: '.config/opencode',
});
