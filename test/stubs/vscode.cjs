/**
 * Minimal stand-in for the `vscode` module, which only exists inside the
 * extension host. It lets the test suite actually load and activate the
 * extension entry point - the one failure mode no manifest check can catch.
 *
 * `workspaceFolders` is deliberately undefined so every sync() call returns
 * before touching the disk: this stub verifies wiring, not sync behaviour.
 */
const disposable = () => ({ dispose() {} });

const registeredCommands = [];

module.exports = {
  StatusBarAlignment: { Left: 1, Right: 2 },
  ThemeColor: class ThemeColor {
    constructor(id) {
      this.id = id;
    }
  },
  window: {
    createOutputChannel: () => ({
      appendLine() {},
      clear() {},
      show() {},
      dispose() {},
    }),
    createStatusBarItem: () => ({
      text: '',
      tooltip: '',
      command: '',
      backgroundColor: undefined,
      show() {},
      dispose() {},
    }),
    onDidChangeWindowState: () => disposable(),
    showInformationMessage: () => {},
  },
  commands: {
    registerCommand: (id, handler) => {
      registeredCommands.push({ id, handler });
      return disposable();
    },
  },
  workspace: {
    workspaceFolders: undefined,
    // Empty defaults, matching what VS Code reports for settings the user
    // never touched - exercises the "must not clobber config.json" path.
    getConfiguration: () => ({
      get: (key, fallback) => fallback,
    }),
    onDidChangeConfiguration: () => disposable(),
  },
  __registeredCommands: registeredCommands,
};
