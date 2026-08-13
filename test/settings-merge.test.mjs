import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHARED_KEYS, extractShared, mergeShared } from '../src/settings-merge.mjs';

test('shares exactly the four agreed keys', () => {
  assert.deepEqual(SHARED_KEYS, ['enabledPlugins', 'extraKnownMarketplaces', 'model', 'effortLevel']);
});

test('extract picks up only shared keys that are present', () => {
  const out = extractShared({ model: 'opus', hooks: { Stop: [] }, permissions: { allow: [] } });
  assert.deepEqual(out, { model: 'opus' });
});

test('merge never clobbers machine-local keys', () => {
  const local = { model: 'sonnet', hooks: { Stop: ['x'] }, permissions: { allow: ['a'] } };
  const merged = mergeShared(local, { model: 'opus', effortLevel: 'xhigh' });
  assert.deepEqual(merged, {
    model: 'opus',
    effortLevel: 'xhigh',
    hooks: { Stop: ['x'] },
    permissions: { allow: ['a'] },
  });
});

test('merge does not mutate its input', () => {
  const local = { model: 'sonnet' };
  mergeShared(local, { model: 'opus' });
  assert.equal(local.model, 'sonnet');
});
