import vscode from 'vscode';
import { loadConfig } from '../src/config.mjs';
import { runSync, syncPairs } from '../src/sync.mjs';
import { applyAdapters, collectFromTools } from '../src/adapters/index.mjs';
import { ensureIdentity } from '../src/project.mjs';
import { runDoctor } from '../src/doctor.mjs';

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
  if (!cwd) return;
  try {
    const config = await loadConfig();
    const identity = await ensureIdentity(config, cwd);

    if (direction !== 'in') {
      await collectFromTools({ config, projectId: identity.id, cwd });
    }
    const { plan, conflicts } = await runSync({ config, dryRun: false });
    if (direction !== 'out') {
      await applyAdapters({ config, projectId: identity.id, cwd, dryRun: false });
    }

    const time = new Date().toLocaleTimeString();
    statusItem.text = conflicts.length
      ? `$(warning) agent-sync ${conflicts.length} conflict(s)`
      : `$(sync) agent-sync ${time}`;
    statusItem.backgroundColor = conflicts.length
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined;
    statusItem.tooltip = `${plan.length} change(s) synced at ${time}\nProject: ${identity.id}`;
    if (!silent) output.appendLine(`Synced ${plan.length} change(s) for ${identity.id}`);
  } catch (err) {
    statusItem.text = '$(error) agent-sync';
    statusItem.tooltip = String(err.message);
    output.appendLine(`Sync failed: ${err.message}`);
  }
}

export function activate(context) {
  output = vscode.window.createOutputChannel('agent-sync');
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.command = 'agent-sync.sync';
  statusItem.text = '$(sync) agent-sync';
  statusItem.show();

  context.subscriptions.push(
    statusItem,
    output,
    vscode.commands.registerCommand('agent-sync.sync', () => sync({ silent: false, direction: 'both' })),
    vscode.commands.registerCommand('agent-sync.doctor', async () => {
      const config = await loadConfig();
      const checks = await runDoctor({
        syncRoot: config.syncRoot,
        localRoots: syncPairs(config).map((p) => ({ dir: p.localDir })),
      });
      output.clear();
      for (const c of checks) output.appendLine(`${c.status.toUpperCase()}  ${c.name}: ${c.details}`);
      output.show();
    }),
    vscode.commands.registerCommand('agent-sync.link', async () => {
      const cwd = workspaceRoot();
      if (!cwd) return;
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

export function deactivate() {
  return sync({ silent: true, direction: 'out' });
}
