# claude-sync — Tasarım Dokümanı

**Tarih:** 2026-08-12
**Durum:** Onaylandı, implementation planı bekliyor

## Problem

Bir geliştirici birden fazla makinede Claude Code kullanıyor (bu tasarımın çıkış senaryosu: 1 macOS + 2 Windows). Her makine kendi başına yaşıyor:

- Bir makinede yazılan skill diğerinde yok.
- Bir projede alınan kararlar, tercihler, "bunu neden böyle yaptık" bilgisi o makinede kalıyor.
- Etkinleştirilen plugin'ler ve ayarlar makineden makineye farklı.
- Claude Code konuşma geçmişini `~/.claude/projects/<cwd-slug>/` altında saklıyor ve slug mutlak yoldan üretiliyor. Aynı proje macOS'ta `-Users-mert-Desktop-avukatsite`, Windows'ta `C--Users-mert-Desktop-avukatsite` oluyor — yol farklı olduğu için sistem bunları iki ayrı proje sanıyor.

Sonuç: kullanıcı makine değiştirdiğinde bağlamı sıfırdan kuruyor.

## Amaç

Skill'ler, kalıcı hafıza ve ayarlar üç makinede de ortak olsun; **dosya yolu farklı olsa bile aynı proje tanınsın.**

## Kapsam

### Faz 1 — dahil

| Ne | Nereden | Nereye |
|---|---|---|
| Kullanıcı skill'leri | `~/.claude/skills/` | `<syncRoot>/skills/` |
| Kalıcı hafıza | `~/.claude/projects/<yerel-slug>/memory/` | `<syncRoot>/memory/<proje-id>/` |
| Paylaşılan ayarlar | `~/.claude/settings.json` (4 anahtar) | `<syncRoot>/settings-shared.json` |
| Global talimatlar | `~/.claude/CLAUDE.md` | `<syncRoot>/CLAUDE.md` |

Paylaşılan 4 ayar anahtarı: `enabledPlugins`, `extraKnownMarketplaces`, `model`, `effortLevel`.

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

**Dil/çalışma zamanı:** Node.js. Claude Code zaten Node olmadan çalışmıyor, dolayısıyla üç makinede de garantili. Tek bir `sync.mjs` üç platformda aynı şekilde çalışır; ayrı bash + PowerShell script'i yazma ihtiyacı ortadan kalkar.

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

```
~/.claude/
├── CLAUDE.md                      # <syncRoot>'tan
├── skills/                        # <syncRoot>'tan
├── projects/<yerel-slug>/memory/  # <syncRoot>/memory/<proje-id>/ buraya eşlenir
├── settings.json                  # yalnızca 4 anahtar merge edilir
└── claude-sync/
    ├── sync.mjs                   # <syncRoot>/bin/sync.mjs kopyası
    ├── config.json                # makineye özel — SYNC EDİLMEZ
    ├── state.json                 # son sync hash'leri — SYNC EDİLMEZ
    └── snapshots/<ts>/            # pull öncesi yedek — SYNC EDİLMEZ
```

### `config.json` (makineye özel, repoya girmez)

```json
{
  "syncRoot": "/Users/<kullanıcı>/Library/CloudStorage/GoogleDrive-<hesap>/Drive'ım/claude-sync",
  "machineId": "macbook",
  "syncTranscripts": false,
  "snapshotKeep": 20
}
```

`machineId` çakışma dosyalarının adlandırılmasında ve `registry.json`'da yol kaydında kullanılır. Kurulumda sorulur.

## Proje kimliği

Bu, tasarımın çekirdek problemi: yol değişse de aynı projeyi tanımak.

**Marker dosyası tek başına yetmez.** Proje kökündeki `.claude-project-id` mac'te oluşturulur ama PC'deki kopyada yoktur (repoya commit edilmediği için) — PC yeni bir id üretir ve tek proje iki kimliğe bölünür. Bu yüzden marker'a **ilk karşılaşma eşleştirmesi** eşlik eder.

### Kimlik çözümleme sırası

Bir projede oturum açıldığında:

1. Kökte `.claude-project-id` var mı? → id budur, bitti.
2. Yoksa, git remote URL'i `registry.json`'daki bir kayıtla eşleşiyor mu? → o id benimsenir, marker yazılır.
3. Yoksa, klasör adı registry'de **tam olarak bir** kayıtla eşleşiyor mu? → o id benimsenir, marker yazılır, işlem `doctor` raporuna bilgi olarak düşülür.
4. Hiçbiri değilse (veya klasör adı birden fazla kayda uyuyorsa) → yeni id üretilir (`<klasör-adı>-<6 hane hex>`), registry'ye eklenir, çoklu eşleşme durumu `doctor`'a uyarı olarak yazılır.

Sonuç: `avukatsite` PC'de ilk açıldığında adım 2 veya 3 devreye girer ve mac'teki hafızaya bağlanır. Yanlış bağlanırsa `claude-sync link <proje-id>` ile düzeltilir.

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

**Silme yayılmaz.** Yerelde silinen dosya bir sonraki pull'da `<syncRoot>`'tan geri gelir. Gerekçe: bir dosyanın "silindiği" ile "henüz sync olmamış yeni dosya olduğu" ayrımı hatalı yapılırsa hafıza sessizce kaybolur. Kasıtlı silme ayrı komutla yapılır: `claude-sync forget <yol>` — dosyayı hem yerelden hem `<syncRoot>`'tan siler ve `state.json`'dan düşer.

**Snapshot:** her pull'dan önce, sync kapsamındaki yerel dosyalar `~/.claude/claude-sync/snapshots/<timestamp>/` altına kopyalanır. Son `snapshotKeep` (varsayılan 20) adet tutulur, eskiler silinir. Bunlar küçük metin dosyaları olduğu için maliyeti ihmal edilebilir. Geri alma ihtiyacının cevabı budur.

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
claude-sync status          # bu makine, bu proje, kimlik, son sync, bekleyen değişiklikler
claude-sync pull            # uzaktan çek
claude-sync push            # uzağa yaz
claude-sync doctor          # sağlık kontrolü (aşağıda)
claude-sync link <proje-id> # bu dizini verilen kimliğe bağla
claude-sync forget <yol>    # kasıtlı silme
claude-sync init            # ilk kurulum: config.json, hook'lar, <syncRoot> iskeleti
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
- `claude-sync init` etkileşimli kurulumu yapar: `syncRoot` sorulur, `machineId` sorulur, `<syncRoot>` iskeleti yoksa oluşturulur, hook'lar platforma uygun şekilde `~/.claude/settings.json`'a eklenir.
- Lisans: MIT.

## Kabul kriterleri

1. `claude-sync init` üç platformda da çalışır ve `--dry-run` ile önce ne yapacağını gösterir.
2. macOS'ta `~/.claude/skills/` altına bir skill eklenir → `push` → `<syncRoot>/skills/` altında görünür.
3. İkinci makinede `pull` → skill yerelde belirir ve Claude Code tarafından görülür.
4. macOS'ta `~/Desktop/testproj` içinde oturum açılır → marker yazılır, registry'ye kayıt düşer.
5. İkinci makinede farklı bir yolda (`C:\dev\testproj`) aynı isimli dizinde oturum açılır → adım 3 eşleştirmesi devreye girer, aynı proje kimliği benimsenir, hafıza notu orada görünür.
6. Aynı hafıza dosyası iki makinede birden değiştirilir → iki içerik de korunur, `.conflict-*` dosyası oluşur, `doctor` bunu raporlar.
7. `<syncRoot>` erişilemez hale getirilir → oturum normal açılır, yalnızca uyarı görülür.
8. Bir hafıza dosyasına sahte bir API anahtarı yazılır → `doctor` bunu yakalar.

Karar veren saf fonksiyonlar (çakışma çözümü, kimlik eşleştirme, ayar merge'i) birim testleriyle ayrıca doğrulanır.

## Bilinçli sınırlar

- Silme yayılmaz; kasıtlı silme `forget` ile yapılır.
- Gerçek zamanlı sync yoktur; senkron noktaları oturum başı ve sonudur (artı manuel komut).
- İki makine aynı anda açıksa, biri kapanana kadar diğerinin değişikliklerini görmez.
- Transcript senkronu varsayılan olarak kapalıdır.
