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
const outputLines = [];

module.exports = {
  StatusBarAlignment: { Left: 1, Right: 2 },
  ThemeColor: class ThemeColor {
    constructor(id) {
      this.id = id;
    }
  },
  window: {
    createOutputChannel: () => ({
      appendLine(line) {
        outputLines.push(line);
      },
      clear() {
        outputLines.length = 0;
      },
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
    showWarningMessage: () => {},
    showErrorMessage: () => {},
    showQuickPick: async () => undefined, // "user pressed Escape" by default
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
      // undefined/undefined matches what VS Code reports for a setting the
      // user never touched - exercises the "leave the file alone" path.
      inspect: () => ({ workspaceValue: undefined, globalValue: undefined }),
    }),
    onDidChangeConfiguration: () => disposable(),
  },
  __registeredCommands: registeredCommands,
  __outputLines: outputLines,
};
