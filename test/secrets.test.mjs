import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanForSecrets, findProviderConflictArtifacts } from '../src/secrets.mjs';
import { runDoctor } from '../src/doctor.mjs';

test('flags an anthropic style key', () => {
  const hits = scanForSecrets('note\nAPI key: sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 2);
});

test('flags aws access key ids and github tokens', () => {
  assert.equal(scanForSecrets('AKIAIOSFODNN7EXAMPLE').length, 1);
  assert.equal(scanForSecrets('ghp_0123456789abcdef0123456789abcdef0123').length, 1);
});

test('flags assignments to secret-looking variables', () => {
  assert.equal(scanForSecrets('DATABASE_PASSWORD="hunter2hunter2"').length, 1);
});

test('does not flag ordinary prose', () => {
  assert.deepEqual(scanForSecrets('We decided to use the API for auth.\nNo secrets here.'), []);
});

test('does not flag a fake credential inside an inline code span', () => {
  // Reproduces a real false positive found live in the wstg skill: a SQL
  // injection worked example quoting a made-up password value.
  const hits = scanForSecrets("`SELECT * FROM Users WHERE Username='\$u' AND Password='\$password'`");
  assert.deepEqual(hits, []);
});

test('does not flag a fake credential inside a fenced code block', () => {
  const hits = scanForSecrets('```\nAPI_TOKEN=abcdefgh12345678\n```\n');
  assert.deepEqual(hits, []);
});

test('does not flag a keyword that only appears inside a markdown link target', () => {
  // Reproduces a real false positive: an NIST/NCSC URL anchor containing the
  // literal text "PasswordGuidance:UpdatingYourApproach...".
  const hits = scanForSecrets(
    '[NCSC](https://example.com/passwords#PasswordGuidance:UpdatingYourApproachDontEnforce)'
  );
  assert.deepEqual(hits, []);
});

test('still flags a real-shaped key even inside a fenced code block or inline span', () => {
  const fenced = scanForSecrets('```\nsk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n```\n');
  assert.equal(fenced.length, 1);
  assert.equal(fenced[0].kind, 'anthropic-key');

  const inline = scanForSecrets('the leaked key was `AKIAIOSFODNN7EXAMPLE`');
  assert.equal(inline.length, 1);
  assert.equal(inline[0].kind, 'aws-access-key-id');
});

test('still flags a loose secret-looking assignment in plain, unfenced prose', () => {
  const hits = scanForSecrets('Config used in prod: STAGING_API_KEY=abcdefgh12345\nnothing else here');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 1);
});

test('detects cloud provider conflict artifacts', () => {
  const found = findProviderConflictArtifacts([
    'note.md',
    'note (1).md',
    "note (user's conflicted copy 2026-08-12).md",
    'note-DESKTOP-ABC123.md',
  ]);
  assert.equal(found.length, 3);
  assert.ok(!found.includes('note.md'));
});

test('runDoctor executes health checks on clean dir', async () => {
  const syncRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-doc-'));
  const checks = await runDoctor({ syncRoot, localRoots: [] });
  assert.equal(checks.length, 5);
  assert.ok(checks.every((c) => c.status === 'ok'));
});
