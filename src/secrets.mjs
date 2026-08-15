// Distinctive credential formats. Real enough to warrant flagging wherever
// they appear, including inside a fenced code block or inline code span -
// someone pasting an actual leaked key into a doc doesn't stop it being one.
const HARD_PATTERNS = [
  { kind: 'anthropic-key', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { kind: 'openai-key', re: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { kind: 'aws-access-key-id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { kind: 'private-key-block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

// Loose: keyword + assignment shape only, with no format check - this is the
// pattern that catches a real `DATABASE_PASSWORD="..."` in a config file, but
// it is also the one that lights up on documentation quoting a *fake*
// credential as a worked example (a SQL injection payload, a curl command,
// an NIST guidance URL with "PasswordGuidance" in the anchor). Confirmed live
// against the wstg skill: those false positives were consistently inside a
// fenced block, an inline `code span`, or a markdown link target, never in
// plain prose - so this pattern is only checked there. A real secret typed
// as a stand-alone value in an ordinary line or a genuine hard-pattern key
// (above) is still caught everywhere, backticks or not.
const ASSIGNMENT_PATTERN = {
  kind: 'secret-assignment',
  re: /\b\w*(PASSWORD|SECRET|TOKEN|API_?KEY)\w*\s*[:=]\s*["']?\S{8,}/i,
};

const PROVIDER_CONFLICT_PATTERNS = [
  /\(\d+\)\.[^.]+$/, //  "note (1).md"        - Google Drive
  /conflicted copy/i, //  Dropbox / iCloud
  /-[A-Z0-9]{6,}\.[^.]+$/, //  "note-DESKTOP-ABC123.md" - OneDrive
];

export function scanForSecrets(text) {
  const hits = [];
  let inFence = false;
  text.split(/\r?\n/).forEach((rawLine, i) => {
    if (/^\s*(```|~~~)/.test(rawLine)) {
      inFence = !inFence;
      return;
    }
    for (const { kind, re } of HARD_PATTERNS) {
      if (re.test(rawLine)) {
        hits.push({ line: i + 1, kind });
        return; // One finding per line is enough to warn the user.
      }
    }
    if (inFence) return;
    const prose = rawLine
      .replace(/\]\([^)]*\)/g, ']') // markdown link targets, e.g. ](https://...#PasswordGuidance:...)
      .replace(/`[^`]*`/g, '``'); // inline `code spans`
    if (ASSIGNMENT_PATTERN.re.test(prose)) {
      hits.push({ line: i + 1, kind: ASSIGNMENT_PATTERN.kind });
    }
  });
  return hits;
}

export function findProviderConflictArtifacts(names) {
  return names.filter((n) => PROVIDER_CONFLICT_PATTERNS.some((re) => re.test(n)));
}
