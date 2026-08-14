import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Builds an adapter for a tool that reads one markdown file per project. */
export function singleFileAdapter({ id, label, projectFile, globalFile, detectPath, frontmatter }) {
  return {
    id,
    label,
    frontmatter,
    async detect() {
      if (!detectPath) return false;
      return fs
        .access(path.join(os.homedir(), detectPath))
        .then(() => true)
        .catch(() => false);
    },
    globalInstructionsPath() {
      return globalFile ? path.join(os.homedir(), ...globalFile.split('/')) : null;
    },
    projectMemoryDir() {
      return null;
    },
    projectInstructionsPath(cwd) {
      return path.join(cwd, ...projectFile.split('/'));
    },
    installHooks: null,
  };
}
