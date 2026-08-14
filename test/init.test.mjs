import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSelection } from '../src/init.mjs';
import { buildHooks } from '../src/adapters/claude.mjs';

const options = ['claude', 'codex', 'opencode'];

test('parses a comma separated list of numbers', () => {
  assert.deepEqual(parseSelection('1,3', options), ['claude', 'opencode']);
});

test('tolerates spaces and repeated entries', () => {
  assert.deepEqual(parseSelection(' 2 , 2, 1 ', options), ['codex', 'claude']);
});

test('an empty answer selects nothing', () => {
  assert.deepEqual(parseSelection('', options), []);
});

test('out of range numbers are ignored rather than fatal', () => {
  assert.deepEqual(parseSelection('1,9', options), ['claude']);
});

test('installs a SessionStart pull and a Stop push', () => {
  const settings = buildHooks({});
  assert.ok(JSON.stringify(settings.hooks.SessionStart).includes('pull'));
  assert.ok(JSON.stringify(settings.hooks.Stop).includes('push'));
});

test('the installed hook commands carry --hook, so they never create a new project', () => {
  // Hooks fire for every Claude Code session regardless of cwd - a session
  // opened in an arbitrary folder (Desktop, a client's repo, anywhere) must
  // never turn that folder into a tracked project on its own. Only a marker
  // already there means the hook is allowed to sync it. See --hook in
  // bin/agent-sync.mjs.
  const settings = buildHooks({});
  const sessionStart = JSON.stringify(settings.hooks.SessionStart);
  const stop = JSON.stringify(settings.hooks.Stop);
  assert.match(sessionStart, /pull --hook/);
  assert.match(stop, /push --hook/);
});

test('keeps hooks the user already had', () => {
  const existing = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } };
  const settings = buildHooks(existing);
  assert.ok(JSON.stringify(settings.hooks.Stop).includes('echo mine'));
  assert.ok(JSON.stringify(settings.hooks.Stop).includes('push'));
});

test('running init twice does not duplicate our hooks', () => {
  const twice = buildHooks(buildHooks({}));
  assert.equal(twice.hooks.Stop.length, 1);
  assert.equal(twice.hooks.SessionStart.length, 1);
});

test('leaves unrelated settings untouched', () => {
  const settings = buildHooks({ model: 'opus', permissions: { allow: ['a'] } });
  assert.equal(settings.model, 'opus');
  assert.deepEqual(settings.permissions, { allow: ['a'] });
});
