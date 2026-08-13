# agent-sync — Düzeltme Planı (2026-08-13)

**Bağlam:** 16 task'ın tamamı implemente edildi, 94/94 birim testi geçiyor. Ardından yapılan **bağımsız doğrulamada** (izole bir sandbox'ta uçtan uca gerçek çalıştırma) bir davranış hatası ve birkaç eksik bulundu. Bu belge onları kapatır.

**Önce oku:** `docs/superpowers/HANDOFF.md` — özellikle 6. bölümdeki global kısıtlar bu düzeltmeler için de geçerlidir (sıfır bağımlılık, Node yerleşik modülleri, kod/yorum İngilizce, kişisel veri yok).

**Çalışma şekli:** her görev için önce testi yaz, düştüğünü gör, düzelt, geçtiğini gör, commit et. Görevler sırayla yapılmalı; A ve B aynı hatanın iki ayağıdır.

---

## Bulgu 1 (ÖNEMLİ) — Temiz makinede sahte çakışma, ve artığın kalıcı yayılması

### Belirti

Yeni bir makinede ilk `pull` çalıştırıldığında `shared/settings-shared.json` için çakışma raporlanıyor:

```
pull     skills/humanizer/SKILL.md
pull     memory/proj-81ce68/db-secimi.md
conflict shared/settings-shared.json
conflict: shared/settings-shared.json - your version kept as settings-shared.conflict-pc-20260813-0632.json
```

Bir sonraki `pull`'da bu artık dosya `syncRoot`'a **push ediliyor** ve oradan diğer makinelere yayılıyor:

```
push     shared/settings-shared.conflict-pc-20260813-0632.json
```

Silme yayılmadığı için kendiliğinden temizlenmiyor. `doctor` sonsuza kadar uyarı veriyor:

```
WARN  unresolved sync conflicts: shared/settings-shared.conflict-pc-20260813-0632.json
```

### Kök neden

İki ayrı kusur üst üste biniyor:

**(A) Çakışma artıkları senkron kapsamına giriyor.** `.conflict-*` dosyaları tasarım gereği **yerel** kayıtlardır — kullanıcının kendi sürümünü kaybetmemesi için yerelde tutulur. Ama `collectManifest` onları da topluyor, dolayısıyla motor onları normal dosya sanıp `syncRoot`'a gönderiyor.

**(B) `pull` da araçlardan toplama yapıyor.** `bin/agent-sync.mjs` içinde `pull` ve `push` aynı `case` bloğunu paylaşıyor ve ikisinde de `collectFromTools` çağrılıyor. Temiz bir makinede sonuç şu oluyor:

1. `state.json` yok → karşılaştırma tabanı `null`
2. `collectFromTools` o makinenin kendi (henüz boş) ayarlarından **yerel bir kopya imal ediyor**
3. yerel ≠ uzak ve taban yok → motor **doğru şekilde** CONFLICT diyor

Yani karar motoru hatalı değil; ona hiç var olmamış bir "yerel değişiklik" sunuluyor.

`src/run.mjs` bu hatadan etkilenmiyor — orada sıra zaten doğru (`runSync` → `applyAdapters` → komut → `collectFromTools` → `runSync`). Değiştirme.

---

### Görev A: Çakışma artıkları senkron kapsamı dışına çıkarılsın

**Dosyalar:**
- Modify: `src/apply.mjs`
- Modify: `src/sync.mjs`
- Test: `test/sync.test.mjs` (mevcut dosyaya ekleme)

**DİKKAT — sık yapılan hata:** Filtrelemeyi `collectManifest` içinde yapma. `src/doctor.mjs` çakışma dosyalarını **bulmak için** `collectManifest`'i kullanıyor (3. sağlık kontrolü). Orada filtrelersen doctor artık çakışmaları göremez ve o kontrolü sessizce öldürmüş olursun. Filtre yalnızca `runSync` içinde uygulanacak.

- [ ] **Adım 1: Düşen testi yaz**

`test/sync.test.mjs` dosyasına ekle:

```js
import { isConflictArtifact } from '../src/apply.mjs';
import { withoutConflictArtifacts } from '../src/sync.mjs';

test('conflict artifacts are recognised by their filename', () => {
  assert.equal(isConflictArtifact('shared/settings-shared.conflict-pc-20260813-0632.json'), true);
  assert.equal(isConflictArtifact('memory/p/note.conflict-macbook-20260101-0000.md'), true);
  assert.equal(isConflictArtifact('shared/settings-shared.json'), false);
  assert.equal(isConflictArtifact('memory/p/note.md'), false);
});

test('sync drops conflict artifacts from both sides so they are never propagated', () => {
  const manifest = new Map([
    ['note.md', 'h1'],
    ['note.conflict-pc-20260813-0632.md', 'h2'],
    ['deep/other.md', 'h3'],
  ]);
  assert.deepEqual([...withoutConflictArtifacts(manifest).keys()].sort(), ['deep/other.md', 'note.md']);
});
```

- [ ] **Adım 2: Testi çalıştır, düştüğünü gör**

`node --test test/sync.test.mjs` → `isConflictArtifact is not a function` benzeri hata.

- [ ] **Adım 3: Düzelt**

`src/apply.mjs` — dosyanın üstüne sabiti taşı ve yardımcıyı dışa aç. `conflictName` de aynı sabiti kullansın (tek kaynak):

```js
const CONFLICT_MARKER = '.conflict-';

/**
 * Conflict copies are deliberately local records: they preserve the losing
 * side so nothing is ever destroyed. They must never travel to syncRoot,
 * or they propagate to every machine and, since deletions do not propagate,
 * never go away.
 */
export function isConflictArtifact(relPath) {
  return relPath.includes(CONFLICT_MARKER);
}
```

`conflictName` içindeki `.conflict-` literalini `CONFLICT_MARKER` ile değiştir; davranışı aynı kalmalı, mevcut `conflictName` testleri geçmeye devam etmeli.

`src/sync.mjs` — import'a ekle ve manifestleri süz:

```js
import { applyPlan, isConflictArtifact } from './apply.mjs';

/** Keeps conflict copies out of the sync entirely - see isConflictArtifact. */
export function withoutConflictArtifacts(manifest) {
  const out = new Map();
  for (const [rel, hash] of manifest) {
    if (!isConflictArtifact(rel)) out.set(rel, hash);
  }
  return out;
}
```

`runSync` içindeki iki satırı değiştir:

```js
const local = withoutConflictArtifacts(await collectManifest(pair.localDir));
const remote = withoutConflictArtifacts(await collectManifest(pair.remoteDir));
```

- [ ] **Adım 4: Testleri çalıştır**

`npm test` → hepsi geçmeli (mevcut 94 + yeni 2 = 96).

- [ ] **Adım 5: Commit**

```bash
git add src/apply.mjs src/sync.mjs test/sync.test.mjs
git commit -m "fix: keep conflict copies local instead of propagating them to syncRoot"
```

---

### Görev B: `pull` araçlardan toplama yapmasın

**Dosyalar:**
- Modify: `bin/agent-sync.mjs`

**Gerekçe:** toplama (`collectFromTools`) semantik olarak `push`'a aittir — "araçta ürettiklerimi al ve gönder". `pull` ise "uzaktakini getir" demektir; toplama yapması, hiç senkronlanmamış bir yerel sürüm imal edip sahte çakışma doğurur.

Bu değişiklikten sonra temiz makine akışı şöyle olur ve çakışma kendiliğinden ortadan kalkar:

1. `pull` → yerel boş, taban yok → her şey PULL edilir, çakışma yok
2. `applyAdapters` → uzaktan gelen ayarlar `~/.claude/settings.json`'a merge edilir
3. Sonraki `push` → `collectFromTools` artık **aynı** içeriği üretir → hash eşleşir → SKIP

Hook eşleşmesi de doğru kalır: `SessionStart` → `pull`, `Stop` → `push`.

- [ ] **Adım 1: Düzelt**

`bin/agent-sync.mjs`, `case 'pull': case 'push':` bloğunda şu satırları:

```js
      // Read authored content out of the tools first, or there is nothing to push.
      if (!dryRun) {
        await collectFromTools({ config, projectId: identity.id, cwd: process.cwd() });
      }
```

şununla değiştir:

```js
      // Only push reads authored content out of the tools. Collecting before a
      // pull manufactures a local copy that was never synced, which the engine
      // then correctly reports as a conflict - a false alarm on every new machine.
      if (command === 'push' && !dryRun) {
        await collectFromTools({ config, projectId: identity.id, cwd: process.cwd() });
      }
```

- [ ] **Adım 2: Doğrula**

`npm test` → hepsi geçmeli. Asıl doğrulama Görev D'deki smoke testidir; onu yazdıktan sonra bu düzeltmenin işe yaradığını orada gör.

- [ ] **Adım 3: Commit**

```bash
git add bin/agent-sync.mjs
git commit -m "fix: only collect from tools on push, not on pull"
```

---

## Bulgu 2 (KÜÇÜK) — `HANDOFF.md` kendi içinde çelişiyor

### Görev C: Devir teslim notunu tutarlı hale getir

**Dosyalar:**
- Modify: `docs/superpowers/HANDOFF.md`

2. bölümdeki tablo "Tamamlanan: 16" diyor, ama hemen altında (53–55. satırlar civarı) hâlâ eski metin duruyor:

> **Task 1 neden "tamamlandı" değil:** …
> **Sıradaki ilk iş Task 2 değil — Task 1'in review'ıdır.**

Ayrıca 4. bölümün sonundaki superpowers komutu hâlâ "Task 1 yazıldı ama review edilmedi… sonra Task 2'den devam et" diyor.

- [ ] Bu iki eski parçayı sil/güncelle. Yerine bu belgeye işaret eden bir satır koy:
  *"Tüm task'lar implemente edildi. Açık iş: `docs/superpowers/plans/2026-08-13-duzeltmeler.md`."*
- [ ] 5. bölümdeki komut örneklerinde `node --test test/paths.test.mjs` duruyor; bu hâlâ geçerli, dokunma.
- [ ] Commit: `docs: HANDOFF'u güncel duruma getir`

---

## Bulgu 3 (ÖNERİLEN) — Uçtan uca test yok

94 birim testinin hepsi geçtiği hâlde yukarıdaki hata kaçtı, çünkü **kimse sistemi gerçekten uçtan uca çalıştırmamıştı.** Aynı boşluk bir dahaki sefere de aynı sonucu verir.

### Görev D: Tekrarlanabilir smoke testi ekle

**Dosyalar:**
- Create: `scripts/smoke-test.sh`

Test, `HOME`'u geçici bir dizine yönlendirerek çalışır — bu sayede kullanıcının **gerçek `~/.claude` ve `~/.agent-sync` dizinlerine asla dokunmaz.** (Node'un `os.homedir()` fonksiyonu POSIX'te `$HOME`'u dikkate alır.) Bu izolasyon zorunludur; script'i onsuz çalıştırılabilir hâle getirme.

Aşağıdaki script'i olduğu gibi kur, çalıştırılabilir yap (`chmod +x`), ve iki senaryoyu doğrula.

```bash
#!/usr/bin/env bash
# End-to-end smoke test. Runs entirely inside a temporary HOME so the real
# ~/.claude and ~/.agent-sync are never touched.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$REPO/bin/agent-sync.mjs"
SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT

mkdir -p "$SB/home/.agent-sync" "$SB/drive" "$SB/proj"
cat > "$SB/home/.agent-sync/config.json" <<EOF
{ "syncRoot": "$SB/drive", "machineId": "machine-a", "targets": ["claude"],
  "syncTranscripts": false, "snapshotKeep": 20 }
EOF

export HOME="$SB/home"
SLUG="$(node -e "import('$REPO/src/paths.mjs').then(m=>console.log(m.slugForPath('$SB/proj')))")"
mkdir -p "$SB/home/.claude/projects/$SLUG/memory" "$SB/home/.claude/skills/demo"
echo 'We chose Postgres over MySQL.' > "$SB/home/.claude/projects/$SLUG/memory/db-choice.md"
echo '# demo skill' > "$SB/home/.claude/skills/demo/SKILL.md"
printf '{"model":"opus","effortLevel":"xhigh","permissions":{"allow":["machine-local"]}}' \
  > "$SB/home/.claude/settings.json"

echo "--- machine A: push ---"
( cd "$SB/proj" && node "$BIN" push )

echo "--- assert: canonical store populated ---"
test -f "$SB/drive/registry.json"                       || { echo "FAIL: no registry"; exit 1; }
test -f "$SB/drive/skills/demo/SKILL.md"                || { echo "FAIL: skills not pushed"; exit 1; }
test -f "$SB/proj/.claude-project-id"                   || { echo "FAIL: no marker"; exit 1; }
grep -q '"model"' "$SB/drive/shared/settings-shared.json" || { echo "FAIL: settings not shared"; exit 1; }
grep -q 'machine-local' "$SB/drive/shared/settings-shared.json" \
  && { echo "FAIL: machine-local settings leaked to syncRoot"; exit 1; }

echo "--- machine B: different path, no marker, fresh state ---"
mkdir -p "$SB/home-b/.agent-sync" "$SB/elsewhere/dev/proj"
cat > "$SB/home-b/.agent-sync/config.json" <<EOF
{ "syncRoot": "$SB/drive", "machineId": "machine-b", "targets": ["claude","codex"],
  "syncTranscripts": false, "snapshotKeep": 20 }
EOF
export HOME="$SB/home-b"
OUT="$( cd "$SB/elsewhere/dev/proj" && node "$BIN" pull )"
echo "$OUT"

echo "--- assert: no false conflict on a fresh machine ---"
echo "$OUT" | grep -qi conflict && { echo "FAIL: fresh pull reported a conflict"; exit 1; }

echo "--- assert: same project recognised despite a different path ---"
ID_A="$(cat "$SB/proj/.claude-project-id")"
ID_B="$(cat "$SB/elsewhere/dev/proj/.claude-project-id")"
[ "$ID_A" = "$ID_B" ] || { echo "FAIL: identity differs ($ID_A vs $ID_B)"; exit 1; }

echo "--- assert: memory arrived and AGENTS.md was generated ---"
SLUG_B="$(node -e "import('$REPO/src/paths.mjs').then(m=>console.log(m.slugForPath('$SB/elsewhere/dev/proj')))")"
test -f "$SB/home-b/.claude/projects/$SLUG_B/memory/db-choice.md" \
  || { echo "FAIL: memory did not reach machine B"; exit 1; }
grep -q 'agent-sync:begin' "$SB/elsewhere/dev/proj/AGENTS.md" \
  || { echo "FAIL: AGENTS.md digest missing"; exit 1; }

echo "--- assert: repeated pulls stay clean and produce no litter ---"
( cd "$SB/elsewhere/dev/proj" && node "$BIN" pull > /dev/null )
( cd "$SB/elsewhere/dev/proj" && node "$BIN" pull > /dev/null )
find "$SB/drive" -name '*.conflict-*' | grep -q . \
  && { echo "FAIL: conflict artifact leaked into syncRoot"; exit 1; }

echo
echo "SMOKE TEST PASSED"
```

- [ ] Script'i kur, `chmod +x scripts/smoke-test.sh`, çalıştır: `./scripts/smoke-test.sh`
- [ ] **Beklenen:** `SMOKE TEST PASSED`. Görev A ve B yapılmadan çalıştırılırsa "fresh pull reported a conflict" ile düşmesi gerekir — istersen önce onu görüp sonra düzeltmeleri uygula, hatanın gerçekten kapandığından emin ol.
- [ ] `README.md`'nin hem TR hem EN bölümüne bir satır ekle: smoke testinin nasıl çalıştırıldığı ve geçici `HOME` kullandığı için güvenli olduğu.
- [ ] Commit: `test: add sandboxed end-to-end smoke test`

---

## Bulgu 4 — Bütünsel gözden geçirme yapılmadı

Task'lar tek tek incelendi ama dalın tamamına bakan bir tur atılmadı. Yukarıdaki hata tam da tek task'a bakınca görünmeyen, sistem bütününde ortaya çıkan cinsten.

### Görev E: Final review

- [ ] Görev A–D bittikten sonra `main`'den bu yana olan tüm diff'i tek seferde gözden geçir.
- [ ] Özellikle bak: modüller arası sıralama varsayımları (kim kimden önce çalışmalı), HANDOFF'un 6. bölümündeki global kısıtların ihlali, testlerin gerçekten davranış doğrulayıp doğrulamadığı, ölü kod.
- [ ] Bulguları düzelt, `npm test` + `./scripts/smoke-test.sh` ikisini de çalıştır, commit et.

---

## Bitirme kontrol listesi

- [ ] `npm test` → hepsi geçiyor, çıktı temiz
- [ ] `./scripts/smoke-test.sh` → `SMOKE TEST PASSED`
- [ ] `node bin/agent-sync.mjs help` → çıkış kodu 0
- [ ] `git grep -niE "mertgungor|mert\.gng|mert\.protenis"` → kod ve dokümanlarda sonuç yok
- [ ] `node -e "console.log(require('./package.json').dependencies)"` → `undefined` veya `{}`
- [ ] `docs/superpowers/HANDOFF.md` içinde çelişkili ifade kalmadı

---

## Bulgu 5 (ÖNEMLİ — Görev A'nın yarattığı regresyon)

**Durum:** Görev A ve B doğru uygulandı, smoke testi geçiyor. Ancak Görev A, `doctor`'ın 3. sağlık kontrolünü **sessizce öldürdü.**

### Belirti

Yerelde gerçek bir çakışma artığı dururken `doctor` "sorun yok" diyor:

```
$ ls ~/.agent-sync/staged/shared/
settings-shared.conflict-macbook-20260813-0642.json     ← artık burada DURUYOR

$ agent-sync doctor
OK    unresolved sync conflicts: none                   ← ama görmüyor
```

### Kök neden

`src/doctor.mjs` içindeki 3. kontrol, çakışma dosyalarını **`syncRoot`'ta** arıyor:

```js
const remote = await collectManifest(syncRoot);
const names = [...remote.keys()];
...
const ours = names.filter((n) => n.includes('.conflict-'));
```

Görev A'dan önce bu çalışıyordu, çünkü çakışma artıkları (hatalı biçimde) `syncRoot`'a push ediliyordu. Görev A onları doğru şekilde yerelde tuttu — ve bu kontrol de aynı anda kör kaldı.

**Bu neden önemli:** kullanıcı bulut klasörünü bilerek seçti ve tek şartı çakışmaların *sessizce kaybolmaması*ydı. `doctor`'ın bu kontrolü o şartın tek garantisi. Şu hâliyle garanti yok.

**Neden kaçtı:** `doctor` için hiç test yok. `test/` altında `doctor.test.mjs` bulunmuyor.

---

### Görev F: `doctor` çakışmaları yerel ağaçlarda arasın + testi yazılsın

**Dosyalar:**
- Modify: `src/doctor.mjs`
- Test: `test/doctor.test.mjs` (yeni dosya)

- [ ] **Adım 1: Düşen testi yaz**

`test/doctor.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runDoctor } from '../src/doctor.mjs';

async function fixture() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'as-doctor-'));
  const syncRoot = path.join(base, 'drive');
  const local = path.join(base, 'staged-shared');
  await fs.mkdir(syncRoot, { recursive: true });
  await fs.mkdir(local, { recursive: true });
  return { syncRoot, local };
}

function conflictCheck(checks) {
  return checks.find((c) => c.name === 'unresolved sync conflicts');
}

test('doctor finds conflict copies in the local trees, where they now live', async () => {
  const { syncRoot, local } = await fixture();
  await fs.writeFile(path.join(local, 'settings-shared.conflict-pc-20260813-0642.json'), '{}');

  const check = conflictCheck(await runDoctor({ syncRoot, localRoots: [{ dir: local }] }));
  assert.equal(check.status, 'warn');
  assert.match(check.details, /conflict-pc/);
});

test('doctor reports none when the local trees are clean', async () => {
  const { syncRoot, local } = await fixture();
  await fs.writeFile(path.join(local, 'settings-shared.json'), '{}');

  const check = conflictCheck(await runDoctor({ syncRoot, localRoots: [{ dir: local }] }));
  assert.equal(check.status, 'ok');
  assert.equal(check.details, 'none');
});
```

- [ ] **Adım 2: Testi çalıştır, düştüğünü gör**

`node --test test/doctor.test.mjs` → ilk test düşmeli: `status` `'ok'` gelir ama `'warn'` beklenir. **Bu düşüş, regresyonun kanıtıdır.** Görmeden devam etme.

- [ ] **Adım 3: Düzelt**

`src/doctor.mjs` — import ekle:

```js
import { isConflictArtifact } from './apply.mjs';
```

3. kontrolü yerel ağaçları tarayacak şekilde değiştir (`localRoots` fonksiyona zaten geliyor, sır taraması için kullanılıyor):

```js
  // 3. Our own conflict files awaiting resolution. These are local by design -
  // they are never pushed to syncRoot - so the local trees are where to look.
  const ours = [];
  for (const { dir } of localRoots) {
    for (const rel of (await collectManifest(dir)).keys()) {
      if (isConflictArtifact(rel)) ours.push(rel);
    }
  }
  checks.push({
    name: 'unresolved sync conflicts',
    status: ours.length ? WARN : OK,
    details: ours.join(', ') || 'none',
  });
```

2. kontrole (bulut sağlayıcı artıkları) **dokunma** — o gerçekten `syncRoot`'a bakmalı, çünkü o dosyaları Drive/Dropbox orada üretir.

- [ ] **Adım 4: Testleri çalıştır**

`npm test` → 96 + 2 = 98 test geçmeli.

- [ ] **Adım 5: Elle doğrula**

```bash
SB=$(mktemp -d); mkdir -p "$SB/home/.agent-sync/staged/shared" "$SB/drive" "$SB/proj"
cat > "$SB/home/.agent-sync/config.json" <<EOF
{ "syncRoot": "$SB/drive", "machineId": "macbook", "targets": [],
  "syncTranscripts": false, "snapshotKeep": 20 }
EOF
echo '{}' > "$SB/home/.agent-sync/staged/shared/settings-shared.conflict-macbook-20260813-0642.json"
( export HOME="$SB/home"; cd "$SB/proj" && node "$OLDPWD/bin/agent-sync.mjs" doctor )
rm -rf "$SB"
```

Beklenen: `WARN  unresolved sync conflicts: shared/settings-shared.conflict-macbook-...`

- [ ] **Adım 6: Commit**

```bash
git add src/doctor.mjs test/doctor.test.mjs
git commit -m "fix: look for conflict copies in the local trees, where they now live"
```

---

## Not: kontrol listesindeki yanlış pozitif

Bitirme listesindeki `git grep -niE "mertgungor|..."` komutu **kendi kendini buluyor** — desen bu belgenin içinde geçtiği için her zaman bir sonuç döner. Tek eşleşme bu satırsa sorun yoktur. Kodda gerçek sızıntı olup olmadığını şöyle bak:

```bash
git grep -niE "mertgungor|mert\.gng|mert\.protenis" -- src bin extension test
```

Beklenen: hiç sonuç yok.

---

## Bulgu 6 (ÖNEMLİ) — Testler kullanıcının gerçek ev dizinine yazıyor

**Durum:** Görev F doğru uygulandı, 98/98 test geçiyor. Ancak testlerin bir kısmı izole değil.

### Belirti

`npm test` çıktısında, sandbox olmayan gerçek bir yol siliniyor:

```
delete /var/folders/.../cs-sync-root-lFpJzA/shared/old.md      ← geçici, sorun yok
delete /Users/<kullanıcı>/.agent-sync/staged/shared/old.md      ← GERÇEK EV DİZİNİ
✔ forgetFile deletes targets in syncRoot and staged
```

Ve test koşulduktan sonra gerçek ev dizininde artıklar kalıyor:

```
~/.agent-sync/state.json
~/.agent-sync/snapshots/2026-…-172Z/test-src/a.md
~/.agent-sync/snapshots/2026-…-605Z/test-src/nested/b.md
```

### Etkilenen dosyalar

`HOME`'u izole etmeden `homeDir()` / `stagedDir()` yoluna yazan testler:

- `test/config.test.mjs`
- `test/manifest.test.mjs`
- `test/project.test.mjs`
- `test/sync-engine.test.mjs`
- `test/sync.test.mjs`

Yazma yolları: `takeSnapshot` (snapshot dizini), `saveState` (`state.json`), `saveConfig` (`config.json`), `ensureIdentity` (staged hafıza), `forgetFile` (**silme**).

### Neden önemli

Araç henüz gerçekten kurulmadığı için şu an zarar kozmetik. Kurulduktan sonra:

- **`state.json` eziliyor.** O dosya senkron motorunun karşılaştırma tabanıdır. Ezilirse bir sonraki sync her dosyayı "iki taraf da değişti" sanar → **toplu sahte çakışma**. Bulgu 1'in daha ağır hâli.
- **Snapshot rotasyonu** (son 20 tutulur) kullanıcının gerçek yedeklerini test çöpüyle tahliye eder — geri alma imkânı kaybolur.
- **`forgetFile` testi gerçek `staged/shared/old.md`'yi siler.** Silme, bu projede kasıtlı ve tek yönlü bir işlem; test onu tetiklememeli.

`scripts/smoke-test.sh` bu sorundan etkilenmez, orada `HOME` zaten izole. Aynı disiplin birim testlerinde yok.

---

### Görev G: Birim testleri izole bir `HOME` içinde koşsun

**Dosyalar:**
- Create: `test/helpers/isolated-home.mjs`
- Modify: `test/config.test.mjs`, `test/manifest.test.mjs`, `test/project.test.mjs`, `test/sync-engine.test.mjs`, `test/sync.test.mjs`

- [ ] **Adım 1: Önce kirliliği gör (kanıt adımı)**

```bash
find ~/.agent-sync -type f 2>/dev/null | sort > /tmp/before.txt
npm test > /dev/null 2>&1
find ~/.agent-sync -type f 2>/dev/null | sort > /tmp/after.txt
diff /tmp/before.txt /tmp/after.txt && echo "temiz" || echo "TESTLER GERÇEK EV DİZİNİNİ DEĞİŞTİRDİ"
```

`TESTLER GERÇEK EV DİZİNİNİ DEĞİŞTİRDİ` görmen gerekir. Görmeden devam etme — düzeltmenin işe yaradığını ancak buna karşı ölçebilirsin.

- [ ] **Adım 2: Yardımcıyı yaz**

`test/helpers/isolated-home.mjs`:

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Points HOME at a throwaway directory for the lifetime of this test process.
 * os.homedir() reads HOME on POSIX and USERPROFILE on Windows at call time, and
 * every agent-sync path helper is lazy, so this redirects ~/.agent-sync into the
 * sandbox. Without it, `npm test` overwrites the developer's real state.json and
 * evicts their real snapshots.
 *
 * Call it at module top level, before any test runs. node --test gives each file
 * its own process, so files cannot leak this into one another.
 */
export function useIsolatedHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sync-home-'));
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  return dir;
}
```

- [ ] **Adım 3: Etkilenen beş test dosyasına uygula**

Her birinde, import'ların hemen ardına ve ilk `test(...)` çağrısından önce:

```js
import { useIsolatedHome } from './helpers/isolated-home.mjs';

useIsolatedHome();
```

Testlerin gövdesine dokunma — hangi yolu doğruladıkları değişmiyor, yalnızca hangi ev dizinine düştükleri değişiyor.

- [ ] **Adım 4: Koruma testi ekle**

`test/sync.test.mjs` içine (ya da uygun gördüğün bir dosyaya) ekle:

```js
test('the suite runs against an isolated home, never the real one', () => {
  assert.match(process.env.HOME, /agent-sync-home-/);
});
```

- [ ] **Adım 5: Doğrula**

```bash
npm test
find ~/.agent-sync -type f 2>/dev/null | sort > /tmp/after2.txt
diff /tmp/before.txt /tmp/after2.txt && echo "OK: gerçek ev dizinine dokunulmadı" || echo "HÂLÂ KİRLETİYOR"
```

Beklenen: `OK: gerçek ev dizinine dokunulmadı`, ve `npm test` 98 + 1 = 99 test.

Ayrıca çıktıda artık `delete /Users/...` satırı **görünmemeli** — yalnızca geçici dizin yolları.

- [ ] **Adım 6: Commit**

```bash
git add test/helpers/isolated-home.mjs test/*.test.mjs
git commit -m "test: run the suite against an isolated HOME so it cannot touch real state"
```

### Bir de mevcut çöpü temizle

Önceki test koşuları gerçek ev dizininde artık bıraktı. `~/.agent-sync/` içinde `config.json` **yoksa** araç hiç kurulmamış demektir ve içindekilerin tamamı test çöpüdür:

```bash
ls ~/.agent-sync/config.json 2>/dev/null && echo "DUR: araç kurulmuş, elle incele" \
  || rm -rf ~/.agent-sync
```

`config.json` varsa **silme** — kullanıcının gerçek verisi olabilir, önce ona sor.
