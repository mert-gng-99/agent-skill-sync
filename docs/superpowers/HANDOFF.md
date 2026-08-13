# agent-sync — Devir Teslim Notu

**Son güncelleme:** 2026-08-13
**Bu belge tek başına yeterlidir.** Devralan agent'ın önceki konuşmaya, başka bir araca veya kullanıcının anlatımına ihtiyacı yoktur. Sırayla oku, uygula.

---

## 1. Proje nedir

`agent-sync`, kodlama ajanlarının **skill'lerini, kalıcı hafızasını ve paylaşılan ayarlarını** iki eksende senkronize eden bir CLI aracıdır:

- **Makineler arası:** 1 macOS MacBook + 2 Windows makine.
- **Araçlar arası:** Claude Code, Codex, OpenCode, Gemini CLI, Aider, Cursor. (Bir aracın limiti dolunca diğerine geçildiğinde bağlam kaybolmasın diye.)

Çözdüğü çekirdek problem: ajanlar proje verisini **mutlak yoldan türetilen** bir klasörde saklar. Aynı proje macOS'ta `-Users-mert-Desktop-avukatsite`, Windows'ta `C--Users-mert-Desktop-avukatsite` olur — sistem bunları iki ayrı proje sanır. `agent-sync` yol bağımsız bir proje kimliği kurarak bunu çözer.

GitHub'a açık kaynak olarak yayınlanacak. Bu yüzden hiçbir dosyada gerçek kullanıcı adı, e-posta veya mutlak makine yolu bulunmamalıdır.

---

## 2. Şu anki durum

| | |
|---|---|
| Branch | `feat/implementation` (`main`'de yalnızca dokümanlar var) |
| Toplam task | 16 |
| Tamamlanan | 1 |
| Yazılan ama review edilmeyen | **0** |
| Test durumu | 5/5 geçiyor, çıktı temiz |

### Task durumları

| # | Task | Dosyalar | Durum |
|---|---|---|---|
| 1 | Proje iskeleti ve yol/slug modülü | `package.json`, `src/paths.mjs` | ✅ **Tamamlandı** |
| 2 | Config modülü (`targets` dahil) | `src/config.mjs` | ⬜ |
| 3 | Senkron karar motoru (saf) | `src/state.mjs`, `src/sync-engine.mjs` | ⬜ |
| 4 | Manifest tarayıcı ve snapshot | `src/manifest.mjs`, `src/snapshot.mjs` | ⬜ |
| 5 | Uygulama katmanı (çakışma yönetimi) | `src/apply.mjs` | ⬜ |
| 6 | Registry ve kimlik çözümleme | `src/registry.mjs`, `src/identity.mjs` | ⬜ |
| 7 | `settings.json` seçici merge | `src/settings-merge.mjs` | ⬜ |
| 8 | Sır taraması ve doctor | `src/secrets.mjs`, `src/doctor.mjs` | ⬜ |
| 9 | Motor akışı | `src/sync.mjs` | ⬜ |
| 10 | Proje bağlama ve marker yönetimi | `src/project.mjs` | ⬜ |
| 11 | Hafıza digest'i ve sınırlayıcılı blok | `src/render.mjs` | ⬜ |
| 12 | Adapter katmanı (6 araç) | `src/adapters/*.mjs` | ⬜ |
| 13 | `run` sarmalayıcısı | `src/run.mjs` | ⬜ |
| 14 | Etkileşimli kurulum ve CLI kabuğu | `src/init.mjs`, `bin/agent-sync.mjs` | ⬜ |
| 15 | Dağıtım paketi | `README.md`, `LICENSE` | ⬜ |
| 16 | VS Code extension kabuğu | `extension/*` | ⬜ |


**Task 1 neden "tamamlandı" değil:** kod yazıldı ve testleri geçiyor, ama bağımsız bir gözden geçirmeden geçmedi. Bu projede bir task, review'dan temiz dönene kadar bitmiş sayılmaz.

**Sıradaki ilk iş Task 2 değil — Task 1'in review'ıdır.** (Bkz. bölüm 4.)

---

## 3. Devralan agent için başlangıç

Kullanıcı sana bu projeyi verdiyse, yapman gereken tek şey şu sırayla ilerlemek:

1. Bu belgeyi baştan sona oku (şu an yapıyorsun).
2. `docs/superpowers/specs/2026-08-12-agent-sync-design.md` — tasarımı oku. **Bir kere.** Kararların gerekçeleri burada.
3. `docs/superpowers/plans/2026-08-12-agent-sync.md` — implementation planı. **2800 satır, tamamını okuma.** Yalnızca üzerinde çalıştığın task'ın bölümünü oku (`### Task N:` başlığından bir sonrakine kadar).
4. Bölüm 4'teki döngüyü uygula.

Planın içinde **her task'ın tam kodu ve tam testleri yazılı**. Senden mimari icat etmen beklenmiyor; planı uygulaman ve doğrulaman bekleniyor. Planla çeliştiğini düşündüğün bir şey görürsen kendi kafana göre değiştirme — kullanıcıya sor.

---

## 4. Bir task nasıl yürütülür

Araçtan bağımsız döngü. Her task için aynısı:

```
1. Planda o task'ın bölümünü oku (Files, Interfaces, Steps).
2. Testi yaz — plandaki test kodunu birebir kullan.
3. Testi ÇALIŞTIR ve düştüğünü gör. (Bu adımı atlama; testin gerçekten
   bir şey doğruladığının tek kanıtı bu.)
4. Implementasyonu yaz — plandaki kodu birebir kullan.
5. Testi ÇALIŞTIR ve geçtiğini gör.
6. Commit'ten önce bir kez tüm süiti çalıştır: npm test
7. Plandaki commit mesajıyla commit et.
8. REVIEW: değişikliği bağımsız bir gözle denetle (bkz. aşağı).
9. Review temizse bu belgedeki durum tablosunu güncelle ve sonraki task'a geç.
```

### Review adımında neye bakılır

Kod yazan taraf kendi işini onaylamaz. Ayrı bir geçiş yap (mümkünse ayrı bir agent/oturum):

- **Spec uyumu:** plandaki her gereksinim karşılandı mı? Planda olmayan bir şey eklendi mi (YAGNI ihlali)?
- **Global kısıtlar** (bölüm 6) çiğnendi mi?
- **Test kalitesi:** testler gerçek davranışı mı doğruluyor, yoksa boş mu geçiyor? Çıktıda uyarı/gürültü var mı?
- **İsimlendirme:** isimler ne yaptığını mı anlatıyor, nasıl yaptığını mı?

Bulgu çıkarsa düzelt, düzeltmeyi kapsayan testi yeniden çalıştır, sonra devam et.

### Superpowers eklentisi olan bir Claude Code oturumundaysan

O zaman bu döngüyü otomatikleştiren bir akış var. Şunu yaz:

> `superpowers:subagent-driven-development` ile `docs/superpowers/plans/2026-08-12-agent-sync.md` planını yürüt. Task 1 yazıldı ama review edilmedi (commit `b70feb3`, BASE `54115f7`) — önce onun review'ıyla başla, sonra Task 2'den devam et.

Superpowers yoksa bölüm 4'ün başındaki manuel döngü zaten yeterlidir; eksik bir şey olmaz, sadece elle yaparsın.

---

## 5. Komutlar

```bash
node --version     # >= 20 gerekli (geliştirme makinesinde v24.11.1)
npm test           # tüm testler — node --test test/
node --test test/paths.test.mjs    # tek dosya
```

Bağımlılık yok, `npm install` gerekmez ve **hiçbir zaman bağımlılık eklenmemelidir**.

---

## 6. Global kısıtlar (her task için geçerli)

- **Node >= 20.** Yalnızca yerleşik modüller: `node:test`, `node:fs/promises`, `node:crypto`, `node:path`, `node:os`.
- **Sıfır runtime bağımlılığı.** `package.json`'da `dependencies` boş kalır.
- **Platformlar arası:** macOS, Linux, Windows. **Disk yolları** her zaman `node:path` ile kurulur, ev dizini `os.homedir()` ile alınır — asla string birleştirmeyle değil. Bilinçli istisna: **manifest göreli anahtarları** her zaman POSIX ayracı (`/`) kullanır, çünkü iki platformun manifest'i ancak böyle karşılaştırılabilir; bunlar diske dokunmadan önce `path.join(root, ...rel.split('/'))` ile çevrilir. Yani `/` yalnızca *anahtar* olarak geçer, *yol* olarak değil.
- **Kişisel veri yasak.** Commit edilen hiçbir dosyada gerçek kullanıcı adı, e-posta, mutlak yol veya hesap adı geçmez. Hepsi `config.json`'dan gelir; `config.json` ve `state.json` `.gitignore`'dadır.
- **Dil:** kod, kod yorumları ve CLI çıktısı İngilizce (araç uluslararası dağıtılacak). README iki dilli olacak: Türkçe + İngilizce.
- **Hook'lar asla oturumu bloklamaz.** Hook yolundan çağrılan her giriş noktası her koşulda çıkış kodu 0 döner.
- **Silme yayılmaz.** Bir tarafta olmayan dosya, diğer tarafta varsa kopyalanır — asla silinmez. Kasıtlı silme yalnızca `forget` komutuyla.
- **Motor hiçbir aracı bilmez.** Motor modüllerinde (`sync-engine`, `manifest`, `apply`, `state`, `registry`, `identity`, `sync`) hiçbir araç adı ve hiçbir araca özgü yol geçmez. Araca özgü her şey `src/adapters/` altındadır.
- **Adapter'lar kanonik depoya yazmaz.** Tek istisna `claude` adapter'ının `collect()` fonksiyonudur — kullanıcı hafızayı Claude'un dizininde ürettiği için oradan geri okunur.
- **Paylaşılan ayar anahtarları tam olarak dörttür:** `enabledPlugins`, `extraKnownMarketplaces`, `model`, `effortLevel`.

---

## 7. Verilmiş kararlar — yeniden tartışma

Bunlar kullanıcıyla konuşularak karara bağlandı. Daha iyi bir fikrin olsa bile önce sor; sessizce değiştirme.

| Konu | Karar | Gerekçe |
|---|---|---|
| Transport | Google Drive kullanılacak, ama araç **transport-agnostik**: yalnızca bir `syncRoot` klasör yolu ister | Dağıtılabilir olması için; OneDrive/Dropbox/Syncthing de çalışır |
| Mimari | Hook ile kopyalama (mirror) | Symlink/junction elendi: Windows'ta bulut sürücüler sanal sürücü olarak bağlanıyor, junction güvenilmez ve mount düşünce araç dosyaları hiç göremiyor |
| Proje kimliği | `.claude-project-id` marker + 4 adımlı çözümleme: marker → git remote → klasör adı → yeni id | Marker tek başına yetmez: ikinci makinede dosya yoktur, yeni id üretilir ve proje ikiye bölünür |
| Marker'ın git'e bulaşmaması | `.git/info/exclude`'a eklenir, **`.gitignore`'a değil** | Kullanıcının versiyonlanan dosyasına dokunmak müdahaledir |
| Tetikleme | VS Code extension birincil; Claude Code hook'ları opsiyonel; `run` sarmalayıcısı terminal araçları için | Hook sistemi olan tek araç Claude Code; extension VS Code içindeki tüm ajanları tek noktadan kapsıyor |
| Yerel durum dizini | `~/.agent-sync/` | Araç çok araçlı; `~/.claude/` içinde yaşaması tutarsız olurdu |
| Silme | Yayılmaz; kasıtlı silme `forget` ile | "Silindi" ile "henüz sync olmamış yeni dosya" ayrımı yanlış yapılırsa hafıza sessizce kaybolur |
| Geçmiş / geri alma | Her pull öncesi yerel snapshot (son 20 tutulur) | — |
| `syncRoot` içine git repo | **Konulmayacak** | İki makine eşzamanlı yazınca `.git` bozulur; geçmiş ihtiyacı snapshot'la karşılanıyor |
| Kapsam dışı | `~/.claude/plugins/` (~1 GB cache) ve konuşma transcript'leri | Plugin cache'i yerine 2 KB'lık ayar anahtarları taşınır; transcript'ler Faz 2, `syncTranscripts: false` varsayılanıyla kapalı |
| Skill'ler | Yalnızca Claude Code'da otomatik tetiklenir; diğer araçlarda içerik erişilebilir olur ama tetiklenmez | Skill formatı Claude'a özgü — bu bir sınır, README'de açıkça yazılacak |

---

## 8. Yürütme öncesi düzeltilmiş iki plan hatası

Plan yazıldıktan sonra, kod yazılmadan önce yapılan taramada çıktı. **Zaten düzeltildi**, tekrar düzeltmeye çalışma:

1. **CLI yanlış sıradaydı.** `bin/agent-sync.mjs` Task 9'daydı ama Task 10/12/13'ün modüllerini import ediyor — o noktada çalıştırılamaz bir binary üretecekti. CLI, Task 14'e taşındı; Task 9 artık yalnızca `src/sync.mjs` üretiyor.
2. **Global kısıt kendi kendiyle çelişiyordu.** "Kodda `/` elle yazılmaz" kuralı, `manifest.mjs`'in bilerek POSIX ayracı kullanmasıyla çakışıyordu. Kural bölüm 6'daki hâline hassaslaştırıldı.

Ayrıca planın kendi self-review'ında kritik bir boşluk bulunup kapatıldı: **araçlardan kanonik depoya geri okuma adımı (`collectFromTools`) hiç yoktu** — `staged/` sonsuza kadar boş kalır, sistem hiçbir şey senkronize etmezdi. Task 12'de `claude.collect()` olarak eklendi ve hem CLI hem `run` akışına bağlandı. Bu fonksiyonu silme veya "gereksiz" diye atlama.

---

## 9. Dosya haritası

```
agent-sync/
├── docs/superpowers/
│   ├── HANDOFF.md          ← bu dosya
│   ├── specs/2026-08-12-agent-sync-design.md    ← tasarım, gerekçeler
│   └── plans/2026-08-12-agent-sync.md           ← 16 task, tam kod + testler
├── src/
│   └── paths.mjs           ← Task 1 (yazıldı)
├── test/
│   └── paths.test.mjs      ← Task 1 (yazıldı)
├── AGENTS.md               ← kök işaretçi (Codex/OpenCode/Cursor okur)
├── CLAUDE.md               ← kök işaretçi (Claude Code okur)
├── package.json
└── .superpowers/sdd/2026-08-12-agent-sync/
        ├── progress.md     ← ledger: BASE commit'ler, hangi adımda kalındı
        ├── task-1-brief.md ← Task 1'in plandan çıkarılmış metni
        └── task-1-report.md ← Task 1 implementer'ının TDD kanıtı (RED/GREEN çıktıları)
```

`.superpowers/` **git'e girmez** ama bu makinede yerinde durur — aynı klasörde çalışıyorsan okuyabilirsin, faydalı ek bağlamdır. Yine de **durumun tek kaynağı bölüm 2'deki tablodur**, o klasör değil: depo başka bir makineye kopyalanırsa `.superpowers/` gelmez, bu belge gelir.

---

## 10. Akılda tutulacak tek şey

Bu sistemin değerinin çoğu senkron mekanizmasında **değil**, hafızanın gerçekten yazılmasında. Tasarım yapılırken kullanıcının `memory/` klasörü **bomboştu** — yani mükemmel çalışan bir senkron aracı bile taşıyacak bir şey bulamayacaktı.

Bu yüzden planda **Faz 0** var: `<syncRoot>/CLAUDE.md` içine, tüm projelerde geçerli olacak bir "proje kararlarını hafızaya yaz" politikası konur. Kod değil, talimat — ve atlanırsa araç ölü doğar. Task 15'te README yazılırken bunun da yerini bulduğundan emin ol.
