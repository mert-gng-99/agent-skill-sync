# agent-sync (Türkçe)

English: [README.md](README.md)

`agent-sync`, kodlama ajanlarının (**Claude Code, Codex, OpenCode, Gemini CLI, Aider, Cursor**) skill'lerini, kalıcı hafızasını ve paylaşılan ayarlarını hem **makineler** (macOS, Windows, Linux) hem **araçlar** arasında senkronize eden, sıfır bağımlılıklı bir Node.js CLI aracıdır. Dosya yolu makineden makineye değişse bile yol-bağımsız kimlik çözümlemesi sayesinde aynı projeyi tanır.

---

### 1. Tanım
`agent-sync`, farklı cihazlarda veya farklı yapay zeka araçlarında çalışırken ajanların bağlam kaybetmesini engeller. Bir araçta öğrenilen karar veya hafıza notu, senkronizasyon klasörü üzerinden diğer makinelerdeki ve araçlardaki ajanların erişimine sunulur.

### 2. Gereksinimler & Politikalar
- Node.js >= 20.0.0 gerekir, sıfır harici `npm` bağımlılığı.
- `syncRoot` cihazlarınız arasında zaten senkronize olan bir dizindir (Google Drive, OneDrive, Dropbox, Syncthing veya yerel ağ paylaşımı). `agent-sync` dosya taşıma işini kendisi yapmaz, bulut sürücünüzün senkronizasyon yeteneğini kullanır.
- Hafızanın etkili çalışması için `<syncRoot>/CLAUDE.md` veya paylaşılan genel talimatlara, ajanların kritik mimari kararları hafızaya kaydetmesini söyleyen bir kural eklenmelidir (Faz 0 hafıza politikası).

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
| `projects` | Bilinen tüm projeleri ve hangi makinelerde olduklarını listeler |
| `link <project-id>` | Mevcut çalışma dizinini var olan bir proje kimliğine bağlar |
| `forget <path>` | Bir dosyayı hem yerel hem de uzak depodan bilinçli olarak siler |
| `run <command...>` | Komut öncesi pull yapar, komutu çalıştırır, çıkışta push yapar |
| `--force` | Sır benzeri içerik barındıran dosyaların da zorla push edilmesini sağlar |

### 5. Desteklenen Araçlar

| Araç Kimliği (`id`) | Araç Adı | Hedef Dosya / Dizin |
|---|---|---|
| `claude` | Claude Code | `~/.claude/projects/<slug>/memory/` + `~/.claude/skills/` |
| `codex` | Codex CLI | `AGENTS.md` + `.agents/skills/` |
| `opencode` | OpenCode | `AGENTS.md` |
| `gemini` | Gemini CLI | `GEMINI.md` |
| `aider` | Aider | `CONVENTIONS.md` |
| `cursor` | Cursor | `.cursor/rules/agent-sync.mdc` |

Skill'lerin (`~/.claude/skills/`) tam içeriği (`SKILL.md` + referanslar/scriptler) yalnızca **Claude Code ve Codex CLI**'a gerçek dosya olarak dağıtılıyor, çünkü ikisi de aynı `SKILL.md` formatını okuyor (Codex, [openai/codex](https://learn.chatgpt.com/docs/build-skills) belgelerine göre `.agents/skills/`'ı proje kökünde arıyor). Diğer araçlarda (`opencode`, `gemini`, `aider`, `cursor`) skill'ler yalnızca isim olarak `AGENTS.md`/`GEMINI.md` içinde listelenir, otomatik tetiklenmez. Bu araçların doğrulanmış bir skill mekanizması yok.

### 6. Proje Kimliği (Path-Independent Identity)
Aynı proje macOS'ta `/Users/mert/Desktop/app`, Windows'ta `C:\Users\mert\Desktop\app` olsa dahi `agent-sync` projeyi 4 adımlı öncelik sırasıyla tanır:
1. Proje kökündeki `.claude-project-id` marker dosyası.
2. Git remote URL adresi (registry ile eşleşen).
3. Klasör adı (registry'de benzersiz ise).
4. Eşleşme yoksa üretilen yeni benzersiz ID. Çakışma durumunda `agent-sync link <id>` ile manuel bağlama yapılır.

Marker dosyaları projenizin `.git/info/exclude` dosyasına eklenir. Kullanıcının versiyonlanan `.gitignore` dosyasına asla müdahale edilmez.

### 7. VS Code Extension
Eklenti (`extension/`) şu anlarda otomatik tetiklenir: VS Code açılışı (pull), pencere odak kazandığında (pull), pencere odak kaybettiğinde (push) ve `deactivate` (push). Eklenti kullanıldığında terminal hook'larına gerek kalmaz.

Paketleyip kurmak için (her makinede bir kez, `init`'ten sonra):

```bash
npx @vscode/vsce package --allow-missing-repository --skip-license
code --install-extension agent-sync-0.1.0.vsix
```

VS Code'u yeniden başlatınca durum çubuğunda `agent-sync` görünür.

**Komutlar** (`Cmd/Ctrl + Shift + P` → "agent-sync" ara):
- `agent-sync: Sync now` elle pull+push çalıştırır.
- `agent-sync: Run health checks` `doctor` çıktısını Output panelinde gösterir.
- `agent-sync: Show all projects` `agent-sync`'in bildiği tüm projeleri, her birinin makinelerindeki yoluyla birlikte listeler. CLI'daki `agent-sync projects` ile aynı veri, doğrudan `registry.json`'dan okunur.
- `agent-sync: Link this folder to a project` bu klasörün şu an hangi projeye çözümlendiğini (ve nasıl eşleştiğini) gösterir, **ve bilinen projelerden birini seçmene veya yeni bir proje kimliği oluşturmana izin verir**. Otomatik eşleştirme yanlış çıktıysa (örneğin jenerik bir klasör adı iki projeyle çakıştıysa) buradan düzeltirsin. Bu, CLI'daki `agent-sync link <id>`'in arayüzden karşılığıdır.

**Ayarlar** (`Cmd/Ctrl + ,` → "agent-sync" ara): `syncRoot`, `machineId`, `targets` doğrudan buradan değiştirilebilir, `config.json`'ı elle düzenlemeye gerek yok. `targets` bir seçim listesidir (`claude`, `codex`, `opencode`, `gemini`, `aider`, `cursor`), JSON yazmadan işaretlersin. Bir ayarı hiç dokunmadan boş bırakırsan mevcut `config.json` değeri korunur. Settings ekranı yalnızca **gerçekten değiştirdiğin** alanları ezer.

### 8. Bilinçli Sınırlar
- Bir cihazda silinen dosya senkronizasyonda silinmez, diğer cihazdan geri getirilir. Kasıtlı silme yalnızca `forget` komutuyla yapılır.
- Senkronizasyon anlık akış değil, oturum başı/sonu veya komut sarmalayıcısı (`run`) ile çalışır.
- Skill'ler yalnızca Claude Code üzerinde otomatik araç olarak tetiklenir. Diğer araçlarda okunabilir metin olarak erişilebilir durumdadır.
- Dışarı çıkacak (`push`) dosyalarda API anahtarları ve şifreler taranır. Şüpheli dosyalar **push edilmez, yerelde kalır** ve raporlanır. Yanlış pozitif durumlarında `--force` parametresiyle push zorlanabilir. Gelen (`pull`) dosyalar taranmaz.

### 9. Oturum Devamlılığı (Transkript Senkronu)

Aynı proje (aynı git remote'u veya proje kimliği) farklı bir makinede açıldığında (farklı klasör yolunda, farklı işletim sisteminde bile), Claude Code oturumlarının kaldığı yerden devam etmesini istiyorsan `syncTranscripts` ayarını aç (eklenti Ayarlar ekranından veya `config.json`'da). Açıkken:

- Bu projenin `.jsonl` oturum dosyaları proje kimliğine göre (yola göre değil) `<syncRoot>/transcripts/<proje-id>/` altında saklanır.
- Diğer makinede aynı projeyi `pull` ettiğinde, o dosyalar **o makinenin kendi yol-bağımlı klasörüne** kopyalanır. `claude --resume` orada onları görür ve listeler.
- Varsayılan olarak kapalıdır, çünkü transkript dosyaları büyük ve sürekli büyüyen içerik taşır, hafıza notları gibi süzülmüş değildir. Diğer her şey gibi push öncesi sır taraması bu dosyalardan da geçer.
- Bilinen sınır: konuşmanın metni (ne konuşuldu, ne karar verildi) birebir gelir. Ama transkript içindeki eski dosya okuma/yazma kayıtları kaynak makinenin mutlak yollarına referans verir, hedef makinede o yollar yoktur. Yani "devam et" isteği çalışır, ama eski bir tool sonucuna geri dönmek çalışmaz.

---

## License
MIT License. Copyright (c) 2026 agent-sync contributors.
