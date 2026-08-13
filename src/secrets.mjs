const PATTERNS = [
  { kind: 'anthropic-key', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { kind: 'openai-key', re: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { kind: 'aws-access-key-id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { kind: 'private-key-block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { kind: 'secret-assignment', re: /\b\w*(PASSWORD|SECRET|TOKEN|API_?KEY)\w*\s*[:=]\s*["']?\S{8,}/i },
];

const PROVIDER_CONFLICT_PATTERNS = [
  /\(\d+\)\.[^.]+$/, //  "note (1).md"        - Google Drive
  /conflicted copy/i, //  Dropbox / iCloud
  /-[A-Z0-9]{6,}\.[^.]+$/, //  "note-DESKTOP-ABC123.md" - OneDrive
];

export function scanForSecrets(text) {
  const hits = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const { kind, re } of PATTERNS) {
      if (re.test(line)) {
        hits.push({ line: i + 1, kind });
        break; // One finding per line is enough to warn the user.
      }
    }
  });
  return hits;
}

export function findProviderConflictArtifacts(names) {
  return names.filter((n) => PROVIDER_CONFLICT_PATTERNS.some((re) => re.test(n)));
}
