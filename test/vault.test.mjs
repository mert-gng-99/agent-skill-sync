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
  buildBeyinHooks,
  addProjectToBrain,
} from '../src/vault.mjs';
import { loadConfig, saveConfig } from '../src/config.mjs';
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

test('buildBeyinHooks wires SessionEnd, PreCompact and SessionStart to beyin-hook', () => {
  const settings = buildBeyinHooks({});
  assert.match(JSON.stringify(settings.hooks.SessionEnd), /beyin-hook --event sessionend/);
  assert.match(JSON.stringify(settings.hooks.PreCompact), /beyin-hook --event precompact/);
  assert.match(JSON.stringify(settings.hooks.SessionStart), /beyin-hook --event sessionstart/);
});

test('buildBeyinHooks keeps hooks the user already had', () => {
  const existing = { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } };
  const settings = buildBeyinHooks(existing);
  assert.ok(JSON.stringify(settings.hooks.SessionStart).includes('echo mine'));
  assert.ok(JSON.stringify(settings.hooks.SessionStart).includes('beyin-hook'));
});

test('buildBeyinHooks leaves unrelated settings untouched', () => {
  const settings = buildBeyinHooks({ model: 'opus', permissions: { allow: ['a'] } });
  assert.equal(settings.model, 'opus');
  assert.deepEqual(settings.permissions, { allow: ['a'] });
});

test('running buildBeyinHooks twice does not duplicate our hooks', () => {
  const twice = buildBeyinHooks(buildBeyinHooks({}));
  assert.equal(twice.hooks.SessionEnd.length, 1);
  assert.equal(twice.hooks.PreCompact.length, 1);
  assert.equal(twice.hooks.SessionStart.length, 1);
});

test('addProjectToBrain refuses when no vault is linked on this machine', async () => {
  await saveConfig({ syncRoot: '/sync', machineId: 'm1', targets: [], vaultPath: '' });
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'as-brain-proj-'));
  const result = await addProjectToBrain(cwd);
  assert.equal(result.ok, false);
  assert.match(result.message, /Önce bir vault bağla/);
});

test('addProjectToBrain refuses when vaultPath does not point at a real vault', async () => {
  const notAVault = await fs.mkdtemp(path.join(os.tmpdir(), 'as-not-a-vault-'));
  await saveConfig({ syncRoot: '/sync', machineId: 'm1', targets: [], vaultPath: notAVault });
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'as-brain-proj-'));
  const result = await addProjectToBrain(cwd);
  assert.equal(result.ok, false);
  assert.match(result.message, /gibi görünmüyor/);
});

test('addProjectToBrain writes hooks into this project\'s own settings.local.json, never settings.json', async () => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'as-vault-'));
  await fs.writeFile(path.join(vault, '.beyin-version'), '2.0.0\n');
  await saveConfig({ syncRoot: '/sync', machineId: 'm1', targets: [], vaultPath: vault });

  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'as-brain-proj-'));
  const result = await addProjectToBrain(cwd);
  assert.equal(result.ok, true);
  assert.match(result.message, new RegExp(vault.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const written = JSON.parse(
    await fs.readFile(path.join(cwd, '.claude', 'settings.local.json'), 'utf8')
  );
  assert.match(JSON.stringify(written.hooks.SessionEnd), /beyin-hook --event sessionend/);
  await assert.rejects(fs.access(path.join(cwd, '.claude', 'settings.json')));
});

test('addProjectToBrain is idempotent - a second run does not duplicate hooks', async () => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'as-vault-'));
  await fs.writeFile(path.join(vault, '.beyin-version'), '2.0.0\n');
  await saveConfig({ syncRoot: '/sync', machineId: 'm1', targets: [], vaultPath: vault });

  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'as-brain-proj-'));
  await addProjectToBrain(cwd);
  await addProjectToBrain(cwd);

  const written = JSON.parse(
    await fs.readFile(path.join(cwd, '.claude', 'settings.local.json'), 'utf8')
  );
  assert.equal(written.hooks.SessionEnd.length, 1);
});
