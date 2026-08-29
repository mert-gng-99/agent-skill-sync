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
const executedCommands = [];
const statusBarItems = [];
const openedUris = [];

module.exports = {
  StatusBarAlignment: { Left: 1, Right: 2 },
  ThemeColor: class ThemeColor {
    constructor(id) {
      this.id = id;
    }
  },
  Uri: {
    parse: (s) => ({ toString: () => s, _raw: s }),
  },
  env: {
    openExternal: async (uri) => {
      openedUris.push(uri.toString());
    },
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
    createStatusBarItem: () => {
      const item = {
        text: '',
        tooltip: '',
        command: '',
        backgroundColor: undefined,
        show() {},
        dispose() {},
      };
      statusBarItems.push(item);
      return item;
    },
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
    executeCommand: async (...args) => {
      executedCommands.push(args);
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
  __executedCommands: executedCommands,
  __statusBarItems: statusBarItems,
  __openedUris: openedUris,
};
