import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homeDir } from './paths.mjs';
import { loadConfig, saveConfig } from './config.mjs';

const run = promisify(execFile);
const AVENOXBEYIN_REMOTE = 'https://github.com/avenoxai/avenoxbeyin.git';

export function beyinRepoDir() {
  return path.join(homeDir(), 'avenoxbeyin');
}

/** avenoxbeyin writes this marker into every vault it creates. */
export async function isValidVault(vaultPath) {
  return fs
    .access(path.join(vaultPath, '.beyin-version'))
    .then(() => true)
    .catch(() => false);
}

/** "Echo" -> "EchoOS", matching avenoxbeyin's own default vault-folder naming. */
export function resolveOsName(companion) {
  return `${companion}OS`;
}

/**
 * Exact argument order/names match scripts/install.ps1's param() block:
 * VaultPath, UserName, Companion, OsName are required by the script itself;
 * UserBio is accepted but optional there too, so it is passed through as-is
 * (possibly empty) rather than special-cased here.
 */
export function buildWindowsInstallArgs({ repoDir, vaultPath, userName, userBio, companion, osName }) {
  return [
    '-NoProfile',
    '-File',
    path.join(repoDir, 'scripts', 'install.ps1'),
    '-VaultPath',
    vaultPath,
    '-UserName',
    userName,
    '-UserBio',
    userBio,
    '-Companion',
    companion,
    '-OsName',
    osName,
  ];
}

/**
 * Ready-to-paste command for the POSIX fresh-install flow, which agent-sync
 * does not automate itself (SETUP.md drives Homebrew/cask installs
 * unsupervised - see docs/vault-notes in the repo history for why that stays
 * a human-in-the-loop step). Bakes in the answers already collected so the
 * user is not asked twice.
 */
export function buildSetupPrompt({ userName, userBio, companion, vaultPath }) {
  return (
    `Read SETUP.md and follow it exactly to set up my second brain. ` +
    `Kullanıcı adı: ${userName}. Kullanıcı özeti: ${userBio}. ` +
    `Companion adı: ${companion}. Vault yolu: ${vaultPath}.`
  );
}

/** Clones avenoxbeyin on first use, otherwise fast-forwards it in place. */
export async function ensureRepoCloned() {
  const dir = beyinRepoDir();
  const exists = await fs
    .access(path.join(dir, '.git'))
    .then(() => true)
    .catch(() => false);
  if (exists) {
    await run('git', ['-C', dir, 'pull', '--ff-only']).catch(() => {});
  } else {
    await fs.mkdir(homeDir(), { recursive: true });
    await run('git', ['clone', AVENOXBEYIN_REMOTE, dir]);
  }
  return dir;
}

/**
 * Runs the real install.ps1 call directly - no separate preflight step: the
 * script's own first action is Invoke-BeyinPreflight, and it writes nothing
 * to disk before that passes (see scripts/install.ps1 lines ~240-242).
 * Returns { ok, message } - never throws, matching this module's other
 * fs-touching functions (isValidVault, ensureRepoCloned).
 */
export async function runWindowsInstall(answers) {
  const repoDir = await ensureRepoCloned();
  const args = buildWindowsInstallArgs({ repoDir, ...answers });
  try {
    const { stdout } = await run('pwsh.exe', args);
    return { ok: true, message: stdout };
  } catch (err) {
    // execFile rejects on non-zero exit; stdout/stderr are still on the error.
    const out = [err.stdout, err.stderr].filter(Boolean).join('\n');
    return { ok: false, message: out || err.message };
  }
}

async function askAnswers(rl) {
  const userName = (await rl.question('Adın ne? ')).trim();
  const userBio = (await rl.question('Ne iş yapıyorsun? (1-2 cümle, boş geçilebilir): ')).trim();
  const companion = (await rl.question('AI ortağına ne ad vermek istersin? ')).trim();
  const osName = resolveOsName(companion);
  const defaultVaultPath = path.join(os.homedir(), 'Documents', osName);
  const vaultPathAnswer = (
    await rl.question(`Vault nereye kurulsun? [${defaultVaultPath}]: `)
  ).trim();
  const vaultPath = vaultPathAnswer || defaultVaultPath;
  return { userName, userBio, companion, osName, vaultPath };
}

/**
 * `agent-sync vault` (no path arg): platform-aware guided setup.
 * `agent-sync vault <path>`: link-only - validates an existing vault and
 * writes vaultPath into config.json, no install attempted.
 */
export async function vaultCommand({ args, dryRun }) {
  const config = await loadConfig();

  if (args[0]) {
    const vaultPath = path.resolve(args[0]);
    if (!(await isValidVault(vaultPath))) {
      process.stderr.write(
        `${vaultPath} bir avenoxbeyin vault'u gibi görünmüyor (.beyin-version bulunamadı).\n`
      );
      return 1;
    }
    if (dryRun) {
      process.stdout.write(`[dry-run] would set vaultPath = ${vaultPath}\n`);
      return 0;
    }
    await saveConfig({ ...config, vaultPath });
    process.stdout.write(`Bağlandı: vaultPath = ${vaultPath}\n`);
    return 0;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answers = await askAnswers(rl);
  rl.close();

  if (process.platform === 'win32') {
    if (dryRun) {
      process.stdout.write(`[dry-run] would run install.ps1 for ${answers.vaultPath}\n`);
      return 0;
    }
    const result = await runWindowsInstall(answers);
    process.stdout.write(result.message + '\n');
    if (!result.ok) return 1;
    await saveConfig({ ...config, vaultPath: answers.vaultPath });
    process.stdout.write(`\nBağlandı: vaultPath = ${answers.vaultPath}\n`);
    process.stdout.write('Doğrulamak için: agent-sync doctor\n');
    return 0;
  }

  // POSIX: guided only, never auto-installs (see Context above for why).
  const repoDir = dryRun ? beyinRepoDir() : await ensureRepoCloned();
  process.stdout.write('\nBu komutu kendi terminalinde çalıştır:\n\n');
  process.stdout.write(`  cd ${repoDir}\n`);
  process.stdout.write(`  claude "${buildSetupPrompt(answers)}"\n\n`);
  process.stdout.write(
    `Kurulum bittikten sonra: agent-sync vault ${answers.vaultPath}\n`
  );
  return 0;
}
