#!/usr/bin/env node
import process from 'node:process';
import { loadConfig } from '../src/config.mjs';
import { runSync, syncPairs } from '../src/sync.mjs';
import { runDoctor } from '../src/doctor.mjs';
import { init } from '../src/init.mjs';
import { ensureIdentity, linkProject, forgetFile } from '../src/project.mjs';
import { applyAdapters, collectFromTools } from '../src/adapters/index.mjs';
import { runWrapped } from '../src/run.mjs';

const HELP = `agent-sync <command> [--dry-run]

  init                 Set up this machine: config, sync root, tool targets
  pull | push          Synchronise skills, memory and shared settings
  status               Show this machine, this project, targets and pending changes
  doctor               Health checks: conflicts, registry, secrets
  link <project-id>    Bind the current directory to an existing project
  forget <path>        Delete a file locally and remotely on purpose
  run <command...>     Pull, run the command, then push when it exits
`;

// Hooks and the VS Code extension call this binary. It must never take a
// session down with it.
const HOOK_SAFE = new Set(['pull', 'push']);

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const dryRun = rest.includes('--dry-run');
  const args = rest.filter((a) => a !== '--dry-run');

  if (!command || command === 'help' || command === '--help') {
    process.stdout.write(HELP);
    return 0;
  }
  if (command === 'init') return init({ dryRun });

  const config = await loadConfig();

  switch (command) {
    case 'pull':
    case 'push': {
      const identity = await ensureIdentity(config, process.cwd());
      // Read authored content out of the tools first, or there is nothing to push.
      if (!dryRun) {
        await collectFromTools({ config, projectId: identity.id, cwd: process.cwd() });
      }
      const { plan, conflicts } = await runSync({ config, dryRun });
      const prefix = dryRun ? '[dry-run] ' : '';
      for (const item of plan) {
        process.stdout.write(`${prefix}${item.action.padEnd(8)} ${item.pair}/${item.relPath}\n`);
      }
      if (!plan.length) process.stdout.write(`${prefix}already in sync\n`);
      // Distribute the freshly synced canonical content to the selected tools.
      const written = await applyAdapters({
        config,
        projectId: identity.id,
        cwd: process.cwd(),
        dryRun,
      });
      for (const target of written) {
        process.stdout.write(`${prefix}wrote    ${target.adapter} -> ${target.file}\n`);
      }
      for (const c of conflicts) {
        process.stdout.write(`conflict: ${c.pair}/${c.relPath} - your version kept as ${c.keptAs}\n`);
      }
      return 0;
    }
    case 'status': {
      const identity = await ensureIdentity(config, process.cwd(), { write: false });
      process.stdout.write(`machine:  ${config.machineId}\n`);
      process.stdout.write(`syncRoot: ${config.syncRoot}\n`);
      process.stdout.write(`targets:  ${config.targets.join(', ') || 'none'}\n`);
      process.stdout.write(`project:  ${identity.id} (matched by ${identity.source})\n`);
      const { plan } = await runSync({ config, dryRun: true });
      process.stdout.write(`pending:  ${plan.length} change(s)\n`);
      return 0;
    }
    case 'doctor': {
      const checks = await runDoctor({
        syncRoot: config.syncRoot,
        localRoots: syncPairs(config).map((p) => ({ dir: p.localDir })),
      });
      for (const c of checks) {
        process.stdout.write(`${c.status.toUpperCase().padEnd(5)} ${c.name}: ${c.details}\n`);
      }
      return checks.some((c) => c.status === 'fail') ? 1 : 0;
    }
    case 'link':
      return linkProject(config, process.cwd(), args[0]);
    case 'forget':
      return forgetFile(config, args[0], dryRun);
    case 'run':
      return runWrapped(config, args);
    default:
      process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
      return 1;
  }
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    process.stderr.write(`agent-sync: ${err.message}\n`);
    // Hook-invoked commands always exit 0 so a broken sync never blocks a session.
    process.exit(HOOK_SAFE.has(process.argv[2]) ? 0 : 1);
  });
