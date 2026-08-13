import { singleFileAdapter } from './simple.mjs';

/**
 * AGENTS.md is the de-facto cross-tool convention. Codex and OpenCode both
 * read it, so they share this base and are deduplicated at write time.
 */
export const codex = singleFileAdapter({
  id: 'codex',
  label: 'Codex CLI',
  projectFile: 'AGENTS.md',
  globalFile: '.codex/AGENTS.md',
  detectPath: '.codex',
});

export const opencode = singleFileAdapter({
  id: 'opencode',
  label: 'OpenCode',
  projectFile: 'AGENTS.md',
  globalFile: '.config/opencode/AGENTS.md',
  detectPath: '.config/opencode',
});
