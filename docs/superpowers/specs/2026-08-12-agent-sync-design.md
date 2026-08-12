# agent-sync — Tasarım Dokümanı

**Tarih:** 2026-08-12
**Durum:** Onaylandı, implementation planı bekliyor

## Problem

Bir geliştirici birden fazla makinede kodlama ajanı kullanıyor (bu tasarımın çıkış senaryosu: 1 macOS + 2 Windows). Üstelik tek bir araca da bağlı değil — bir aracın kullanım limiti dolduğunda başka bir araca geçmek istiyor (Claude Code → Codex → OpenCode gibi). İki eksen birden var: **makine** ve **araç**.

Her makine kendi başına yaşıyor:

- Bir makinede yazılan skill diğerinde yok.
- Bir projede alınan kararlar, tercihler, "bunu neden böyle yaptık" bilgisi o makinede kalıyor.
- Etkinleştirilen plugin'ler ve ayarlar makineden makineye farklı.
- Claude Code konuşma geçmişini `~/.claude/projects/<cwd-slug>/` altında saklıyor ve slug mutlak yoldan üretiliyor. Aynı proje macOS'ta `-Users-mert-Desktop-avukatsite`, Windows'ta `C--Users-mert-Desktop-avukatsite` oluyor — yol farklı olduğu için sistem bunları iki ayrı proje sanıyor.

Sonuç: kullanıcı makine değiştirdiğinde bağlamı sıfırdan kuruyor.

Buna bir de araç ekseni ekleniyor: aynı bağlam yalnızca Claude Code'da değil, kullanıcının geçtiği diğer ajanlarda da geçerli olmalı. Her aracın bağlamı okuduğu yer farklı (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `CONVENTIONS.md`, `.cursor/rules/`), dolayısıyla tek bir araca yazmak yetmiyor.

## Amaç

Skill'ler, kalıcı hafıza ve ayarlar bütün makinelerde ortak olsun; **dosya yolu farklı olsa bile aynı proje tanınsın**; ve aynı bağlam **kullanıcının seçtiği her kodlama ajanında** okunabilir olsun.

## Kapsam

### Faz 1 — dahil

| Ne | Kanonik konum | Araçlara dağıtımı |
|---|---|---|
| Kullanıcı skill'leri | `<syncRoot>/skills/` | adapter'lar (Claude'da doğrudan, diğerlerinde digest referansı) |
| Kalıcı hafıza | `<syncRoot>/memory/<proje-id>/` | adapter'lar (dizin ya da digest) |
| Paylaşılan ayarlar | `<syncRoot>/settings-shared.json` | yalnızca `claude` adapter'ı (4 anahtar merge) |
| Global talimatlar | `<syncRoot>/CLAUDE.md` | adapter'ların `globalInstructionsPath()` hedefleri |

Paylaşılan 4 ayar anahtarı: `enabledPlugins`, `extraKnownMarketplaces`, `model`, `effortLevel`. Bu anahtarlar Claude Code'a özgüdür; diğer adapter'lar ayar senkronuna katılmaz.

### Faz 1 — hariç (gerekçeli)

- **`~/.claude/plugins/` (~1 GB)** — bu bir indirme cache'i. `settings.json` içindeki `enabledPlugins` + `extraKnownMarketplaces` (~2 KB) taşınır, hedef makine plugin'leri kendisi indirir. Aynı sonuç, 1 GB yerine 2 KB.
- **Konuşma transcript'leri (`*.jsonl`, ~164 MB)** — Faz 2'ye ait, kod baştan destekleyecek ama `syncTranscripts: false` varsayılanıyla kapalı gelecek. Gerekçe: transcript'lerin içindeki mutlak yollar platformlar arası geçersiz, boyut sürekli büyüyor, ve iyi yazılmış bir hafıza notu pratikte ham transcript'ten daha kullanışlı.
- **Makineye özel çöp** — `telemetry/`, `shell-snapshots/`, `file-history/`, `session-env/`, `ide/`.
- **Hook tanımları** — komut satırı platforma göre değiştiği için (`~` vs `%USERPROFILE%`) her makinede kurulumda yazılır, sync edilmez.

### Faz 0 — hafıza yazma politikası

Sync edilecek bir hafıza yoksa sistemin hiçbir değeri yok. Çıkış senaryosundaki kullanıcının `memory/` klasörü tasarım anında **boştu**. Bu yüzden `<syncRoot>/CLAUDE.md` içine, üç makinede de geçerli olacak şekilde, proje kararlarının hafızaya yazılmasını isteyen bir politika konur. Kod değil, talimat — ama sistemin değerinin çoğu buradan geliyor.

## Mimari

**Yaklaşım: hook ile kopyalama (mirror).** Gerçek dosyalar yerelde durur; `<syncRoot>` yalnızca taşıma katmanıdır.

Elenen alternatif — symlink/junction: Windows'ta bulut sürücüler sanal sürücü olarak bağlanıyor (`G:\` gibi), junction güvenilmez ve Developer Mode/admin istiyor; mount düştüğünde Claude skill'leri hiç göremez hale geliyor. Hedef kullanıcının iki Windows makinesi olduğu için bu risk iki kere alınıyordu.

**Transport bağımsızlığı:** araç yalnızca bir `syncRoot` klasör yolu bilir. O klasörü makineler arasında ne taşıdığı (Google Drive, OneDrive, Dropbox, Syncthing, git repo) aracı ilgilendirmez. Bu hem aracı dağıtılabilir kılar hem de tek bir sağlayıcıya bağımlılığı ortadan kaldırır.

**Dil/çalışma zamanı:** Node.js. Hedeflenen ajanların tamamı Node tabanlı ya da Node gerektiriyor, dolayısıyla üç makinede de garantili. Tek bir kod tabanı üç platformda aynı şekilde çalışır; ayrı bash + PowerShell script'i yazma ihtiyacı ortadan kalkar.

## Adapter katmanı (çok araçlılık)

Senkron motorunun hiçbir yeri belirli bir araca bağlı değil: hash'leme, çakışma çözümü, registry ve kimlik çözümlemesi düz dosyalarla çalışır. Araca özgü olan tek şey **son adım** — senkronize edilmiş hafızanın, o aracın okuduğu yere yazılması. Bu adım adapter'lara ayrılır.

### Kanonik depo tarafsızdır

`<syncRoot>/memory/<proje-id>/*.md` düz markdown'dır ve hiçbir aracın formatına ait değildir. Adapter'lar bu tek kaynaktan okur; hiçbir adapter kanonik depoya yazmaz. Böylece araç ekleme/çıkarma hafızayı bozmaz.

### Adapter arayüzü

Her adapter şu alanları bildirir:

| Alan | Anlamı |
|---|---|
| `id` | Kısa kimlik (`claude`, `codex`, ...) — config'deki `targets` bu değerleri taşır |
| `label` | Kullanıcıya gösterilen ad |
| `detect()` | Bu araç bu makinede kurulu mu? `init` bunu kullanarak öneri sunar |
| `globalInstructionsPath()` | Araç genelinde geçerli talimat dosyası, yoksa `null` |
| `projectMemoryDir(cwd)` | Araç proje hafızasını dizin olarak okuyorsa yolu, yoksa `null` |
| `projectInstructionsPath(cwd)` | Araç proje bağlamını tek dosyadan okuyorsa yolu, yoksa `null` |
| `installHooks(ctx)` | Aracın hook sistemi varsa kurar, yoksa `null` |

### v1 adapter'ları

| `id` | Araç | Proje bağlamı | Global | Hook |
|---|---|---|---|---|
| `claude` | Claude Code | `~/.claude/projects/<slug>/memory/` (dizin) | `~/.claude/CLAUDE.md` | var |
| `codex` | Codex CLI | `AGENTS.md` | `~/.codex/AGENTS.md` | yok |
| `opencode` | OpenCode | `AGENTS.md` | `~/.config/opencode/AGENTS.md` | yok |
| `gemini` | Gemini CLI | `GEMINI.md` | `~/.gemini/GEMINI.md` | yok |
| `aider` | Aider | `CONVENTIONS.md` | yok | yok |
| `cursor` | Cursor | `.cursor/rules/agent-sync.mdc` | yok | yok |

Hepsi yazılır, ancak yalnızca `config.json`'daki `targets` listesinde bulunanlar çalıştırılır. `init` makinede kurulu araçları `detect()` ile bulup önerir; seçim kullanıcınındır.

**Hedef yolu çakışması:** `codex` ve `opencode` aynı proje dosyasını (`AGENTS.md`) kullanır. Yazma katmanı hedefleri mutlak yola göre tekilleştirir; aynı dosya iki kez yazılmaz.

### Dizin hafızasından tek dosyaya: digest

Kanonik hafıza "her dosyada bir bilgi" biçiminde çok sayıda markdown dosyasıdır. Claude Code bunu dizin olarak okuyabilir; diğer araçların çoğu tek bir dosya bekler. Bu yüzden adapter'lar için hafıza tek bir markdown belgesine derlenir (digest).

Digest, hedef dosyanın tamamını ezmez — kullanıcının kendi yazdığı içerik korunur. Yazma, açık sınırlayıcılar arasına yapılır:

```markdown
<!-- agent-sync:begin -->
... derlenen hafıza ...
<!-- agent-sync:end -->
```

Sınırlayıcılar yoksa blok dosyanın sonuna eklenir; varsa yalnızca aradaki içerik değiştirilir. Dosya yoksa oluşturulur.

### Otomatik tetikleme

Hedef araçlar arasında güvenilir bir oturum başlangıcı/bitişi kancası yalnızca Claude Code'da var. Üç tetikleme yolu tanımlanır ve kullanıcı hangilerini istediğine `init`'te karar verir:

**1. VS Code extension (birincil).** Kullanıcının ajanları zaten VS Code içinde çalışıyor (Claude Code, Codex, ve diğerleri eklenti olarak). Extension, VS Code'un kendi yaşam döngüsü olaylarına bağlanır: `activate` ve pencere odağı kazanma → `pull`; `deactivate` ve odak kaybı → `push`. Böylece **hangi ajan kullanılırsa kullanılsın** tetikleme aynı yerden gelir; araç başına hook desteği aranmaz. Ayrıca durum çubuğunda bir gösterge ve elle basılabilir bir `Sync` komutu sunar.

**2. Claude Code hook'ları (opsiyonel).** Terminalden (VS Code dışında) Claude Code kullananlar için. `init` bunu sorar, zorunlu değildir. Extension kuruluysa gereksizdir.

**3. `run` sarmalayıcısı.** Terminal araçları (Aider gibi) ve VS Code dışı kullanım için:

```
agent-sync run codex        # pull → codex'i çalıştır → çıkışta push
agent-sync run aider
```

Sarmalayıcı, verilen komutu alt süreç olarak çalıştırır, stdio'yu doğrudan bağlar (etkileşimli TUI'ler bozulmasın diye), çıkış kodunu aynen döndürür ve süreç nasıl biterse bitsin `push` çalıştırır.

## Cepheler (frontends)

Motor tek, cephe iki. İkisi de aynı `src/` modüllerini çağırır; iş mantığı hiçbir cephede tekrarlanmaz.

```
              src/  — motor + adapter'lar (paylaşılan)
                 │                    │
      bin/agent-sync.mjs        extension/
      terminal, SSH, CI, test   VS Code: durum çubuğu,
                                komutlar, otomatik tetikleme
```

**CLI neden korunuyor:** testlerin koştuğu yer orasıdır; SSH ile bağlanıldığında VS Code yoktur; Aider gibi terminal araçları extension kapsamı dışındadır; ve CI'da çalıştırılabilir tek giriş noktasıdır.

**Extension'ın sunduğu:**

| Yüzey | Davranış |
|---|---|
| Durum çubuğu öğesi | Son sync zamanı, bekleyen değişiklik sayısı, çakışma varsa uyarı rengi |
| `agent-sync.sync` komutu | Elle pull+push |
| `agent-sync.doctor` komutu | Sağlık kontrollerini bir çıktı kanalında gösterir |
| `agent-sync.link` komutu | Açık workspace'i bir proje kimliğine bağlar (quick pick ile) |
| Otomatik tetikleme | `activate`, pencere odağı, `deactivate` |
| Ayarlar | `syncRoot`, `machineId`, `targets` VS Code ayar arayüzünden düzenlenebilir; `config.json` ile aynı dosyaya yazar |

Extension, motoru **aynı süreçte** çağırır (alt süreç değil) — böylece hata mesajları doğrudan yakalanır ve Node yolu aranmaz. Motor saf ESM ve bağımlılıksız olduğu için bu doğrudan mümkündür.

**Extension'ın getirdiği sadeleştirme:** tetikleme extension'a taşındığında `init`'in Claude'un `settings.json`'ına hook yazması zorunlu olmaktan çıkar; kullanıcının sistemine müdahale azalır.

**Dağıtım:** extension VSIX olarak paketlenir. Marketplace'e yayınlamak bir publisher hesabı gerektirir; v1'de VSIX dosyası repo'nun release'lerinden indirilip `code --install-extension` ile kurulabilir. Marketplace yayını ayrı ve sonraki bir adımdır.

### Bilinçli sınır: skill'ler her araçta tetiklenmez

Skill formatı (frontmatter'lı `SKILL.md`) Claude Code'a özgüdür ve diğer araçlarda otomatik tetiklenme karşılığı yoktur. Adapter'lar skill dosyalarını senkronize eder ve digest içinden bunlara referans verir — yani içerik her araçta erişilebilir olur, ama Claude'daki gibi kendiliğinden devreye girmez. Bu bir eksiklik olarak değil, kapsam sınırı olarak belgelenir; README'de açıkça yazılır.

## Klasör düzeni

### `<syncRoot>` (makineler arası ortak alan)

```
<syncRoot>/
├── registry.json          # proje-id → isim + her makinedeki yol
├── CLAUDE.md              # tüm projelerde geçerli talimatlar (hafıza politikası dahil)
├── settings-shared.json   # enabledPlugins, extraKnownMarketplaces, model, effortLevel
├── skills/                # kullanıcı skill'leri
├── memory/
│   ├── _global/           # projeden bağımsız hafıza
│   └── <proje-id>/        # proje başına hafıza
└── bin/sync.mjs           # senkron scripti; kendisi de sync'lenir
```

`bin/sync.mjs`'in sync edilmesi bilinçli: script bir makinede güncellenince diğer ikisine kendiliğinden yayılır.

### Yerel (her makinede)

Aracın kendi durumu, herhangi bir ajanın dizininin **içinde değil**, kendi dizinindedir. Araç çok araçlı olduğu için `~/.claude/` altında yaşaması yanlış olurdu:

```
~/.agent-sync/                     # aracın kendi alanı
├── staged/                        # <syncRoot>'un yerel aynası (kanonik kopya)
│   ├── skills/
│   ├── memory/<proje-id>/
│   └── shared/                    # CLAUDE.md, settings-shared.json
├── config.json                    # makineye özel — SYNC EDİLMEZ
├── state.json                     # son sync hash'leri — SYNC EDİLMEZ
└── snapshots/<ts>/                # pull öncesi yedek — SYNC EDİLMEZ
```

Adapter'lar `staged/`'den okuyup her aracın kendi konumuna yazar:

```
~/.claude/CLAUDE.md                       # claude adapter
~/.claude/skills/                         # claude adapter
~/.claude/projects/<yerel-slug>/memory/   # claude adapter
~/.claude/settings.json                   # yalnızca 4 anahtar merge edilir
~/.codex/AGENTS.md                        # codex adapter
<proje>/AGENTS.md                         # codex + opencode adapter (tekilleştirilir)
<proje>/GEMINI.md                         # gemini adapter
```

### `config.json` (makineye özel, repoya girmez)

```json
{
  "syncRoot": "/Users/<kullanıcı>/Library/CloudStorage/GoogleDrive-<hesap>/Drive'ım/agent-sync",
  "machineId": "macbook",
  "targets": ["claude", "codex"],
  "syncTranscripts": false,
  "snapshotKeep": 20
}
```

`machineId` çakışma dosyalarının adlandırılmasında ve `registry.json`'da yol kaydında kullanılır. Kurulumda sorulur.

`targets`, bu makinede hangi adapter'ların çalıştırılacağını belirler. `init` sırasında `detect()` ile bulunan araçlar önerilir, seçim kullanıcınındır. Boş liste geçerlidir — senkron yine çalışır, yalnızca hiçbir araca yazılmaz.

## Proje kimliği

Bu, tasarımın çekirdek problemi: yol değişse de aynı projeyi tanımak.

**Marker dosyası tek başına yetmez.** Proje kökündeki `.claude-project-id` mac'te oluşturulur ama PC'deki kopyada yoktur (repoya commit edilmediği için) — PC yeni bir id üretir ve tek proje iki kimliğe bölünür. Bu yüzden marker'a **ilk karşılaşma eşleştirmesi** eşlik eder.

### Kimlik çözümleme sırası

Bir projede oturum açıldığında:

1. Kökte `.claude-project-id` var mı? → id budur, bitti.
2. Yoksa, git remote URL'i `registry.json`'daki bir kayıtla eşleşiyor mu? → o id benimsenir, marker yazılır.
3. Yoksa, klasör adı registry'de **tam olarak bir** kayıtla eşleşiyor mu? → o id benimsenir, marker yazılır, işlem `doctor` raporuna bilgi olarak düşülür.
4. Hiçbiri değilse (veya klasör adı birden fazla kayda uyuyorsa) → yeni id üretilir (`<klasör-adı>-<6 hane hex>`), registry'ye eklenir, çoklu eşleşme durumu `doctor`'a uyarı olarak yazılır.

Sonuç: `avukatsite` PC'de ilk açıldığında adım 2 veya 3 devreye girer ve mac'teki hafızaya bağlanır. Yanlış bağlanırsa `agent-sync link <proje-id>` ile düzeltilir.

### Marker dosyasının repoya bulaşmaması

Marker, projenin `.gitignore`'una **eklenmez** — kullanıcının versiyonlanan dosyasına dokunmak müdahaledir. Bunun yerine `.git/info/exclude`'a (yerel, versiyonlanmayan ignore listesi) eklenir. Git olmayan projelerde bu adım atlanır.

### `registry.json` şeması

```json
{
  "version": 1,
  "projects": {
    "avukatsite-7f3a9c": {
      "name": "avukatsite",
      "gitRemote": "https://github.com/<kullanıcı>/avukatsite.git",
      "paths": {
        "macbook": "/Users/<kullanıcı>/Desktop/avukatsite",
        "pc": "C:\\Users\\<kullanıcı>\\Desktop\\avukatsite"
      },
      "lastSeen": "2026-08-12T12:00:00Z"
    }
  }
}
```

`gitRemote` yoksa alan atlanır. `paths` yalnızca bilgi ve `doctor` çıktısı içindir; kimlik kararı ona dayanmaz.

### Yerel slug hesabı

Claude Code, hafızayı ve transcript'leri `~/.claude/projects/<yerel-slug>/` altında tutar ve slug'ı çalışılan dizinin mutlak yolundan üretir: alfanümerik olmayan her karakter `-` ile değiştirilir (`/Users/mert/Desktop/avukatsite` → `-Users-mert-Desktop-avukatsite`). Araç, kimlikten yerel yola geçerken bu kuralı uygular; slug'ı kendisi icat etmez, Claude Code'un beklediği dizini hedefler.

## Senkron algoritması

**Kapsam:** `pull` ve `push`, yalnızca o an çalışılan projeyi değil, sync kapsamındaki **her şeyi** işler — skill'ler, `CLAUDE.md`, paylaşılan ayarlar, `memory/_global/` ve registry'deki tüm projelerin hafızası. Bu dosyalar toplamda birkaç yüz kilobayt olduğu için seçici sync'in getireceği karmaşıklığa değmez; ayrıca kullanıcı bir makinede hangi projeyi açarsa açsın diğer projelerin hafızası da güncel kalır.

`state.json`, son başarılı sync'te her dosyanın içerik hash'ini (SHA-256) tutar. Dosya başına karar:

| Yerel değişti | Uzak değişti | Aksiyon |
|---|---|---|
| hayır | hayır | atla |
| evet | hayır | push (yerel → uzak) |
| hayır | evet | pull (uzak → yerel) |
| evet | evet | **çakışma** — aşağıya bak |

**Çakışma çözümü:** uzaktaki sürüm kanonik adı alır ve yerele yazılır; yerel sürüm `<ad>.conflict-<machineId>-<YYYYMMDD-HHmm>.<uzantı>` olarak yanına kaydedilir. Hiçbir içerik silinmez. Çakışma `doctor` çıktısında ve komut sonunda listelenir.

Bu kural, hafıza dosyalarının "her dosyada bir bilgi" formatında olması sayesinde pratikte nadiren tetiklenir — iki makinenin aynı dosyayı aynı aralıkta değiştirmesi gerekir.

**Silme yayılmaz.** Yerelde silinen dosya bir sonraki pull'da `<syncRoot>`'tan geri gelir. Gerekçe: bir dosyanın "silindiği" ile "henüz sync olmamış yeni dosya olduğu" ayrımı hatalı yapılırsa hafıza sessizce kaybolur. Kasıtlı silme ayrı komutla yapılır: `agent-sync forget <yol>` — dosyayı hem yerelden hem `<syncRoot>`'tan siler ve `state.json`'dan düşer.

**Snapshot:** her pull'dan önce, sync kapsamındaki yerel dosyalar `~/.agent-sync/snapshots/<timestamp>/` altına kopyalanır. Son `snapshotKeep` (varsayılan 20) adet tutulur, eskiler silinir. Bunlar küçük metin dosyaları olduğu için maliyeti ihmal edilebilir. Geri alma ihtiyacının cevabı budur.

**`<syncRoot>` içine git repo konulmaz.** Bulut klasörüne konan `.git` dizini iki makine aynı anda yazdığında bozulur; geçmiş/geri alma ihtiyacı yukarıdaki snapshot mekanizmasıyla karşılanır.

### `settings.json` merge

Tüm dosya kopyalanmaz — içinde makineye özel alanlar (izinler, env değişkenleri, hook tanımları) bulunabilir. Yalnızca dört anahtar merge edilir: `enabledPlugins`, `extraKnownMarketplaces`, `model`, `effortLevel`. Diğer tüm alanlar olduğu gibi bırakılır. Merge öncesi `settings.json`'ın kopyası snapshot'a alınır.

## Hook'lar ve komutlar

### Hook'lar (kurulumda her makineye ayrı yazılır)

- `SessionStart` → `pull` + çalışılan dizin için kimlik çözümleme/marker yazma
- `Stop` → `push`

**Hook'lar hiçbir koşulda oturumu bloklamaz.** `<syncRoot>` erişilemezse, mount düşmüşse, script hata verirse: uyarı yazılır, çıkış kodu 0'dır, oturum normal devam eder. Süre sınırı konur; aşılırsa iş yarıda kesilir ve yine 0 dönülür.

### CLI

```
agent-sync status           # bu makine, bu proje, kimlik, aktif araçlar, bekleyen değişiklikler
agent-sync pull             # uzaktan çek ve seçili araçlara yaz
agent-sync push             # uzağa yaz
agent-sync doctor           # sağlık kontrolü (aşağıda)
agent-sync link <proje-id>  # bu dizini verilen kimliğe bağla
agent-sync forget <yol>     # kasıtlı silme
agent-sync run <komut...>   # pull → komutu çalıştır → çıkışta push
agent-sync init             # ilk kurulum: config.json, araç seçimi, hook'lar, <syncRoot> iskeleti
```

Her komut `--dry-run` destekler: hiçbir şeye dokunmadan yapılacak işlemleri listeler.

### `doctor` kontrolleri

1. `<syncRoot>` erişilebilir mi, yazılabilir mi?
2. Bulut sağlayıcısının kendi çakışma artıkları (`dosya (1).md`, `... (conflicted copy) ...`, `...-<makine adı>.md` kalıpları) — bulut sağlayıcı sessizce oluşturduğu için özellikle aranır.
3. Bizim ürettiğimiz `.conflict-*` dosyaları — çözülmeyi bekliyor.
4. Registry tutarlılığı: kimliksiz kalmış hafıza klasörleri, aynı klasör adına sahip birden fazla kayıt.
5. **Sır taraması:** `<syncRoot>`'a gidecek dosyalarda API anahtarı/token kalıpları. Hafıza notları buluta çıktığı ve araç halka açık dağıtılacağı için, sır içeren bir not push edilmeden önce uyarı verilir.

## Faz 2 — transcript senkronu (kapalı gelir)

Mimari baştan destekler, `config.json`'da `syncTranscripts: true` ile açılır.

Açıldığında `~/.claude/projects/<yerel-slug>/*.jsonl` dosyaları `<syncRoot>/transcripts/<proje-id>/` altına eşlenir. Transcript dosyaları tek bir oturuma ait ve tek makine tarafından yazıldığı için çakışma riski düşüktür — dosya adı çakışması olmadığı sürece kopyalama yeterlidir.

Bilinen sınır: transcript içeriğindeki mutlak dosya yolları yazıldıkları platforma aittir; başka platformda `--resume` ile açıldığında bu yollar geçersiz olur. Claude dosyaları yeniden okuyacağı için genelde çalışır, ama bu bir garanti değildir. Varsayılanın kapalı olmasının sebebi budur.

## Dağıtım (GitHub)

Araç halka açık bir repo olarak yayınlanacağı için:

- Kod ve varsayılan konfigürasyonda hiçbir kişisel yol, hesap adı veya e-posta bulunmaz. Her şey `config.json`'dan gelir; `config.json` ve `state.json` `.gitignore`'dadır.
- README iki dilli (Türkçe + İngilizce), kurulum adımları macOS/Linux ve Windows için ayrı ayrı yazılır.
- `agent-sync init` etkileşimli kurulumu yapar: `syncRoot` sorulur, `machineId` sorulur, makinede kurulu araçlar `detect()` ile bulunup seçime sunulur, `<syncRoot>` iskeleti yoksa oluşturulur, hook desteği olan adapter'lar (şu an yalnızca `claude`) hook'larını kurar.
- Lisans: MIT.

## Kabul kriterleri

1. `agent-sync init` üç platformda da çalışır ve `--dry-run` ile önce ne yapacağını gösterir.
2. macOS'ta `~/.claude/skills/` altına bir skill eklenir → `push` → `<syncRoot>/skills/` altında görünür.
3. İkinci makinede `pull` → skill yerelde belirir ve Claude Code tarafından görülür.
4. macOS'ta `~/Desktop/testproj` içinde oturum açılır → marker yazılır, registry'ye kayıt düşer.
5. İkinci makinede farklı bir yolda (`C:\dev\testproj`) aynı isimli dizinde oturum açılır → adım 3 eşleştirmesi devreye girer, aynı proje kimliği benimsenir, hafıza notu orada görünür.
6. Aynı hafıza dosyası iki makinede birden değiştirilir → iki içerik de korunur, `.conflict-*` dosyası oluşur, `doctor` bunu raporlar.
7. `<syncRoot>` erişilemez hale getirilir → oturum normal açılır, yalnızca uyarı görülür.
8. Bir hafıza dosyasına sahte bir API anahtarı yazılır → `doctor` bunu yakalar.
9. `init`, makinede kurulu araçları tespit edip önerir; kullanıcının seçtikleri `targets`'a yazılır.
10. `targets` içinde `codex` varken `pull` çalıştırılır → proje kökünde `AGENTS.md` oluşur ve sınırlayıcılar arasında hafıza digest'i bulunur.
11. `AGENTS.md`'ye kullanıcı elle bir paragraf ekler → bir sonraki `pull` o paragrafı korur, yalnızca sınırlayıcı bloğunu günceller.
12. `targets` içinde hem `codex` hem `opencode` varken `AGENTS.md` tek kez yazılır.
13. `agent-sync run <komut>` çalıştırılır → önce pull olur, komut etkileşimli çalışır, komut bittiğinde push olur ve komutun çıkış kodu korunur.
14. Extension VSIX olarak kurulur → durum çubuğunda öğe belirir, son sync zamanını ve bekleyen değişiklik sayısını gösterir.
15. VS Code penceresi odak kazanır → `pull` çalışır; pencere kapatılır → `push` çalışır; kullanıcı hiçbir komut yazmaz.
16. Extension ayarlarından `targets` değiştirilir → `config.json` güncellenir ve CLI aynı değeri okur (tek kaynak).

Karar veren saf fonksiyonlar (çakışma çözümü, kimlik eşleştirme, ayar merge'i) birim testleriyle ayrıca doğrulanır.

## Bilinçli sınırlar

- Silme yayılmaz; kasıtlı silme `forget` ile yapılır.
- Gerçek zamanlı sync yoktur; senkron noktaları oturum başı ve sonudur (artı manuel komut).
- İki makine aynı anda açıksa, biri kapanana kadar diğerinin değişikliklerini görmez.
- Transcript senkronu varsayılan olarak kapalıdır.
- Skill'ler yalnızca Claude Code'da otomatik tetiklenir; diğer araçlarda içerik erişilebilir olur ama tetiklenmez.
- Araca özgü otomatik hook yalnızca Claude Code'da vardır. VS Code içinde çalışan her ajan için tetiklemeyi extension üstlenir; VS Code dışında `agent-sync run <komut>` kullanılır.
- Extension v1'de Marketplace'te değil, VSIX olarak dağıtılır.
- Adapter'lar tek yönlüdür: kanonik depodan araca yazarlar, araçtan kanonik depoya okuma yapmazlar. Bunun tek istisnası `claude` adapter'ıdır — Claude Code'un hafıza dizini ve `settings.json`'ı kanonik depoya geri beslenir, çünkü kullanıcı hafızayı orada üretiyor.
