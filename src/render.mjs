export const BEGIN = '<!-- agent-sync:begin -->';
export const END = '<!-- agent-sync:end -->';

/**
 * Compiles the canonical per-project memory directory into one markdown
 * document, for tools that read a single context file rather than a folder.
 */
export function renderDigest({ projectId, memoryFiles = [], skillNames = [] }) {
  const lines = [
    '## Project memory (synced by agent-sync)',
    '',
    `Project id: \`${projectId}\``,
    '',
  ];

  if (memoryFiles.length === 0) {
    lines.push('_No memory recorded for this project yet._', '');
  } else {
    for (const file of memoryFiles) {
      lines.push(`### ${file.name.replace(/\.md$/, '')}`, '', file.content.trim(), '');
    }
  }

  if (skillNames.length > 0) {
    lines.push(
      '## Available skills',
      '',
      'These are synced as markdown and can be read on demand:',
      '',
      ...skillNames.map((n) => `- ${n}`),
      ''
    );
  }

  return lines.join('\n');
}

/**
 * Writes `blockBody` between our delimiters inside `existingText`, leaving any
 * hand-written content alone. Appends the block when the delimiters are absent.
 */
export function upsertBlock(existingText, blockBody) {
  const block = `${BEGIN}\n${blockBody.trim()}\n${END}\n`;
  const start = existingText.indexOf(BEGIN);
  const end = existingText.indexOf(END);

  if (start !== -1 && end !== -1 && end > start) {
    return existingText.slice(0, start) + block + existingText.slice(end + END.length + 1);
  }
  if (existingText.trim() === '') return block;
  const sep = existingText.endsWith('\n') ? '\n' : '\n\n';
  return existingText + sep + block;
}

/**
 * Prepends a YAML frontmatter block, for tools (Cursor) that need one to load
 * the file at all. Skipped when the file already starts with its own
 * frontmatter, so a hand-edited description or globs is never clobbered.
 */
export function withFrontmatter(text, frontmatter) {
  if (!frontmatter || text.startsWith('---\n')) return text;
  return frontmatter + text;
}
