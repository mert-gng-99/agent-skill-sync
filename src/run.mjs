import { spawn } from 'node:child_process';
import process from 'node:process';
import { runSync } from './sync.mjs';
import { applyAdapters, collectFromTools } from './adapters/index.mjs';
import { ensureIdentity } from './project.mjs';

/**
 * Runs a command with stdio inherited so interactive TUIs behave normally.
 * Never throws: a missing binary or a fatal signal comes back as a code.
 */
export function spawnChild(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: false });
    child.on('error', () => resolve(127));
    child.on('close', (code, signal) => resolve(signal ? 128 : (code ?? 0)));
  });
}

export async function runWrapped(config, argv) {
  if (argv.length === 0) {
    process.stderr.write('Usage: agent-sync run <command> [args...]\n');
    return 1;
  }
  const cwd = process.cwd();
  const identity = await ensureIdentity(config, cwd);

  await runSync({ config, dryRun: false });
  await applyAdapters({ config, projectId: identity.id, cwd, dryRun: false });

  const code = await spawnChild(argv[0], argv.slice(1));

  // Push whatever the session produced, however the command ended.
  await collectFromTools({ config, projectId: identity.id, cwd });
  await runSync({ config, dryRun: false });
  return code;
}
