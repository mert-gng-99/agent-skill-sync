import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnChild } from '../src/run.mjs';

test('propagates the child exit code', async () => {
  assert.equal(await spawnChild(process.execPath, ['-e', 'process.exit(0)']), 0);
  assert.equal(await spawnChild(process.execPath, ['-e', 'process.exit(7)']), 7);
});

test('a child killed by a signal reports a non-zero code', async () => {
  const code = await spawnChild(process.execPath, ['-e', 'process.kill(process.pid, "SIGTERM")']);
  assert.notEqual(code, 0);
});

test('a command that does not exist reports non-zero instead of throwing', async () => {
  const code = await spawnChild('this-command-does-not-exist-12345', []);
  assert.notEqual(code, 0);
});
