# agent-sync — agent'lar için giriş

**Bu depoda çalışmaya başlamadan önce şunu oku: [`docs/superpowers/HANDOFF.md`](docs/superpowers/HANDOFF.md)**

Orada projenin ne olduğu, hangi task'ın bitip hangisinin kaldığı, nasıl devam edileceği ve daha önce verilmiş kararlar yazılı. Tek başına yeterlidir — kullanıcıya baştan anlattırma.

## 30 saniyelik özet

`agent-sync`, kodlama ajanlarının skill'lerini, hafızasını ve ayarlarını hem **makineler** (1 macOS + 2 Windows) hem **araçlar** (Claude Code, Codex, OpenCode, Gemini, Aider, Cursor) arasında senkronize eden, bağımlılıksız bir Node CLI aracıdır. Dosya yolu makineden makineye değişse bile aynı projeyi tanır.

Proje **plan güdümlü** ilerliyor: 16 task'ın tam kodu ve testleri `docs/superpowers/plans/2026-08-12-agent-sync.md` içinde hazır yazılı. Senden mimari icat etmen değil, planı uygulayıp doğrulaman bekleniyor.

## Uyulması zorunlu üç kural

1. **Sıfır runtime bağımlılığı.** Yalnızca Node yerleşik modülleri. `npm install` gerektiren hiçbir şey eklenmez.
2. **Kişisel veri yok.** Commit edilen hiçbir dosyada gerçek kullanıcı adı, e-posta veya mutlak makine yolu bulunmaz.
3. **Planla çeliştiğini düşündüğün yerde kendi kafana göre değiştirme** — kullanıcıya sor.

Test: `npm test` (Node >= 20 gerekli). Tam kısıt listesi HANDOFF'un 6. bölümünde.
