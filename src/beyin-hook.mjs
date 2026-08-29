import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig } from './config.mjs';

const run = promisify(execFile);

/**
 * A working Python 3, verified by running it - not just found on PATH. On
 * Windows, C:\...\WindowsApps\python3.exe exists and resolves even when
 * Python was never installed (a Microsoft Store shortcut); it only fails the
 * moment something actually calls it. avenoxbeyin's own PowerShell hooks hit
 * this exact trap and guard the same way (lib.ps1's Get-BeyinPython).
 */
export async function findWorkingPython(execFileFn = run) {
  for (const name of ['python3', 'python']) {
    try {
      const { stdout } = await execFileFn(name, ['-c', 'import sys; print(sys.version_info.major)']);
      if (stdout.trim() === '3') return name;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Called from a hook this project's .claude/settings.local.json links to a
 * vault with (see addProjectToBrain in vault.mjs). Invokes the linked
 * vault's own flush.py/compile.py directly rather than going through
 * avenoxbeyin's PowerShell hook layer: that layer resolves the vault it
 * writes to from $env:CLAUDE_PROJECT_DIR, which Claude Code always sets to
 * the *running* project - correct only when the running project IS the
 * vault. flush.py's own VAULT_ROOT is instead derived from its file's
 * location on disk, so calling it directly here targets the linked vault
 * correctly no matter which project the session actually happened in.
 *
 * Never throws and never blocks: a hook must not hold up or fail a session,
 * so every "can't do this" path is a silent no-op, and the engine itself is
 * always launched detached.
 */
export async function runBeyinHook({ event, payload, vaultPath, spawnFn = spawn, execFileFn = run }) {
  const resolvedVaultPath = vaultPath ?? (await loadConfig().catch(() => null))?.vaultPath;
  if (!resolvedVaultPath) return 0;

  const scriptsDir = path.join(resolvedVaultPath, '.claude', 'scripts');
  const flush = path.join(scriptsDir, 'flush.py');
  const flushExists = await fs
    .access(flush)
    .then(() => true)
    .catch(() => false);
  if (!flushExists) return 0;

  const python = await findWorkingPython(execFileFn);
  if (!python) return 0;

  if (event === 'sessionstart') {
    spawnFn(python, [flush, '--maybe-compile'], {
      cwd: resolvedVaultPath,
      detached: true,
      stdio: 'ignore',
    }).unref();
    return 0;
  }

  if (!payload || !payload.trim()) return 0;

  const stateDir = path.join(scriptsDir, '.state');
  await fs.mkdir(stateDir, { recursive: true });
  // Name must match flush.py's hookin-*.json pattern, or the file is never
  // cleaned up (see flush.py's _managed_hook_input).
  const hookIn = path.join(
    stateDir,
    `hookin-${process.pid}-${crypto.randomBytes(4).toString('hex')}.json`
  );
  await fs.writeFile(hookIn, payload, 'utf8');

  const args = [flush, '--hook-input', hookIn];
  if (event === 'precompact') args.push('--reason', 'precompact');
  spawnFn(python, args, { cwd: resolvedVaultPath, detached: true, stdio: 'ignore' }).unref();
  return 0;
}
