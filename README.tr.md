# agent-sync (Türkçe)

English: [README.md](README.md)

`agent-sync`, kodlama ajanlarının (**Claude Code, Codex, OpenCode, Gemini CLI, Aider, Cursor**) skill'lerini, kalıcı hafızasını ve paylaşılan ayarlarını hem **makineler** (macOS, Windows, Linux) hem **araçlar** arasında senkronize eden, sıfır bağımlılıklı bir Node.js CLI aracıdır. Dosya yolu makineden makineye değişse bile yol-bağımsız kimlik çözümlemesi sayesinde aynı projeyi tanır.

---

### 1. Tanım
`agent-sync`, farklı cihazlarda veya farklı yapay zeka araçlarında çalışırken ajanların bağlam kaybetmesini engeller. Bir araçta öğrenilen karar veya hafıza notu, senkronizasyon klasörü üzerinden diğer makinelerdeki ve araçlardaki ajanların erişimine sunulur.

### 2. Nasıl çalışır
`agent-sync`, `~/.agent-sync/staged/` altında yerel bir ayna kopyası, `syncRoot` içinde de kanonik bir kopya tutar.

- `push` çalıştığında hafıza, skill ve ayarlar doğrudan her araçtan okunur (örneğin `~/.claude/skills/`), yerel aynaya yazılır, sonra her dosyanın hash'i `syncRoot`'takiyle karşılaştırılır. Burada değişen dosyalar dışarı kopyalanır.
- `pull` bunun tersini yapar. `syncRoot` ile yerel ayna karşılaştırılır, başka yerde değişen dosyalar indirilir, sonra sonuç kullandığınız her araç için bir adapter'a verilir; adapter da bunu o aracın kendi formatına yazar (`AGENTS.md`, `CLAUDE.md`, `.cursor/rules/` vb.).
- Her senkronizasyon, bir önceki senkronda her dosyanın hash'ini `~/.agent-sync/state.json` içinde hatırlar. Bu kayıtlı hash, "burada değişti", "orada değişti" ve "her iki tarafta da değişti" durumlarını ayırt etmeyi sağlar. Yalnızca sonuncusu gerçek bir çakışmadır.
- Çakışma durumunda hiçbir şeyin üzerine yazılmaz. Yerel sürümünüz, gelen sürümün yanına `<isim>.conflict-<makine>-<zaman damgası>.<uzantı>` olarak kaydedilir, iki taraf da kendi kopyasını korur.
- Her `pull`'dan önce `agent-sync`, o anki yerel dosyaları `~/.agent-sync/snapshots/` altına kaydeder (son 20 tanesi tutulur), böylece kötü giden bir senkron elle geri alınabilir.
- Desteklenen her aracın kendi küçük adapter modülü vardır. Senkron motorunun kendisi hiçbir aracı tanımaz, yalnızca genel dosyaları ayna ile `syncRoot` arasında taşır. Bu genel içeriği `AGENTS.md`'e, Claude Code'un hafıza klasörüne vb. dönüştüren adapter'lardır.
- Claude Code plugin'leri (bir oturumda gördüğün skill'lerin çoğunun asıl kaynağı, kendi `~/.claude/skills/` dosyaların dışında) dosya olarak kopyalanmaz. Plugin cache'i yüzlerce megabayta çıkabiliyor ve makineler arasında taşınabilir değil. Bunun yerine `agent-sync`, hangi plugin'lerin açık olduğu ve hangi marketplace'lerin bilindiği listesini taşır; elle çalıştırdığın bir sonraki `pull`'da eksik olanları kurmayı önerir. Bkz. bölüm 6.

### 3. Gereksinimler & Politikalar
- Node.js >= 20.0.0 gerekir, sıfır harici `npm` bağımlılığı.
- `syncRoot` cihazlarınız arasında zaten senkronize olan bir dizindir (Google Drive, OneDrive, Dropbox, Syncthing veya yerel ağ paylaşımı). `agent-sync` dosya taşıma işini kendisi yapmaz, bulut sürücünüzün senkronizasyon yeteneğini kullanır.
- Hafızanın etkili çalışması için `<syncRoot>/CLAUDE.md` veya paylaşılan genel talimatlara, ajanların kritik mimari kararları hafızaya kaydetmesini söyleyen bir kural eklenmelidir (Faz 0 hafıza politikası).

İsteğe bağlı olarak, skill/hafıza ile birlikte senkronlamak için `vaultPath`'i yerel bir [avenoxbeyin](https://github.com/avenoxai/avenoxbeyin) (veya benzer) vault'una işaret edebilirsiniz - `agent-sync vault` Windows'ta uçtan uca kurar, herhangi bir işletim sisteminde ise mevcut bir vault'u bağlar.

> ⚠️ **Önemli Uyarı**: `syncRoot` dizini içine kesinlikle bir `.git` deposu (`git init`) koymayın. İki farklı makineden eşzamanlı yazma durumunda `.git` veritabanı bozulabilir.

### 4. Kurulum ve Testler
1. Depoyu klonlayın:
   ```bash
   git clone https://github.com/mert-gng-99/agent-skill-sync.git
   cd agent-sync
   ```
2. Her makinenizde etkileşimli kurulumu çalıştırın:
   ```bash
   node bin/agent-sync.mjs init
   ```
   Claude Code'u VS Code eklentisi yerine terminalden kullanıyorsanız `init`, `~/.claude/settings.json` içine iki hook kurmayı önerir: biri oturum başlarken `pull`, diğeri oturum biterken `push` çalıştırır. Bu hook komutları her zaman `--hook` bayrağını taşır (bkz. bölüm 6), böylece bir oturumun rastgele bir klasörde (örneğin masaüstünde) başlaması, o klasörü kendiliğinden yeni bir projeye çevirmez.
3. Testleri çalıştırmak için:
   - Birim testleri: `npm test`
   - Uçtan uca smoke testi: `./scripts/smoke-test.sh` (izole geçici bir `HOME` dizininde çalıştığından gerçek bilgisayarınızdaki dizinlere dokunmaz).

### 5. Bir yapay zeka ajanıyla kurulum
Her adımı elle yazmanıza gerek yok. Aşağıdaki promptlardan birini, kabuk komutu çalıştırabilen bir kodlama ajanına yapıştırın: Claude Code, Codex CLI, OpenCode, Aider veya Cursor'ın ajan modu gibi. Kurulum yalnızca birkaç kabuk komutu olduğu için aynı prompt hepsinde çalışır.

İki yer tutucuyu göndermeden önce doldurun.

```
https://github.com/mert-gng-99/agent-skill-sync.git deposunu ~/agent-sync altına klonla, sonra kurulum sihirbazını çalıştır: `node bin/agent-sync.mjs init`.
Senkron klasörü sorduğunda şunu kullan: <Google Drive / OneDrive / Dropbox / Syncthing klasörünüzün yolu>
Makine adı sorduğunda şunu kullan: <bu bilgisayar için kısa bir isim, örn. macbook veya is-pc>
Bulduğu araçları listelediğinde, gerçekten kullandıklarımı seç.
Claude Code hook'larını kurmayı sorarsa, yalnızca sen terminalde çalışan Claude Code isen evet de, VS Code eklentisiysen hayır de.
Bundan sonra `npm test` ve `./scripts/smoke-test.sh` çalıştır ve geçip geçmediğini söyle.
```

Bunu her bilgisayarda bir kez yapın. Senkron klasörü her makinede aynı olsun; yerel yol bulut sürücünün mount noktasına göre makineden makineye değişebilir, önemli olan aynı paylaşılan klasörü göstermesi.

VS Code eklentisini (bkz. bölüm 9) terminal hook'ları yerine kullanacaksanız, prompt'a şu satırı da ekleyin:

```
Sonra VS Code eklentisini derle ve kur: `npx @vscode/vsce package --allow-missing-repository --skip-license`, sonra `code --install-extension agent-sync-0.1.0.vsix`.
```

### 6. Komutlar
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
| `vault [path]` | Windows'ta tam otomatik kurulum yapar veya herhangi bir OS'te mevcut bir second-brain vault'unu (örn. avenoxbeyin) bağlar |
| `--force` | Sır benzeri içerik barındıran dosyaların da zorla push edilmesini sağlar |
| `--hook` | Yalnızca otomatik çağıranlar için, örneğin `init`'in kurduğu Claude Code hook'ları (bkz. bölüm 4): henüz proje marker'ı olmayan bir klasörü, yeni proje oluşturmak yerine atlar |

`pull`'u elle, gerçek bir terminalde çalıştırdığında `agent-sync`, başka bir makinede açık olup burada eksik olan Claude Code plugin'lerini de kontrol eder (bunun için `claude` CLI'ının `PATH`'te olması gerekir). Her biri için `Install <plugin>, synced from another machine? [y/N]` diye sorar. Hayır dersen o plugin bu makinede bir daha hiç sorulmaz; evet dersen senin yerine `claude plugin install` çalıştırılır. Hook'tan veya bir script'ten çalışan bir `pull` hiç soru sormaz, sorabileceği bir terminal yoktur, ama eksik olan varsa tek satırlık bir uyarı basar, böylece bir plugin sırf kimse elle `pull` çalıştırmadı diye sessizce kurulmamış kalmaz.

### 7. Desteklenen Araçlar

| Araç Kimliği (`id`) | Araç Adı | Hedef Dosya / Dizin |
|---|---|---|
| `claude` | Claude Code | `~/.claude/projects/<slug>/memory/` + `~/.claude/skills/` |
| `codex` | Codex CLI | `AGENTS.md` + `.agents/skills/` |
| `opencode` | OpenCode | `AGENTS.md` |
| `gemini` | Gemini CLI | `GEMINI.md` |
| `aider` | Aider | `CONVENTIONS.md` |
| `cursor` | Cursor | `.cursor/rules/agent-sync.mdc` |

Skill'lerin (`~/.claude/skills/`) tam içeriği (`SKILL.md` + referanslar/scriptler) yalnızca **Claude Code ve Codex CLI**'a gerçek dosya olarak dağıtılıyor, çünkü ikisi de aynı `SKILL.md` formatını okuyor (Codex, [openai/codex](https://learn.chatgpt.com/docs/build-skills) belgelerine göre `.agents/skills/`'ı proje kökünde arıyor). Diğer araçlarda (`opencode`, `gemini`, `aider`, `cursor`) skill'ler yalnızca isim olarak `AGENTS.md`/`GEMINI.md` içinde listelenir, otomatik tetiklenmez. Bu araçların doğrulanmış bir skill mekanizması yok.

Cursor'ın `.cursor/rules/agent-sync.mdc` dosyasının otomatik yüklenmesi için küçük bir YAML başlığı (`alwaysApply: true`) gerekiyor, bkz. [Cursor'ın dokümanı](https://cursor.com/docs/rules). `agent-sync` bu başlığı kendisi ekliyor. Dosyada zaten kendi başlığınız varsa (örneğin elle yazdığınız bir `description` veya `globs`), `agent-sync` ona dokunmaz, yalnızca altındaki hafıza bloğunu günceller.

### 8. Proje Kimliği (Path-Independent Identity)
Aynı proje macOS'ta `/Users/mert/Desktop/app`, Windows'ta `C:\Users\mert\Desktop\app` olsa dahi `agent-sync` projeyi 4 adımlı öncelik sırasıyla tanır:
1. Proje kökündeki `.claude-project-id` marker dosyası.
2. Git remote URL adresi (registry ile eşleşen).
3. Klasör adı (registry'de benzersiz ise).
4. Eşleşme yoksa üretilen yeni benzersiz ID. Çakışma durumunda `agent-sync link <id>` ile manuel bağlama yapılır.

Marker dosyaları projenizin `.git/info/exclude` dosyasına eklenir. Kullanıcının versiyonlanan `.gitignore` dosyasına asla müdahale edilmez.

### 9. VS Code Extension
Eklenti (`extension/`) şu anlarda otomatik tetiklenir: VS Code açılışı (pull), pencere odak kazandığında (pull), pencere odak kaybettiğinde (push) ve `deactivate` (push). Eklenti kullanıldığında terminal hook'larına gerek kalmaz.

Paketleyip kurmak için (her makinede bir kez, `init`'ten sonra):

```bash
npx @vscode/vsce package --allow-missing-repository --skip-license
code --install-extension agent-sync-0.1.0.vsix
```

VS Code'u yeniden başlatınca durum çubuğunda `agent-sync` görünür.

Durum çubuğundaki `agent-sync` yazısına tıklamak, aşağıdaki tüm komutları (Settings dahil) içeren bir menü açar — Command Palette'e gerek kalmaz. Aynı komutlara `Cmd/Ctrl + Shift + P` → "agent-sync" aramasıyla da ulaşılabilir:
- `agent-sync: Sync now` elle pull+push çalıştırır.
- `agent-sync: Run health checks` `doctor` çıktısını Output panelinde gösterir.
- `agent-sync: Show all projects` `agent-sync`'in bildiği tüm projeleri, her birinin makinelerindeki yoluyla birlikte listeler. CLI'daki `agent-sync projects` ile aynı veri, doğrudan `registry.json`'dan okunur.
- `agent-sync: Link this folder to a project` bu klasörün şu an hangi projeye çözümlendiğini (ve nasıl eşleştiğini) gösterir, **ve bilinen projelerden birini seçmene veya yeni bir proje kimliği oluşturmana izin verir**. Otomatik eşleştirme yanlış çıktıysa (örneğin jenerik bir klasör adı iki projeyle çakıştıysa) buradan düzeltirsin. Bu, CLI'daki `agent-sync link <id>`'in arayüzden karşılığıdır.

**Ayarlar** (`Cmd/Ctrl + ,` → "agent-sync" ara): `syncRoot`, `machineId`, `targets` doğrudan buradan değiştirilebilir, `config.json`'ı elle düzenlemeye gerek yok. `targets` bir seçim listesidir (`claude`, `codex`, `opencode`, `gemini`, `aider`, `cursor`), JSON yazmadan işaretlersin. Bir ayarı hiç dokunmadan boş bırakırsan mevcut `config.json` değeri korunur. Settings ekranı yalnızca **gerçekten değiştirdiğin** alanları ezer.

### 10. Bilinçli Sınırlar
- Bir cihazda silinen dosya senkronizasyonda silinmez, diğer cihazdan geri getirilir. Kasıtlı silme yalnızca `forget` komutuyla yapılır.
- Senkronizasyon anlık akış değil, oturum başı/sonu veya komut sarmalayıcısı (`run`) ile çalışır.
- Skill'ler yalnızca Claude Code üzerinde otomatik araç olarak tetiklenir. Diğer araçlarda okunabilir metin olarak erişilebilir durumdadır.
- Makinelerin aynı plugin setini taşıması gerekmez. Bir plugin'i bir makinede reddetmek (bkz. bölüm 6) yalnızca o makineyi etkiler; diğerlerinde açık ve kurulabilir kalır.
- Dışarı çıkacak (`push`) dosyalarda API anahtarları ve şifreler taranır. Şüpheli dosyalar **push edilmez, yerelde kalır** ve raporlanır. Yanlış pozitif durumlarında `--force` parametresiyle push zorlanabilir. Gelen (`pull`) dosyalar taranmaz.

### 11. Oturum Devamlılığı (Transkript Senkronu)

Aynı proje (aynı git remote'u veya proje kimliği) farklı bir makinede açıldığında (farklı klasör yolunda, farklı işletim sisteminde bile), Claude Code oturumlarının kaldığı yerden devam etmesini sağlayan ayar `syncTranscripts`, ve varsayılan olarak açık geliyor (`config.json`'da, ya da eklenti Ayarlar ekranında - bu varsayılan olduktan sonra `init` çalıştıran her makinede). İstemiyorsan makine başına kapatabilirsin.

- Bu projenin `.jsonl` oturum dosyaları proje kimliğine göre (yola göre değil) `<syncRoot>/transcripts/<proje-id>/` altında saklanır.
- Diğer makinede aynı projeyi `pull` ettiğinde, o dosyalar **o makinenin kendi yol-bağımlı klasörüne** kopyalanır. `claude --resume` orada onları görür ve listeler. İki tarafın da `syncTranscripts: true` olması gerekir: push eden taraf toplayıp göndermek için, pull eden taraf da geleni kendi proje klasörüne yazmak için.
- Bu yalnızca izlenen bir proje dizini içinde başlayan oturumları kapsar. Ev dizininden veya `agent-sync`'in projesi olmayan başka bir yerden başlayan bir oturum bilerek hariç tutulur (bkz. bölüm 8) ve bu ayardan bağımsız olarak asla senkronlanmaz.
- Oturum dosyaları büyük ve sürekli büyüyen içerik taşır, hafıza notları gibi süzülmüş değildir. Diğer her şey gibi push öncesi sır taraması bu dosyalardan da geçer.
- Bilinen sınır: konuşmanın metni (ne konuşuldu, ne karar verildi) birebir gelir. Ama transkript içindeki eski dosya okuma/yazma kayıtları kaynak makinenin mutlak yollarına referans verir, hedef makinede o yollar yoktur. Yani "devam et" isteği çalışır, ama eski bir tool sonucuna geri dönmek çalışmaz.

---

## License
MIT License. Copyright (c) 2026 agent-sync contributors.
