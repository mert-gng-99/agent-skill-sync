# Kaldığımız yer — 2026-08-12

## Durum: plan hazır, kod yazılmadı

Hiçbir implementer görevlendirilmedi, yani **yarım kalmış iş yok**. Temiz bir noktadayız: tasarım ve plan onaylandı ve commit edildi, sıra ilk task'ı yürütmeye gelmişti.

## Ne var elimizde

| Dosya | Ne |
|---|---|
| `docs/superpowers/specs/2026-08-12-agent-sync-design.md` | Tasarım: mimari, adapter katmanı, kimlik çözümleme, çakışma kuralları, 16 kabul kriteri |
| `docs/superpowers/plans/2026-08-12-agent-sync.md` | 16 task, her biri TDD adımlarıyla ve tam kodla |

Branch: `feat/implementation` (main'de sadece dokümanlar var).

## Devam etmek için

Yeni oturumda şunu söylemen yeterli:

> `superpowers:subagent-driven-development` ile `docs/superpowers/plans/2026-08-12-agent-sync.md` planını yürüt, Task 1'den başla

Ledger `.superpowers/sdd/2026-08-12-agent-sync/progress.md` altında (git'e girmiyor, makineye özel). İçinde hangi task'ın bittiği yazar; boşsa Task 1'den başlanır.

## Yürütme sırası

Task numaraları bağımlılık sırasıyla aynı — 1'den 16'ya doğru gidilir.

- **1–8 motor:** yol/slug, config, karar motoru, manifest+snapshot, uygulama katmanı, registry+kimlik, ayar merge, sır taraması+doctor
- **9–10 akış:** `src/sync.mjs`, proje bağlama
- **11–13 çok araçlılık:** digest render, 6 adapter, `run` sarmalayıcısı
- **14 CLI + kurulum**, **15 dağıtım (README/LICENSE)**, **16 VS Code extension**

Model seçimi: 1–8, 11, 13 tam kod içerdiği için ucuz tier; 9, 12, 14, 16 entegrasyon işi, orta tier; final review en güçlü model.

## Verilen kararlar (tekrar tartışmaya gerek yok)

| Konu | Karar |
|---|---|
| Transport | Google Drive — ama araç transport-agnostik, sadece bir `syncRoot` yolu ister |
| Mimari | Hook ile kopyalama (symlink/junction elendi: Windows sanal sürücü riski) |
| Proje kimliği | `.claude-project-id` marker + 4 adımlı çözümleme (marker → git remote → klasör adı → yeni id) |
| Tetikleme | Otomatik (VS Code extension birincil, Claude hook'ları opsiyonel) + manuel `agent-sync` komutu |
| Yerel durum | `~/.agent-sync/` — bilinçli olarak `~/.claude/` içinde değil, araç çok araçlı |
| Silme | Yayılmaz; kasıtlı silme `forget` komutuyla |
| Kapsam dışı | `~/.claude/plugins/` (1 GB cache), transcript'ler (Faz 2, varsayılan kapalı) |
| `syncRoot` içine git repo | **Konulmayacak** — iki makine eşzamanlı yazınca `.git` bozulur; geçmiş ihtiyacı snapshot'larla karşılanıyor |

## Yürütme öncesi düzeltilen iki plan çelişkisi

1. **Bağımlılık sırası:** CLI (`bin/agent-sync.mjs`) Task 9'daydı ama Task 10/12/13'ün modüllerini import ediyordu — çalıştırılamaz bir binary kalacaktı. CLI, Task 14'e taşındı; Task 9 artık sadece `src/sync.mjs` üretiyor.
2. **Global constraint:** "kodda `/` elle yazılmaz" kuralı, manifest'in bilerek POSIX ayracı kullanmasıyla çelişiyordu. Kural hassaslaştırıldı: `/` yalnızca *manifest anahtarı* olarak geçer, *disk yolu* olarak değil.

## Akılda tutulacak tek şey

Sistemin değerinin çoğu senkron mekanizmasında değil, **hafızanın gerçekten yazılmasında**. Tasarım anında `~/.claude/projects/-Users-mertgungor/memory/` klasörü boştu. Faz 0 (`<syncRoot>/CLAUDE.md` içine hafıza yazma politikası) bu yüzden var — atlanırsa sistem ölü doğar.
