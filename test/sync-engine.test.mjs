import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTION, decide, buildPlan } from '../src/sync-engine.mjs';
import { hashContent, statePath, loadState, saveState } from '../src/state.mjs';
import { useIsolatedHome } from './helpers/isolated-home.mjs';

useIsolatedHome();

test('identical sides do nothing', () => {
  assert.equal(decide({ localHash: 'a', remoteHash: 'a', baseHash: 'a' }), ACTION.SKIP);
});

test('local edited alone is pushed', () => {
  assert.equal(decide({ localHash: 'b', remoteHash: 'a', baseHash: 'a' }), ACTION.PUSH);
});

test('remote edited alone is pulled', () => {
  assert.equal(decide({ localHash: 'a', remoteHash: 'b', baseHash: 'a' }), ACTION.PULL);
});

test('both edited differently is a conflict', () => {
  assert.equal(decide({ localHash: 'b', remoteHash: 'c', baseHash: 'a' }), ACTION.CONFLICT);
});

test('both edited to the same content is not a conflict', () => {
  assert.equal(decide({ localHash: 'b', remoteHash: 'b', baseHash: 'a' }), ACTION.SKIP);
});

test('a brand new local file is pushed', () => {
  assert.equal(decide({ localHash: 'a', remoteHash: null, baseHash: null }), ACTION.PUSH);
});

test('a brand new remote file is pulled', () => {
  assert.equal(decide({ localHash: null, remoteHash: 'a', baseHash: null }), ACTION.PULL);
});

test('deletion does not propagate: locally deleted file comes back', () => {
  assert.equal(decide({ localHash: null, remoteHash: 'a', baseHash: 'a' }), ACTION.PULL);
});

test('deletion does not propagate: remotely deleted file is restored', () => {
  assert.equal(decide({ localHash: 'a', remoteHash: null, baseHash: 'a' }), ACTION.PUSH);
});

test('buildPlan covers the union of both sides and skips no-ops', () => {
  const local = new Map([['a.md', 'h1'], ['b.md', 'h2']]);
  const remote = new Map([['a.md', 'h1'], ['c.md', 'h3']]);
  const plan = buildPlan(local, remote, { 'a.md': 'h1' });
  const byPath = Object.fromEntries(plan.map((p) => [p.relPath, p.action]));
  assert.equal(byPath['a.md'], undefined); // skipped, not listed
  assert.equal(byPath['b.md'], ACTION.PUSH);
  assert.equal(byPath['c.md'], ACTION.PULL);
});

test('hashContent produces sha256 hex string', () => {
  const hash = hashContent(Buffer.from('hello world'));
  assert.equal(hash, 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
});

test('statePath returns state.json path in homeDir', () => {
  assert.ok(statePath().endsWith('state.json'));
});
