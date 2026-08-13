# agent-sync

`agent-sync`, kodlama ajanlarının (**Claude Code, Codex, OpenCode, Gemini CLI, Aider, Cursor**) skill'lerini, kalıcı hafızasını ve paylaşılan ayarlarını hem **makineler** (macOS, Windows, Linux) hem **araçlar** arasında senkronize eden, sıfır bağımlılıklı bir Node.js CLI aracıdır. Dosya yolu makineden makineye değişse bile yol-bağımsız kimlik çözümlemesi sayesinde aynı projeyi tanır.

---

## Türkçe Dokümantasyon

### 1. Tanım
`agent-sync`, farklı cihazlarda veya farklı yapay zeka araçlarında çalışırken ajanların bağlam kaybetmesini engeller. Bir araçta öğrenilen karar veya hafıza notu, senkronizasyon klasörü üzerinden diğer makinelerdeki ve araçlardaki ajanların erişimine sunulur.

### 2. Gereksinimler & Politikalar
- **Node.js**: >= 20.0.0 (sıfır harici `npm` bağımlılığı).
- **Paylaşımlı Klasör (`syncRoot`)**: Cihazlarınız arasında zaten senkronize olan bir dizin (Google Drive, OneDrive, Dropbox, Syncthing veya yerel ağ paylaşımı). *`agent-sync` dosya taşıma (transport) işini kendisi yapmaz; bulut sürücünüzün senkronizasyon yeteneğini kullanır.*
- **Faz 0 Hafıza Politikası**: Hafızanın etkili çalışması için `<syncRoot>/CLAUDE.md` veya paylaşılan genel talimatlara ajanların kritik mimari kararları hafızaya kaydetmesini söyleyen bir kural eklenmelidir.

> ⚠️ **Önemli Uyarı**: `syncRoot` dizini içine kesinlikle bir `.git` deposu (`git init`) koymayın. İki farklı makineden eşzamanlı yazma durumunda `.git` veritabanı bozulabilir.

### 3. Kurulum ve Testler
1. Depoyu klonlayın:
   ```bash
   git clone https://github.com/mert-gng-99/agent-skill-sync.git
   cd agent-sync
   ```
2. Her makinenizde etkileşimli kurulumu çalıştırın:
   ```bash
   node bin/agent-sync.mjs init
   ```
3. Testleri çalıştırmak için:
   - Birim testleri: `npm test`
   - Uçtan uca smoke testi: `./scripts/smoke-test.sh` (izole geçici bir `HOME` dizininde çalıştığından gerçek bilgisayarınızdaki dizinlere dokunmaz).

### 4. Komutlar
`node bin/agent-sync.mjs <command> [--force]` (veya `npm link` ile `agent-sync <command>`):

| Komut | Açıklama |
|---|---|
| `init` | Bu makineyi yapılandırır: config, syncRoot ve hedef araç seçimi |
| `pull` \| `push` | Skill'leri, hafızayı ve paylaşılan ayarları senkronize eder |
| `status` | Makine, mevcut proje, hedefler ve bekleyen değişiklikleri gösterir |
| `doctor` | Sağlık kontrolleri: çakışmalar, registry tutarlılığı, sır taraması |
| `link <project-id>` | Mevcut çalışma dizinini var olan bir proje kimliğine bağlar |
| `forget <path>` | Bir dosyayı hem yerel hem de uzak depodan bilinçli olarak siler |
| `run <command...>` | Komut öncesi pull yapar, komutu çalıştırır, çıkışta push yapar |
| `--force` | Sır benzeri içerik barındıran dosyaların da zorla push edilmesini sağlar |

### 5. Desteklenen Araçlar

| Araç Kimliği (`id`) | Araç Adı | Hedef Dosya / Dizin |
|---|---|---|
| `claude` | Claude Code | `~/.claude/projects/<slug>/memory/` |
| `codex` | Codex CLI | `AGENTS.md` |
| `opencode` | OpenCode | `AGENTS.md` |
| `gemini` | Gemini CLI | `GEMINI.md` |
| `aider` | Aider | `CONVENTIONS.md` |
| `cursor` | Cursor | `.cursor/rules/agent-sync.mdc` |

### 6. Proje Kimliği (Path-Independent Identity)
Aynı proje macOS'ta `/Users/mert/Desktop/app`, Windows'ta `C:\Users\mert\Desktop\app` olsa dahi `agent-sync` projeyi 4 adımlı öncelik sırasıyla tanır:
1. Proje kökündeki `.claude-project-id` marker dosyası.
2. Git remote URL adresi (registry ile eşleşen).
3. Klasör adı (registry'de benzersiz ise).
4. Eşleşme yoksa üretilen yeni benzersiz ID. Çakışma durumunda `agent-sync link <id>` ile manuel bağlama yapılır.

Marker dosyaları projenizin `.git/info/exclude` dosyasına eklenir; kullanıcının versiyonlanan `.gitignore` dosyasına asla müdahale edilmez.

### 7. VS Code Extension
Eklenti (`extension/`) şu anlarda otomatik tetiklenir: VS Code açılışı (pull), pencere odak kazandığında (pull), pencere odak kaybettiğinde (push) ve `deactivate` (push). Eklenti kullanıldığında terminal hook'larına gerek kalmaz.

Paketleyip kurmak için (her makinede bir kez, `init`'ten sonra):

```bash
npx @vscode/vsce package --allow-missing-repository --skip-license
code --install-extension agent-sync-0.1.0.vsix
```

VS Code'u yeniden başlatınca durum çubuğunda `agent-sync` görünür.

**Ayarlar** (`Cmd/Ctrl + ,` → "agent-sync" ara): `syncRoot`, `machineId`, `targets` doğrudan buradan değiştirilebilir — `config.json`'ı elle düzenlemeye gerek yok. `targets` bir seçim listesidir (`claude`, `codex`, `opencode`, `gemini`, `aider`, `cursor`); JSON yazmadan işaretlersin. Bir ayarı hiç dokunmadan boş bırakırsan mevcut `config.json` değeri korunur — Settings ekranı yalnızca **gerçekten değiştirdiğin** alanları ezer.

### 8. Bilinçli Sınırlar
- **Silme yayılmaz**: Bir cihazda silinen dosya senkronizasyonda silinmez, diğer cihazdan geri getirilir. Kasıtlı silme yalnızca `forget` komutuyla yapılır.
- **Tetikleme**: Senkronizasyon anlık streaming değil, oturum başı/sonu veya komut sarmalayıcısı (`run`) ile çalışır.
- **Skill'ler**: Yalnızca Claude Code üzerinde otomatik araç/skill olarak tetiklenir; diğer araçlarda okunabilir metin olarak erişilebilir durumdadır.
- **Sır Güvenliği**: Dışarı çıkacak (`push`) dosyalarda API anahtarları/şifreler taranır. Şüpheli dosyalar **push edilmez, yerelde kalır** ve raporlanır. Yanlış pozitif durumlarında `--force` parametresiyle push zorlanabilir. Gelen (`pull`) dosyalar taranmaz.

---

## English Documentation

### 1. Overview
`agent-sync` is a zero-dependency Node.js CLI tool that synchronizes coding agent skills, persistent memory, and shared settings across multiple machines (macOS, Windows, Linux) and AI tools (**Claude Code, Codex, OpenCode, Gemini CLI, Aider, Cursor**). It features path-independent project resolution, recognizing the same project even if local folder paths differ across OS environments.

### 2. Requirements & Policies
- **Node.js**: >= 20.0.0 (uses built-in Node modules only, zero runtime `npm` dependencies).
- **Shared Folder (`syncRoot`)**: A directory already synced between your machines via cloud storage (Google Drive, OneDrive, Dropbox, Syncthing, or a network share). *`agent-sync` does not handle transport itself.*
- **Phase 0 Memory Policy**: Add instructions in `<syncRoot>/CLAUDE.md` or shared global guidelines requesting agents to record key decisions into project memory.

> ⚠️ **Warning**: Do not place a Git repository (`.git`) directly inside `syncRoot`. Concurrent writes from multiple machines will corrupt the Git database.

### 3. Installation & Testing
1. Clone the repository:
   ```bash
   git clone https://github.com/mert-gng-99/agent-skill-sync.git
   cd agent-sync
   ```
2. Run interactive setup on each machine:
   ```bash
   node bin/agent-sync.mjs init
   ```
3. Run tests:
   - Unit tests: `npm test`
   - End-to-end smoke test: `./scripts/smoke-test.sh` (runs entirely inside an isolated temporary `$HOME`, making it completely safe and non-destructive to your real `~/.claude` and `~/.agent-sync` environments).

### 4. CLI Commands
`node bin/agent-sync.mjs <command> [--force]` (or `agent-sync <command>`):

| Command | Description |
|---|---|
| `init` | Configure this machine: config, syncRoot path, and tool targets |
| `pull` \| `push` | Synchronize skills, memory, and shared settings |
| `status` | Display machine ID, project ID, targets, and pending changes |
| `doctor` | Health checks: unresolved conflicts, registry consistency, secret scan |
| `link <project-id>` | Manually bind current working directory to an existing project ID |
| `forget <path>` | Purge a file locally and remotely intentionally |
| `run <command...>` | Pull before command execution, run command, push on exit |
| `--force` | Force push files even when they look like they contain secrets |

### 5. Supported Tools

| Target ID | Tool Name | Target File / Directory |
|---|---|---|
| `claude` | Claude Code | `~/.claude/projects/<slug>/memory/` |
| `codex` | Codex CLI | `AGENTS.md` |
| `opencode` | OpenCode | `AGENTS.md` |
| `gemini` | Gemini CLI | `GEMINI.md` |
| `aider` | Aider | `CONVENTIONS.md` |
| `cursor` | Cursor | `.cursor/rules/agent-sync.mdc` |

### 6. Path-Independent Project Identity
`agent-sync` resolves project identity in 4 prioritized steps:
1. Project marker file `.claude-project-id`.
2. Git remote URL matching a registry entry.
3. Folder name matching a unique registry entry.
4. Newly generated unique project ID. Ambiguities can be bound via `agent-sync link <id>`.

Marker files are registered in `.git/info/exclude`; user-versioned `.gitignore` files are never modified.

### 7. VS Code Extension
The extension (`extension/`) triggers automatically on: VS Code startup (pull), window focus gained (pull), window focus lost (push), and `deactivate` (push). Installing it eliminates the need for shell hooks.

Package and install it (once per machine, after `init`):

```bash
npx @vscode/vsce package --allow-missing-repository --skip-license
code --install-extension agent-sync-0.1.0.vsix
```

Restart VS Code; `agent-sync` then appears in the status bar.

**Settings** (`Cmd/Ctrl + ,` → search "agent-sync"): `syncRoot`, `machineId`, and `targets` can be edited directly there - no need to hand-edit `config.json`. `targets` is a pick-list (`claude`, `codex`, `opencode`, `gemini`, `aider`, `cursor`), not free-text JSON. Leaving a field untouched keeps whatever is already in `config.json` - the Settings UI only overrides fields you've actually changed.

### 8. Design Constraints
- **Deletions do not propagate**: Absent files are restored from remote. Use `agent-sync forget <path>` for intentional deletions.
- **Secret Protection**: Outbound files (`push`) are scanned for API keys and passwords. Suspected files are **withheld from the push and kept locally**. Use the `--force` flag to override false positives. Inbound files (`pull`) are not blocked.

---

## License
MIT License - Copyright (c) 2026 agent-sync contributors.
