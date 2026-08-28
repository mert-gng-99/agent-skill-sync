import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  isValidVault,
  resolveOsName,
  buildWindowsInstallArgs,
  buildSetupPrompt,
} from '../src/vault.mjs';
import { useIsolatedHome } from './helpers/isolated-home.mjs';

useIsolatedHome();

test('resolveOsName appends OS to the companion name', () => {
  assert.equal(resolveOsName('Echo'), 'EchoOS');
});

test('isValidVault checks for .beyin-version', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'as-vault-'));
  assert.equal(await isValidVault(dir), false);
  await fs.writeFile(path.join(dir, '.beyin-version'), '2.0.0\n');
  assert.equal(await isValidVault(dir), true);
});

test('isValidVault does not throw for a path that does not exist at all', async () => {
  const missing = path.join(os.tmpdir(), 'as-vault-does-not-exist');
  assert.equal(await isValidVault(missing), false);
});

test('buildWindowsInstallArgs matches install.ps1\'s exact param names and order', () => {
  const args = buildWindowsInstallArgs({
    repoDir: 'C:\\repo',
    vaultPath: 'C:\\vault',
    userName: 'Aylin',
    userBio: 'Designer',
    companion: 'Echo',
    osName: 'EchoOS',
  });
  assert.deepEqual(args, [
    '-NoProfile',
    '-File',
    path.join('C:\\repo', 'scripts', 'install.ps1'),
    '-VaultPath',
    'C:\\vault',
    '-UserName',
    'Aylin',
    '-UserBio',
    'Designer',
    '-Companion',
    'Echo',
    '-OsName',
    'EchoOS',
  ]);
});

test('buildSetupPrompt embeds every collected answer', () => {
  const prompt = buildSetupPrompt({
    userName: 'Aylin',
    userBio: 'Designer',
    companion: 'Echo',
    vaultPath: '/Users/aylin/Documents/EchoOS',
  });
  assert.match(prompt, /Read SETUP\.md and follow it exactly/);
  assert.match(prompt, /Aylin/);
  assert.match(prompt, /Designer/);
  assert.match(prompt, /Echo/);
  assert.match(prompt, /\/Users\/aylin\/Documents\/EchoOS/);
});
