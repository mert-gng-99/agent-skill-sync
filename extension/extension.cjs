const vscode = require('vscode');

/**
 * The extension host loads this entry point with require(), so it must be
 * CommonJS. The engine under src/ stays ESM and is pulled in with a dynamic
 * import the first time a command runs - that works from CommonJS on every
 * supported Node version, and keeps a single copy of the engine shared with
 * the CLI.
 */
let enginePromise;
function engine() {
  if (!enginePromise) {
    enginePromise = Promise.all([
      import('../src/config.mjs'),
      import('../src/sync.mjs'),
      import('../src/adapters/index.mjs'),
      import('../src/project.mjs'),
      import('../src/doctor.mjs'),
    ]).then(([config, sync, adapters, project, doctor]) => ({
      loadConfig: config.loadConfig,
      runSync: sync.runSync,
      syncPairs: sync.syncPairs,
      applyAdapters: adapters.applyAdapters,
      collectFromTools: adapters.collectFromTools,
      ensureIdentity: project.ensureIdentity,
      runDoctor: doctor.runDoctor,
    }));
  }
  return enginePromise;
}

let statusItem;
let output;

function workspaceRoot() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
}

/**
 * One sync pass. `direction` decides which half of the round trip runs:
 *   'in'   - bring remote changes down and write them into the tools
 *   'out'  - read what the tools authored and send it up
 *   'both' - the manual command; do the full round trip
 * Never throws into VS Code - failures surface in the status bar and the
 * output channel, they do not interrupt the user.
 */
async function sync({ silent, direction = 'both' }) {
  const cwd = workspaceRoot();
  if (!cwd) {
    // Without an open folder there is no project to resolve. Say so instead of
    // returning in silence - a status item that never reacts reads as broken.
    statusItem.text = '$(folder) agent-sync: no folder';
    statusItem.tooltip = 'Open a folder so agent-sync can tell which project this is.';
    if (!silent) {
      vscode.window.showWarningMessage('agent-sync: open a folder first.');
    }
    return;
  }
  try {
    const { loadConfig, runSync, applyAdapters, collectFromTools, ensureIdentity } =
      await engine();
    const config = await loadConfig();
    const identity = await ensureIdentity(config, cwd);

    if (direction !== 'in') {
      await collectFromTools({ config, projectId: identity.id, cwd });
    }
    const { plan, conflicts, blocked } = await runSync({ config, dryRun: false });
    if (direction !== 'out') {
      await applyAdapters({ config, projectId: identity.id, cwd, dryRun: false });
    }

    const time = new Date().toLocaleTimeString();
    const problems = conflicts.length + blocked.length;
    statusItem.text = problems
      ? `$(warning) agent-sync ${problems} issue(s)`
      : `$(sync) agent-sync ${time}`;
    statusItem.backgroundColor = problems
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined;
    statusItem.tooltip = `${plan.length} change(s) synced at ${time}\nProject: ${identity.id}`;

    for (const b of blocked) {
      output.appendLine(`Withheld ${b.pair}/${b.relPath} - looks like a secret. Not pushed.`);
    }
    if (!silent) output.appendLine(`Synced ${plan.length} change(s) for ${identity.id}`);
  } catch (err) {
    // Nothing configured yet is the common first-run case, not a failure.
    // Tell the user how to fix it rather than logging into a hidden channel.
    const needsSetup = err.code === 'ENOENT' || /config/i.test(err.message);
    statusItem.text = needsSetup ? '$(gear) agent-sync: setup needed' : '$(error) agent-sync';
    statusItem.tooltip = needsSetup
      ? 'Not configured on this machine yet. Run: node bin/agent-sync.mjs init'
      : String(err.message);
    output.appendLine(needsSetup ? `Not configured: ${err.message}` : `Sync failed: ${err.message}`);
    if (!silent) {
      vscode.window.showWarningMessage(
        needsSetup
          ? 'agent-sync is not set up on this machine yet. Run "node bin/agent-sync.mjs init".'
          : `agent-sync failed: ${err.message}`
      );
    }
  }
}

function activate(context) {
  output = vscode.window.createOutputChannel('agent-sync');
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.command = 'agent-sync.sync';
  statusItem.text = '$(sync) agent-sync';
  statusItem.show();

  context.subscriptions.push(
    statusItem,
    output,
    vscode.commands.registerCommand('agent-sync.sync', () =>
      sync({ silent: false, direction: 'both' })
    ),
    vscode.commands.registerCommand('agent-sync.doctor', async () => {
      const { loadConfig, runDoctor, syncPairs } = await engine();
      const config = await loadConfig();
      const checks = await runDoctor({
        syncRoot: config.syncRoot,
        localRoots: syncPairs(config).map((p) => ({ dir: p.localDir })),
      });
      output.clear();
      for (const c of checks) {
        output.appendLine(`${c.status.toUpperCase()}  ${c.name}: ${c.details}`);
      }
      output.show();
    }),
    vscode.commands.registerCommand('agent-sync.link', async () => {
      const cwd = workspaceRoot();
      if (!cwd) return;
      const { loadConfig, ensureIdentity } = await engine();
      const config = await loadConfig();
      const identity = await ensureIdentity(config, cwd, { write: false });
      vscode.window.showInformationMessage(
        `This folder resolves to ${identity.id} (matched by ${identity.source}).`
      );
    }),
    // Focus regained means another machine may have pushed since we last looked.
    // Focus lost is the moment to send up whatever this session produced.
    vscode.window.onDidChangeWindowState((s) => {
      sync({ silent: true, direction: s.focused ? 'in' : 'out' });
    })
  );

  sync({ silent: true, direction: 'in' });
}

function deactivate() {
  return sync({ silent: true, direction: 'out' });
}

module.exports = { activate, deactivate };
