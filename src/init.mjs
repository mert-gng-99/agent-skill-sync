import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { DEFAULT_CONFIG, saveConfig, validateConfig, configPath } from './config.mjs';
import { detectInstalled, byId } from './adapters/index.mjs';
import { stagedDir } from './paths.mjs';

/** Turns "1,3" into adapter ids. Unknown or out-of-range entries are dropped. */
export function parseSelection(input, options) {
  const picked = [];
  for (const raw of input.split(',')) {
    const n = Number.parseInt(raw.trim(), 10);
    if (!Number.isInteger(n)) continue;
    const id = options[n - 1];
    if (id && !picked.includes(id)) picked.push(id);
  }
  return picked;
}

export async function init({ dryRun }) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const syncRoot = (await rl.question('Path to the shared sync folder (syncRoot): ')).trim();
  const machineId = (await rl.question('Short name for this machine (e.g. macbook): ')).trim();

  const detected = await detectInstalled();
  process.stdout.write('\nTools found on this machine:\n');
  detected.forEach((d, i) => {
    process.stdout.write(`  ${i + 1}. ${d.label}${d.installed ? '' : '  (not detected)'}\n`);
  });
  const answer = await rl.question('\nWhich should agent-sync write to? (e.g. 1,2): ');
  const targets = parseSelection(answer, detected.map((d) => d.id));

  const wantHooks =
    targets.includes('claude') &&
    /^y/i.test(await rl.question('Install Claude Code hooks for terminal use? [y/N]: '));
  rl.close();

  const config = { ...DEFAULT_CONFIG, syncRoot, machineId, targets };
  const { ok, errors } = validateConfig(config);
  if (!ok) {
    process.stderr.write(`Invalid input: ${errors.join('; ')}\n`);
    return 1;
  }

  if (dryRun) {
    process.stdout.write(`[dry-run] would write ${configPath()}\n`);
    process.stdout.write(`[dry-run] would create ${syncRoot} skeleton\n`);
    process.stdout.write(`[dry-run] would create ${stagedDir()}\n`);
    process.stdout.write(`[dry-run] targets: ${targets.join(', ') || 'none'}\n`);
    if (wantHooks) process.stdout.write('[dry-run] would install Claude Code hooks\n');
    return 0;
  }

  for (const dir of ['skills', 'memory/_global', 'shared']) {
    await fs.mkdir(path.join(syncRoot, ...dir.split('/')), { recursive: true });
    await fs.mkdir(path.join(stagedDir(), ...dir.split('/')), { recursive: true });
  }
  await saveConfig(config);
  if (wantHooks) await byId('claude').installHooks();

  process.stdout.write('Done. Run "agent-sync doctor" to verify.\n');
  return 0;
}
