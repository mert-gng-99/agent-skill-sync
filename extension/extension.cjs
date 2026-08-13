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
      import('../src/registry.mjs'),
    ]).then(([config, sync, adapters, project, doctor, registry]) => ({
      DEFAULT_CONFIG: config.DEFAULT_CONFIG,
      validateConfig: config.validateConfig,
      loadConfig: config.loadConfig,
      saveConfig: config.saveConfig,
      runSync: sync.runSync,
      syncPairs: sync.syncPairs,
      applyAdapters: adapters.applyAdapters,
      collectFromTools: adapters.collectFromTools,
      ensureIdentity: project.ensureIdentity,
      linkProject: project.linkProject,
      readMarker: project.readMarker,
      runDoctor: doctor.runDoctor,
      loadRegistry: registry.loadRegistry,
    }));
  }
  return enginePromise;
}

/**
 * VS Code's Settings UI reports "" / [] for anything the user never touched -
 * there is no way to distinguish "unset" from "deliberately cleared" in the
 * declarative settings schema. Treating an unset value as authoritative would
 * mean opening the extension on a machine already configured via `init`
 * silently wipes its config.json back to empty. So only a genuinely non-empty
 * VS Code value overrides the file; anything else leaves the file alone.
 */
function mergeVsCodeSettings(fileConfig, vsCodeSettings) {
  const merged = { ...fileConfig };
  if (vsCodeSettings.syncRoot) merged.syncRoot = vsCodeSettings.syncRoot;
  if (vsCodeSettings.machineId) merged.machineId = vsCodeSettings.machineId;
  if (vsCodeSettings.targets && vsCodeSettings.targets.length > 0) {
    merged.targets = vsCodeSettings.targets;
  }
  // Booleans have no "empty" value to signal "untouched" the way "" or []
  // do above - false is just as meaningful as true - so this field alone
  // is read with getConfiguration().inspect() and arrives as undefined
  // when the user genuinely never set it, never as a stand-in default.
  if (vsCodeSettings.syncTranscripts !== undefined) {
    merged.syncTranscripts = vsCodeSettings.syncTranscripts;
  }
  return merged;
}

function readVsCodeSettings() {
  const cfg = vscode.workspace.getConfiguration('agent-sync');
  const transcripts = cfg.inspect('syncTranscripts');
  return {
    syncRoot: cfg.get('syncRoot', ''),
    machineId: cfg.get('machineId', ''),
    targets: cfg.get('targets', []),
    syncTranscripts: transcripts?.workspaceValue ?? transcripts?.globalValue,
  };
}

/**
 * Makes the Settings UI a real control surface instead of a cosmetic one:
 * whatever the user sets there is folded into ~/.agent-sync/config.json,
 * the single file the CLI and this extension both read. This also lets a
 * fresh install be configured entirely from Settings, with no terminal.
 */
async function applyVsCodeSettings() {
  const { DEFAULT_CONFIG, validateConfig, loadConfig, saveConfig } = await engine();
  const fileConfig = await loadConfig().catch(() => DEFAULT_CONFIG);
  const merged = mergeVsCodeSettings(fileConfig, readVsCodeSettings());
  if (JSON.stringify(merged) === JSON.stringify(fileConfig)) return;
  if (!validateConfig(merged).ok) return; // Still missing syncRoot or machineId - nothing to save yet.
  await saveConfig(merged);
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
 *
 * `requireExisting` guards against silently turning whatever folder happens
 * to be the open workspace into a brand-new synced "project". Automatic
 * triggers (startup, focus change, a settings edit) run with this on: if the
 * folder has no marker yet, they do nothing rather than create one - a
 * workspace root is often a container folder (Desktop, home) opened for
 * unrelated reasons, not something the user meant to link. Creating a new
 * project is only ever allowed from an explicit action: the "Sync now" and
 * "Link this folder to a project" commands, both requested by a real click.
 *
 * Never throws into VS Code - failures surface in the status bar and the
 * output channel, they do not interrupt the user.
 */
async function sync({ silent, direction = 'both', requireExisting = false }) {
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
    const { loadConfig, runSync, applyAdapters, collectFromTools, ensureIdentity, readMarker } =
      await engine();
    const config = await loadConfig();

    if (requireExisting && !(await readMarker(cwd))) {
      statusItem.text = '$(circle-slash) agent-sync: not linked';
      statusItem.tooltip =
        'This folder is not linked to a project yet. Run "agent-sync: Sync now" or ' +
        '"agent-sync: Link this folder to a project" to set it up.';
      return;
    }

    const identity = await ensureIdentity(config, cwd);

    if (!identity.id) {
      // The workspace root is the user's home directory - never a project on
      // its own. Say so calmly rather than treating it as an error.
      statusItem.text = '$(home) agent-sync: home dir';
      statusItem.tooltip = 'The open folder is your home directory, which agent-sync never syncs.';
      if (!silent) output.appendLine('Home directory is not a project - nothing to sync.');
      return;
    }

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
    if (!silent) {
      output.appendLine(`Synced ${plan.length} change(s) for ${identity.id}`);
      // A button click that produces no visible response reads as broken -
      // the tooltip already has this, but a tooltip only shows on hover.
      vscode.window.showInformationMessage(
        problems
          ? `agent-sync: synced with ${problems} issue(s) - see the Output panel.`
          : `agent-sync: ${plan.length} change(s) synced for ${identity.id}.`
      );
    }
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

async function activate(context) {
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
    // Shows the resolved project (like the old version) AND lets the user
    // pick a different one from the registry, or start a fresh one - the
    // command was named "Link this folder to a project" but used to only
    // display a guess, with no way to act on it if the guess was wrong.
    vscode.commands.registerCommand('agent-sync.link', async () => {
      const cwd = workspaceRoot();
      if (!cwd) {
        vscode.window.showWarningMessage('agent-sync: open a folder first.');
        return;
      }
      const { loadConfig, ensureIdentity, loadRegistry, linkProject } = await engine();
      const config = await loadConfig();
      const current = await ensureIdentity(config, cwd, { write: false });
      const registry = await loadRegistry(config.syncRoot);

      const createNew = { label: '$(add) Create a new project id for this folder', id: null };
      const known = Object.entries(registry.projects).map(([id, p]) => ({
        label: p.name,
        description: id === current.id ? `${id} - current guess` : id,
        id,
      }));

      const picked = await vscode.window.showQuickPick([createNew, ...known], {
        placeHolder: current.id
          ? `Currently resolves to ${current.id} (matched by ${current.source}) - pick a different project, or create new`
          : 'No project matched yet - pick one, or create new',
      });
      if (!picked) return;

      if (picked.id === null) {
        const identity = await ensureIdentity(config, cwd, { write: true });
        vscode.window.showInformationMessage(`Linked this folder to a new project: ${identity.id}`);
      } else {
        const code = await linkProject(config, cwd, picked.id);
        if (code === 0) {
          vscode.window.showInformationMessage(`Linked this folder to ${picked.id}.`);
        } else {
          vscode.window.showErrorMessage(`agent-sync: could not link to ${picked.id}.`);
        }
      }
      sync({ silent: false, direction: 'both' });
    }),
    // Focus regained means another machine may have pushed since we last looked.
    // Focus lost is the moment to send up whatever this session produced.
    vscode.window.onDidChangeWindowState((s) => {
      sync({ silent: true, direction: s.focused ? 'in' : 'out', requireExisting: true });
    }),
    // The Settings UI is the point of this listener: a change there should
    // reach config.json (and the next sync) without reloading the window.
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (!e.affectsConfiguration('agent-sync')) return;
      await applyVsCodeSettings();
      sync({ silent: true, direction: 'both', requireExisting: true });
    })
  );

  await applyVsCodeSettings();
  sync({ silent: true, direction: 'in', requireExisting: true });
}

function deactivate() {
  return sync({ silent: true, direction: 'out', requireExisting: true });
}

module.exports = { activate, deactivate, mergeVsCodeSettings };
