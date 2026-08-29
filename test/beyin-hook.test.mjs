import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findWorkingPython, runBeyinHook } from '../src/beyin-hook.mjs';
import { useIsolatedHome } from './helpers/isolated-home.mjs';

useIsolatedHome();

function fakeSpawn(calls) {
  return (command, args, options) => {
    calls.push({ command, args, options });
    return { unref() {} };
  };
}

/** execFile-shaped stub: resolves stdout for a name found in `usable`, otherwise rejects. */
function fakeExecFile(usable) {
  return async (name) => {
    if (!(name in usable)) throw new Error(`${name}: command not found`);
    return { stdout: usable[name] };
  };
}

async function makeVaultWithFlush() {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'as-beyin-vault-'));
  const scriptsDir = path.join(vault, '.claude', 'scripts');
  await fs.mkdir(scriptsDir, { recursive: true });
  await fs.writeFile(path.join(scriptsDir, 'flush.py'), '# stand-in for the real engine\n');
  return vault;
}

test('findWorkingPython picks python3 when it reports major version 3', async () => {
  const python = await findWorkingPython(fakeExecFile({ python3: '3\n' }));
  assert.equal(python, 'python3');
});

test('findWorkingPython falls back to python when python3 is not usable', async () => {
  const python = await findWorkingPython(fakeExecFile({ python: '3\n' }));
  assert.equal(python, 'python');
});

test('findWorkingPython returns null when nothing runnable reports major version 3', async () => {
  // Mirrors the Windows Store stub: the binary resolves and runs, but is not
  // a real interpreter - it produces no usable version line.
  const python = await findWorkingPython(fakeExecFile({ python3: '', python: '2\n' }));
  assert.equal(python, null);
});

test('runBeyinHook is a no-op when no vault is configured', async () => {
  const calls = [];
  const code = await runBeyinHook({
    event: 'sessionend',
    payload: '{"session_id":"abc"}',
    vaultPath: '',
    spawnFn: fakeSpawn(calls),
  });
  assert.equal(code, 0);
  assert.equal(calls.length, 0);
});

test('runBeyinHook is a no-op when the linked vault has no flush.py', async () => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'as-beyin-empty-'));
  const calls = [];
  const code = await runBeyinHook({
    event: 'sessionend',
    payload: '{"session_id":"abc"}',
    vaultPath: vault,
    spawnFn: fakeSpawn(calls),
  });
  assert.equal(code, 0);
  assert.equal(calls.length, 0);
});

test('runBeyinHook is a no-op when no working Python is found', async () => {
  const vault = await makeVaultWithFlush();
  const calls = [];
  const code = await runBeyinHook({
    event: 'sessionend',
    payload: '{"session_id":"abc"}',
    vaultPath: vault,
    spawnFn: fakeSpawn(calls),
    execFileFn: fakeExecFile({}),
  });
  assert.equal(code, 0);
  assert.equal(calls.length, 0);
});

test('sessionstart launches flush.py --maybe-compile and needs no payload', async () => {
  const vault = await makeVaultWithFlush();
  const calls = [];
  const code = await runBeyinHook({
    event: 'sessionstart',
    payload: '',
    vaultPath: vault,
    spawnFn: fakeSpawn(calls),
    execFileFn: fakeExecFile({ python3: '3\n' }),
  });
  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.command, 'python3');
  assert.deepEqual(call.args, [path.join(vault, '.claude', 'scripts', 'flush.py'), '--maybe-compile']);
  assert.equal(call.options.cwd, vault);
  assert.equal(call.options.detached, true);
});

test('sessionend with a blank payload does nothing', async () => {
  const vault = await makeVaultWithFlush();
  const calls = [];
  const code = await runBeyinHook({
    event: 'sessionend',
    payload: '   ',
    vaultPath: vault,
    spawnFn: fakeSpawn(calls),
    execFileFn: fakeExecFile({ python3: '3\n' }),
  });
  assert.equal(code, 0);
  assert.equal(calls.length, 0);
});

test('sessionend writes the payload to a hookin file and launches flush.py --hook-input', async () => {
  const vault = await makeVaultWithFlush();
  const calls = [];
  const payload = '{"session_id":"abc"}';
  await runBeyinHook({
    event: 'sessionend',
    payload,
    vaultPath: vault,
    spawnFn: fakeSpawn(calls),
    execFileFn: fakeExecFile({ python3: '3\n' }),
  });

  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.command, 'python3');
  assert.equal(call.args[0], path.join(vault, '.claude', 'scripts', 'flush.py'));
  assert.equal(call.args[1], '--hook-input');
  assert.match(path.basename(call.args[2]), /^hookin-.+\.json$/);
  assert.equal(await fs.readFile(call.args[2], 'utf8'), payload);
});

test('precompact adds --reason precompact', async () => {
  const vault = await makeVaultWithFlush();
  const calls = [];
  await runBeyinHook({
    event: 'precompact',
    payload: '{"session_id":"abc"}',
    vaultPath: vault,
    spawnFn: fakeSpawn(calls),
    execFileFn: fakeExecFile({ python3: '3\n' }),
  });

  const [call] = calls;
  assert.deepEqual(call.args.slice(-2), ['--reason', 'precompact']);
});
