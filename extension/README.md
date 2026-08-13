# agent-sync VS Code Extension

This extension integrates `agent-sync` directly into VS Code, automatically triggering synchronization when:
- Opening a workspace or starting VS Code
- Regaining window focus after switching from another app
- Manually running the **agent-sync: Sync now** command

## Setup

1. Run `agent-sync init` from terminal or configure VS Code settings:
   - `agent-sync.syncRoot`: Shared folder path (Google Drive, OneDrive, Dropbox, Syncthing)
   - `agent-sync.machineId`: Short identifier for this machine
   - `agent-sync.targets`: List of target tools (e.g. `["claude", "codex", "cursor"]`)

2. Packaging and Installation:
   ```bash
   npx @vscode/vsce package
   code --install-extension agent-sync-vscode-0.1.0.vsix
   ```

## Commands

- **agent-sync: Sync now** (`agent-sync.sync`): Triggers a sync pass immediately.
- **agent-sync: Run health checks** (`agent-sync.doctor`): Runs doctor diagnostic checks.
- **agent-sync: Link this folder to a project** (`agent-sync.link`): Shows identity resolution status for current workspace.
