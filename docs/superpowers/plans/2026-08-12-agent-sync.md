# agent-sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kodlama ajanlarının skill'lerini, kalıcı hafızasını ve paylaşılan ayarlarını hem birden fazla makine hem de birden fazla araç (Claude Code, Codex, OpenCode, Gemini CLI, Aider, Cursor) arasında, dosya yolları farklı olsa bile aynı projeyi tanıyacak şekilde senkronize eden bir CLI aracı.

**Architecture:** İki katman. **Motor** araçtan bağımsızdır: kullanıcının belirlediği `syncRoot` klasörü (Google Drive, OneDrive, Dropbox, Syncthing — araç bilmez) ile yerel `~/.agent-sync/staged/` arasında hash tabanlı mirror yapar; karar veren çekirdek saf fonksiyonlardan oluşur ve yan etkiler ayrı bir uygulama katmanında toplanır. **Adapter katmanı** ise `staged/`'deki kanonik markdown'ı her aracın okuduğu yere yazar (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, ...). Proje kimliği, proje kökündeki marker dosyası ve `registry.json` üzerinden 4 adımlı bir çözümleme ile belirlenir.

**Tech Stack:** Node.js (bağımlılıksız), `node:test` yerleşik test koşucusu, ESM (`.mjs`).

## Global Constraints

- **Node >= 20.** Yerleşik `node:test`, `node:fs/promises`, `node:crypto` kullanılır.
- **Sıfır runtime bağımlılığı.** `package.json`'da `dependencies` boş kalır. Araç dağıtılacağı için kurulum sürtünmesi sıfır olmalı.
- **Platformlar arası:** macOS, Linux, Windows. Yol birleştirme her zaman `node:path` ile; ev dizini her zaman `os.homedir()` ile. Kodda hiçbir yerde `/` veya `\` elle yazılmaz.
- **Kişisel veri yasak.** Commit edilen hiçbir dosyada gerçek kullanıcı adı, e-posta, mutlak yol veya hesap adı geçmez. Hepsi `config.json`'dan gelir; `config.json` ve `state.json` `.gitignore`'dadır.
- **Dil:** kod, kod yorumları ve CLI çıktısı İngilizce (araç uluslararası dağıtılacak). README iki dilli: Türkçe + İngilizce.
- **Hook'lar asla oturumu bloklamaz.** Hook yolundan çağrılan her giriş noktası her koşulda çıkış kodu 0 döner.
- **Silme yayılmaz.** Bir tarafta olmayan dosya, diğer tarafta varsa kopyalanır — asla silinmez. Kasıtlı silme yalnızca `forget` komutuyla.
- **Paylaşılan ayar anahtarları tam olarak şunlardır:** `enabledPlugins`, `extraKnownMarketplaces`, `model`, `effortLevel`. Bunlar Claude Code'a özgüdür ve yalnızca `claude` adapter'ını ilgilendirir.
- **Motor hiçbir aracı bilmez.** Motor modülleri (`sync-engine`, `manifest`, `apply`, `state`, `registry`, `identity`, `sync`) içinde hiçbir araç adı ve hiçbir araca özgü yol geçmez. Araca özgü her şey `src/adapters/` altındadır.
- **Adapter'lar kanonik depoya yazmaz.** Tek istisna `claude` adapter'ının geri beslemesidir, çünkü kullanıcı hafızayı Claude'un dizininde üretir.
- **Aracın kendi durumu `~/.agent-sync/` altındadır**, hiçbir ajanın dizininin içinde değil.

## File Structure

| Dosya | Sorumluluk |
|---|---|
| `bin/agent-sync.mjs` | CLI giriş noktası: argüman ayrıştırma, komut dispatch, çıkış kodu |
| `src/paths.mjs` | `~/.agent-sync/` yolları ve Claude Code slug hesabı |
| `src/config.mjs` | `config.json` yükleme/yazma, varsayılanlar, doğrulama (`targets` dahil) |
| `src/state.mjs` | SHA-256 hash'leme, `state.json` yükleme/yazma |
| `src/sync-engine.mjs` | **Saf karar fonksiyonu:** (local, remote, base) → aksiyon |
| `src/manifest.mjs` | Bir dizin ağacını tarayıp `Map<relPath, hash>` üretir |
| `src/snapshot.mjs` | Pull öncesi yerel yedek alma ve eski yedekleri budama |
| `src/apply.mjs` | Aksiyon planını diske uygular, çakışma dosyalarını adlandırır |
| `src/registry.mjs` | `registry.json` okuma/yazma/güncelleme |
| `src/identity.mjs` | 4 adımlı kimlik çözümleme (saf) |
| `src/settings-merge.mjs` | `settings.json` seçici merge ve paylaşılan anahtar çıkarımı |
| `src/secrets.mjs` | Sır kalıbı taraması |
| `src/doctor.mjs` | 5 sağlık kontrolü |
| `src/sync.mjs` | Motor akışı: manifest → plan → apply → state |
| `src/project.mjs` | Marker okuma/yazma, git exclude, `link`, `forget` |
| `src/render.mjs` | Hafıza dizinini tek markdown digest'ine derler; sınırlayıcılı blok yazımı |
| `src/adapters/index.mjs` | Adapter kaydı, `targets` filtresi, hedef yolu tekilleştirme |
| `src/adapters/claude.mjs` | Claude Code: dizin hafızası, `CLAUDE.md`, skills, settings merge, hook'lar |
| `src/adapters/agents-md.mjs` | `AGENTS.md` yazan ortak taban — `codex` ve `opencode` bunu kullanır |
| `src/adapters/simple.mjs` | Tek dosyaya yazan adapter'lar: `gemini`, `aider`, `cursor` |
| `src/run.mjs` | `run` sarmalayıcısı: pull → alt süreç → push |
| `src/init.mjs` | Etkileşimli kurulum: `syncRoot`, `machineId`, araç tespiti ve seçimi |
| `test/*.test.mjs` | Modül başına birim testleri |

Saf mantık (`sync-engine`, `identity`, `settings-merge`, `secrets`, `render`, `paths`) yan etkilerden ayrıldı; testlerin çoğu diske dokunmadan çalışır. Adapter'lar büyük ölçüde veri bildirimidir — bu yüzden "hepsini desteklemek" ile "birkaçını desteklemek" arasındaki maliyet farkı küçüktür; `simple.mjs` üç adapter'ı tek bir fabrika fonksiyonuyla üretir.

---

### Task 1: Proje iskeleti ve yol/slug modülü

Claude Code hafızayı `~/.claude/projects/<slug>/memory/` altında tutar ve slug'ı mutlak yoldan üretir. Araç bu kuralı birebir uygulamak zorunda — yanlış slug, Claude'un göremeyeceği bir yere yazmak demektir.

**Files:**
- Create: `package.json`
- Create: `src/paths.mjs`
- Test: `test/paths.test.mjs`

**Interfaces:**
- Consumes: yok (ilk task)
- Produces: `slugForPath(absPath) -> string`, `homeDir() -> string`, `stagedDir() -> string`, `stagedSkillsDir() -> string`, `stagedMemoryDir(projectId) -> string`, `stagedSharedDir() -> string`

- [ ] **Step 1: Write the failing test**

`test/paths.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugForPath } from '../src/paths.mjs';

test('replaces every non-alphanumeric character with a dash', () => {
  assert.equal(
    slugForPath('/Users/mert/Desktop/avukatsite'),
    '-Users-mert-Desktop-avukatsite'
  );
});

test('collapses dots and at-signs in cloud storage paths', () => {
  assert.equal(
    slugForPath('/Users/mert/Library/CloudStorage/GoogleDrive-a.b@gmail.com/x'),
    '-Users-mert-Library-CloudStorage-GoogleDrive-a-b-gmail-com-x'
  );
});

test('turns non-ascii letters into dashes, not omissions', () => {
  // Observed from a real Claude Code install: "Drive'ım" becomes "Drive--m"
  assert.equal(slugForPath("/Drive'ım"), '-Drive--m');
});

test('handles windows drive letters', () => {
  assert.equal(slugForPath('C:\\Users\\mert\\Desktop\\app'), 'C--Users-mert-Desktop-app');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/paths.test.mjs`
Expected: FAIL — `Cannot find module '../src/paths.mjs'`

- [ ] **Step 3: Write minimal implementation**

`package.json`:

```json
{
  "name": "agent-sync",
  "version": "0.1.0",
  "description": "Sync coding-agent skills, memory and settings across machines and tools - path independent",
  "type": "module",
  "bin": { "agent-sync": "bin/agent-sync.mjs" },
  "engines": { "node": ">=20" },
  "scripts": { "test": "node --test test/" },
  "license": "MIT"
}
```

`src/paths.mjs`:

```js
import os from 'node:os';
import path from 'node:path';

/**
 * Reproduces Claude Code's project directory encoding: every character that is
 * not an ASCII alphanumeric becomes a dash. Verified against a live install.
 * Lives here rather than in the claude adapter because the local slug is also
 * how the engine addresses per-project state.
 */
export function slugForPath(absPath) {
  return absPath.replace(/[^a-zA-Z0-9]/g, '-');
}

/** agent-sync's own directory. Never inside any single agent's folder. */
export function homeDir() {
  return path.join(os.homedir(), '.agent-sync');
}

/** Local mirror of syncRoot. Adapters read from here; nothing else writes it. */
export function stagedDir() {
  return path.join(homeDir(), 'staged');
}

export function stagedSkillsDir() {
  return path.join(stagedDir(), 'skills');
}

export function stagedMemoryDir(projectId) {
  return path.join(stagedDir(), 'memory', projectId);
}

export function stagedSharedDir() {
  return path.join(stagedDir(), 'shared');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/paths.test.mjs`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add package.json src/paths.mjs test/paths.test.mjs
git commit -m "feat: add path resolution and Claude Code slug encoding"
```

---

### Task 2: Config modülü

**Files:**
- Create: `src/config.mjs`
- Test: `test/config.test.mjs`

**Interfaces:**
- Consumes: `homeDir()` from `src/paths.mjs`
- Produces: `DEFAULT_CONFIG`, `validateConfig(obj) -> {ok: boolean, errors: string[]}`, `loadConfig() -> Promise<config>`, `saveConfig(config) -> Promise<void>`, `configPath() -> string`

- [ ] **Step 1: Write the failing test**

`test/config.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, validateConfig } from '../src/config.mjs';

test('defaults keep transcripts off and retain 20 snapshots', () => {
  assert.equal(DEFAULT_CONFIG.syncTranscripts, false);
  assert.equal(DEFAULT_CONFIG.snapshotKeep, 20);
});

test('rejects a config without syncRoot', () => {
  const r = validateConfig({ machineId: 'macbook' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('syncRoot')));
});

test('rejects a machineId that would break conflict filenames', () => {
  const r = validateConfig({ syncRoot: '/x', machineId: 'my machine/1' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('machineId')));
});

test('rejects an unknown target id', () => {
  const r = validateConfig({ syncRoot: '/x', machineId: 'macbook', targets: ['emacs'] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('emacs')));
});

test('an empty target list is valid - sync still runs, nothing is written to tools', () => {
  assert.equal(validateConfig({ syncRoot: '/x', machineId: 'macbook', targets: [] }).ok, true);
});

test('accepts a valid config', () => {
  assert.deepEqual(
    validateConfig({ syncRoot: '/x', machineId: 'macbook', targets: ['claude', 'codex'] }),
    { ok: true, errors: [] }
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/config.test.mjs`
Expected: FAIL — `Cannot find module '../src/config.mjs'`

- [ ] **Step 3: Write minimal implementation**

`src/config.mjs`:

```js
import fs from 'node:fs/promises';
import path from 'node:path';
import { homeDir } from './paths.mjs';

/**
 * Every adapter that exists. Kept here rather than imported from the adapter
 * registry so that config validation stays free of side effects.
 */
export const KNOWN_TARGETS = ['claude', 'codex', 'opencode', 'gemini', 'aider', 'cursor'];

export const DEFAULT_CONFIG = {
  syncRoot: '',
  machineId: '',
  targets: [],
  syncTranscripts: false,
  snapshotKeep: 20,
};

export function configPath() {
  return path.join(homeDir(), 'config.json');
}

export function validateConfig(obj) {
  const errors = [];
  if (!obj || typeof obj.syncRoot !== 'string' || obj.syncRoot.trim() === '') {
    errors.push('syncRoot is required and must be a non-empty path');
  }
  // machineId lands inside conflict filenames, so keep it filesystem-safe.
  if (!obj || typeof obj.machineId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(obj.machineId)) {
    errors.push('machineId must contain only letters, digits, dash or underscore');
  }
  const targets = obj?.targets ?? [];
  if (!Array.isArray(targets)) {
    errors.push('targets must be an array');
  } else {
    for (const t of targets) {
      if (!KNOWN_TARGETS.includes(t)) errors.push(`unknown target: ${t}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export async function loadConfig() {
  const raw = await fs.readFile(configPath(), 'utf8');
  const config = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  const { ok, errors } = validateConfig(config);
  if (!ok) throw new Error(`Invalid config at ${configPath()}: ${errors.join('; ')}`);
  return config;
}

export async function saveConfig(config) {
  await fs.mkdir(homeDir(), { recursive: true });
  await fs.writeFile(configPath(), JSON.stringify(config, null, 2) + '\n', 'utf8');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/config.test.mjs`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/config.mjs test/config.test.mjs
git commit -m "feat: add machine-local config with validation"
```

---

### Task 3: Senkron karar motoru

Sistemin kalbi. Tamamen saf: üç hash alır, ne yapılacağını söyler. "Silme yayılmaz" kuralı burada kodlanır.

**Files:**
- Create: `src/state.mjs`
- Create: `src/sync-engine.mjs`
- Test: `test/sync-engine.test.mjs`

**Interfaces:**
- Consumes: `homeDir()` from `src/paths.mjs`
- Produces: `hashContent(buffer) -> string`, `loadState() -> Promise<{version, files}>`, `saveState(state) -> Promise<void>`, `ACTION` enum, `decide({localHash, remoteHash, baseHash}) -> string`, `buildPlan(localMap, remoteMap, baseFiles) -> Array<{relPath, action}>`

- [ ] **Step 1: Write the failing test**

`test/sync-engine.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTION, decide, buildPlan } from '../src/sync-engine.mjs';

test('identical sides do nothing', () => {
  assert.equal(decide({ localHash: 'a', remoteHash: 'a', baseHash: 'a' }), ACTION.SKIP);
});

test('local edited alone is pushed', () => {
  assert.equal(decide({ localHash: 'b', remoteHash: 'a', baseHash: 'a' }), ACTION.PUSH);
});

test('remote edited alone is pulled', () => {
  assert.equal(decide({ localHash: 'a', remoteHash: 'b', baseHash: 'a' }), ACTION.PULL);
});

test('both edited differently is a conflict', () => {
  assert.equal(decide({ localHash: 'b', remoteHash: 'c', baseHash: 'a' }), ACTION.CONFLICT);
});

test('both edited to the same content is not a conflict', () => {
  assert.equal(decide({ localHash: 'b', remoteHash: 'b', baseHash: 'a' }), ACTION.SKIP);
});

test('a brand new local file is pushed', () => {
  assert.equal(decide({ localHash: 'a', remoteHash: null, baseHash: null }), ACTION.PUSH);
});

test('a brand new remote file is pulled', () => {
  assert.equal(decide({ localHash: null, remoteHash: 'a', baseHash: null }), ACTION.PULL);
});

test('deletion does not propagate: locally deleted file comes back', () => {
  assert.equal(decide({ localHash: null, remoteHash: 'a', baseHash: 'a' }), ACTION.PULL);
});

test('deletion does not propagate: remotely deleted file is restored', () => {
  assert.equal(decide({ localHash: 'a', remoteHash: null, baseHash: 'a' }), ACTION.PUSH);
});

test('buildPlan covers the union of both sides and skips no-ops', () => {
  const local = new Map([['a.md', 'h1'], ['b.md', 'h2']]);
  const remote = new Map([['a.md', 'h1'], ['c.md', 'h3']]);
  const plan = buildPlan(local, remote, { 'a.md': 'h1' });
  const byPath = Object.fromEntries(plan.map((p) => [p.relPath, p.action]));
  assert.equal(byPath['a.md'], undefined); // skipped, not listed
  assert.equal(byPath['b.md'], ACTION.PUSH);
  assert.equal(byPath['c.md'], ACTION.PULL);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sync-engine.test.mjs`
Expected: FAIL — `Cannot find module '../src/sync-engine.mjs'`

- [ ] **Step 3: Write minimal implementation**

`src/state.mjs`:

```js
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { homeDir } from './paths.mjs';

const EMPTY_STATE = { version: 1, files: {} };

export function hashContent(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function statePath() {
  return path.join(homeDir(), 'state.json');
}

export async function loadState() {
  try {
    return { ...EMPTY_STATE, ...JSON.parse(await fs.readFile(statePath(), 'utf8')) };
  } catch {
    // No state yet, or unreadable: treat every file as new rather than failing.
    return { ...EMPTY_STATE, files: {} };
  }
}

export async function saveState(state) {
  await fs.mkdir(homeDir(), { recursive: true });
  await fs.writeFile(statePath(), JSON.stringify(state, null, 2) + '\n', 'utf8');
}
```

`src/sync-engine.mjs`:

```js
export const ACTION = {
  SKIP: 'skip',
  PUSH: 'push',
  PULL: 'pull',
  CONFLICT: 'conflict',
};

/**
 * Pure three-way decision. `null` means the file is absent on that side.
 * Deletions are deliberately never propagated: an absent side loses to a
 * present one, so a file removed on one machine is restored from the other.
 */
export function decide({ localHash, remoteHash, baseHash }) {
  if (localHash === remoteHash) return ACTION.SKIP;
  if (localHash === null) return ACTION.PULL;
  if (remoteHash === null) return ACTION.PUSH;
  if (remoteHash === baseHash) return ACTION.PUSH;
  if (localHash === baseHash) return ACTION.PULL;
  return ACTION.CONFLICT;
}

export function buildPlan(localMap, remoteMap, baseFiles) {
  const relPaths = new Set([...localMap.keys(), ...remoteMap.keys()]);
  const plan = [];
  for (const relPath of [...relPaths].sort()) {
    const action = decide({
      localHash: localMap.get(relPath) ?? null,
      remoteHash: remoteMap.get(relPath) ?? null,
      baseHash: baseFiles[relPath] ?? null,
    });
    if (action !== ACTION.SKIP) plan.push({ relPath, action });
  }
  return plan;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sync-engine.test.mjs`
Expected: PASS — 10 tests

- [ ] **Step 5: Commit**

```bash
git add src/state.mjs src/sync-engine.mjs test/sync-engine.test.mjs
git commit -m "feat: add pure three-way sync decision engine"
```

---

### Task 4: Manifest tarayıcı ve snapshot

**Files:**
- Create: `src/manifest.mjs`
- Create: `src/snapshot.mjs`
- Test: `test/manifest.test.mjs`

**Interfaces:**
- Consumes: `hashContent()` from `src/state.mjs`; `homeDir()` from `src/paths.mjs`
- Produces: `IGNORED_NAMES`, `collectManifest(rootDir) -> Promise<Map<relPath, hash>>`, `takeSnapshot(pairs, snapshotKeep) -> Promise<string>` (returns snapshot dir path)

- [ ] **Step 1: Write the failing test**

`test/manifest.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectManifest } from '../src/manifest.mjs';

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-manifest-'));
  await fs.mkdir(path.join(dir, 'nested'), { recursive: true });
  await fs.writeFile(path.join(dir, 'a.md'), 'hello');
  await fs.writeFile(path.join(dir, 'nested', 'b.md'), 'world');
  await fs.writeFile(path.join(dir, '.DS_Store'), 'junk');
  await fs.writeFile(path.join(dir, 'state.json'), '{}');
  return dir;
}

test('walks nested files and hashes them', async () => {
  const dir = await fixture();
  const m = await collectManifest(dir);
  assert.deepEqual([...m.keys()].sort(), ['a.md', 'nested/b.md']);
  assert.match(m.get('a.md'), /^[a-f0-9]{64}$/);
});

test('identical content in different files hashes the same', async () => {
  const dir = await fixture();
  await fs.writeFile(path.join(dir, 'copy.md'), 'hello');
  const m = await collectManifest(dir);
  assert.equal(m.get('copy.md'), m.get('a.md'));
});

test('missing directory yields an empty manifest instead of throwing', async () => {
  const m = await collectManifest(path.join(os.tmpdir(), 'cs-does-not-exist-12345'));
  assert.equal(m.size, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/manifest.test.mjs`
Expected: FAIL — `Cannot find module '../src/manifest.mjs'`

- [ ] **Step 3: Write minimal implementation**

`src/manifest.mjs`:

```js
import fs from 'node:fs/promises';
import path from 'node:path';
import { hashContent } from './state.mjs';

export const IGNORED_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'state.json', 'config.json']);

/**
 * Returns a map of POSIX-style relative path -> content hash. Relative paths
 * always use forward slashes so a manifest is comparable across platforms.
 */
export async function collectManifest(rootDir) {
  const out = new Map();
  async function walk(dir, prefix) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // Missing or unreadable directory is an empty manifest.
    }
    for (const entry of entries) {
      if (IGNORED_NAMES.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(abs, rel);
      } else if (entry.isFile()) {
        out.set(rel, hashContent(await fs.readFile(abs)));
      }
    }
  }
  await walk(rootDir, '');
  return out;
}
```

`src/snapshot.mjs`:

```js
import fs from 'node:fs/promises';
import path from 'node:path';
import { homeDir } from './paths.mjs';

function stamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

/**
 * Copies the given local directories into a timestamped snapshot before a pull
 * overwrites anything, then prunes all but the newest `snapshotKeep` snapshots.
 * `pairs` is an array of { name, dir }.
 */
export async function takeSnapshot(pairs, snapshotKeep) {
  const root = path.join(homeDir(), 'snapshots');
  const target = path.join(root, stamp());
  for (const { name, dir } of pairs) {
    try {
      await fs.cp(dir, path.join(target, name), { recursive: true });
    } catch {
      // A source that does not exist yet simply has nothing to back up.
    }
  }
  const existing = (await fs.readdir(root).catch(() => [])).sort();
  for (const old of existing.slice(0, Math.max(0, existing.length - snapshotKeep))) {
    await fs.rm(path.join(root, old), { recursive: true, force: true });
  }
  return target;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/manifest.test.mjs`
Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/manifest.mjs src/snapshot.mjs test/manifest.test.mjs
git commit -m "feat: add manifest scanner and pre-pull snapshots"
```

---

### Task 5: Uygulama katmanı

Planı diske yazar. Çakışmada hiçbir içerik kaybolmaz: uzak sürüm kanonik adı alır, yerel sürüm yanına makine damgalı bir adla kaydedilir.

**Files:**
- Create: `src/apply.mjs`
- Test: `test/apply.test.mjs`

**Interfaces:**
- Consumes: `ACTION` from `src/sync-engine.mjs`; `hashContent()` from `src/state.mjs`
- Produces: `conflictName(relPath, machineId, date) -> string`, `applyPlan(plan, {localRoot, remoteRoot, machineId, dryRun}) -> Promise<{applied: Array, conflicts: Array}>`

- [ ] **Step 1: Write the failing test**

`test/apply.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ACTION } from '../src/sync-engine.mjs';
import { conflictName, applyPlan } from '../src/apply.mjs';

test('conflict filename keeps the extension and stamps the machine', () => {
  const name = conflictName('memory/x/note.md', 'macbook', new Date('2026-08-12T09:30:00Z'));
  assert.equal(name, 'memory/x/note.conflict-macbook-20260812-0930.md');
});

test('conflict filename handles files without an extension', () => {
  const name = conflictName('LICENSE', 'pc', new Date('2026-08-12T09:30:00Z'));
  assert.equal(name, 'LICENSE.conflict-pc-20260812-0930');
});

async function roots() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-apply-'));
  const localRoot = path.join(base, 'local');
  const remoteRoot = path.join(base, 'remote');
  await fs.mkdir(localRoot, { recursive: true });
  await fs.mkdir(remoteRoot, { recursive: true });
  return { localRoot, remoteRoot };
}

test('push copies local to remote, creating parent directories', async () => {
  const { localRoot, remoteRoot } = await roots();
  await fs.mkdir(path.join(localRoot, 'deep'), { recursive: true });
  await fs.writeFile(path.join(localRoot, 'deep', 'a.md'), 'local');
  await applyPlan([{ relPath: 'deep/a.md', action: ACTION.PUSH }], {
    localRoot, remoteRoot, machineId: 'macbook', dryRun: false,
  });
  assert.equal(await fs.readFile(path.join(remoteRoot, 'deep', 'a.md'), 'utf8'), 'local');
});

test('conflict preserves both sides', async () => {
  const { localRoot, remoteRoot } = await roots();
  await fs.writeFile(path.join(localRoot, 'n.md'), 'mine');
  await fs.writeFile(path.join(remoteRoot, 'n.md'), 'theirs');
  const res = await applyPlan([{ relPath: 'n.md', action: ACTION.CONFLICT }], {
    localRoot, remoteRoot, machineId: 'macbook', dryRun: false,
  });
  assert.equal(await fs.readFile(path.join(localRoot, 'n.md'), 'utf8'), 'theirs');
  const kept = res.conflicts[0].keptAs;
  assert.equal(await fs.readFile(path.join(localRoot, kept), 'utf8'), 'mine');
});

test('dryRun touches nothing', async () => {
  const { localRoot, remoteRoot } = await roots();
  await fs.writeFile(path.join(localRoot, 'a.md'), 'local');
  await applyPlan([{ relPath: 'a.md', action: ACTION.PUSH }], {
    localRoot, remoteRoot, machineId: 'macbook', dryRun: true,
  });
  await assert.rejects(() => fs.readFile(path.join(remoteRoot, 'a.md')));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/apply.test.mjs`
Expected: FAIL — `Cannot find module '../src/apply.mjs'`

- [ ] **Step 3: Write minimal implementation**

`src/apply.mjs`:

```js
import fs from 'node:fs/promises';
import path from 'node:path';
import { ACTION } from './sync-engine.mjs';
import { hashContent } from './state.mjs';

function pad(n) {
  return String(n).padStart(2, '0');
}

export function conflictName(relPath, machineId, date) {
  const stamp =
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
  const ext = path.posix.extname(relPath);
  const stem = ext ? relPath.slice(0, -ext.length) : relPath;
  return `${stem}.conflict-${machineId}-${stamp}${ext}`;
}

async function copy(fromRoot, toRoot, relPath) {
  const src = path.join(fromRoot, ...relPath.split('/'));
  const dest = path.join(toRoot, ...relPath.split('/'));
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const data = await fs.readFile(src);
  await fs.writeFile(dest, data);
  return hashContent(data);
}

/**
 * Executes a plan. Returns the hash of every settled file so the caller can
 * write it into state.json, plus the list of conflicts for reporting.
 */
export async function applyPlan(plan, { localRoot, remoteRoot, machineId, dryRun }) {
  const applied = [];
  const conflicts = [];
  for (const { relPath, action } of plan) {
    if (dryRun) {
      if (action === ACTION.CONFLICT) conflicts.push({ relPath, keptAs: null });
      else applied.push({ relPath, action, hash: null });
      continue;
    }
    if (action === ACTION.PUSH) {
      applied.push({ relPath, action, hash: await copy(localRoot, remoteRoot, relPath) });
    } else if (action === ACTION.PULL) {
      applied.push({ relPath, action, hash: await copy(remoteRoot, localRoot, relPath) });
    } else if (action === ACTION.CONFLICT) {
      // Keep the local version under a stamped name, then let remote take the
      // canonical path. Nothing is ever discarded.
      const keptAs = conflictName(relPath, machineId, new Date());
      const mine = await fs.readFile(path.join(localRoot, ...relPath.split('/')));
      const keptPath = path.join(localRoot, ...keptAs.split('/'));
      await fs.mkdir(path.dirname(keptPath), { recursive: true });
      await fs.writeFile(keptPath, mine);
      const hash = await copy(remoteRoot, localRoot, relPath);
      applied.push({ relPath, action, hash });
      conflicts.push({ relPath, keptAs });
    }
  }
  return { applied, conflicts };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/apply.test.mjs`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/apply.mjs test/apply.test.mjs
git commit -m "feat: apply sync plans with non-destructive conflict handling"
```

---

### Task 6: Registry ve kimlik çözümleme

Tasarımın çekirdek problemi: yol değişse de aynı projeyi tanımak.

**Files:**
- Create: `src/registry.mjs`
- Create: `src/identity.mjs`
- Test: `test/identity.test.mjs`

**Interfaces:**
- Consumes: yok (bağımsız)
- Produces: `loadRegistry(syncRoot) -> Promise<registry>`, `saveRegistry(syncRoot, reg) -> Promise<void>`, `upsertProject(reg, {id, name, gitRemote, machineId, absPath}) -> registry`, `MARKER_FILENAME`, `newProjectId(name) -> string`, `resolveIdentity({folderName, marker, gitRemote, registry}) -> {id, source, ambiguous}`

- [ ] **Step 1: Write the failing test**

`test/identity.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveIdentity, newProjectId } from '../src/identity.mjs';
import { upsertProject } from '../src/registry.mjs';

const registry = {
  version: 1,
  projects: {
    'avukatsite-7f3a9c': {
      name: 'avukatsite',
      gitRemote: 'https://github.com/u/avukatsite.git',
      paths: {},
    },
    'site-111111': { name: 'site', paths: {} },
    'site-222222': { name: 'site', paths: {} },
  },
};

test('an existing marker wins over everything else', () => {
  const r = resolveIdentity({ folderName: 'anything', marker: 'avukatsite-7f3a9c', gitRemote: null, registry });
  assert.deepEqual(r, { id: 'avukatsite-7f3a9c', source: 'marker', ambiguous: false });
});

test('git remote links a differently-located clone to the same project', () => {
  const r = resolveIdentity({
    folderName: 'avukatsite-copy',
    marker: null,
    gitRemote: 'https://github.com/u/avukatsite.git',
    registry,
  });
  assert.deepEqual(r, { id: 'avukatsite-7f3a9c', source: 'gitRemote', ambiguous: false });
});

test('a unique folder name links the project on a second machine', () => {
  const r = resolveIdentity({ folderName: 'avukatsite', marker: null, gitRemote: null, registry });
  assert.deepEqual(r, { id: 'avukatsite-7f3a9c', source: 'folderName', ambiguous: false });
});

test('an ambiguous folder name creates a new id and flags it', () => {
  const r = resolveIdentity({ folderName: 'site', marker: null, gitRemote: null, registry });
  assert.equal(r.source, 'new');
  assert.equal(r.ambiguous, true);
  assert.match(r.id, /^site-[a-f0-9]{6}$/);
});

test('an unknown project gets a fresh id without being flagged', () => {
  const r = resolveIdentity({ folderName: 'brandnew', marker: null, gitRemote: null, registry });
  assert.equal(r.source, 'new');
  assert.equal(r.ambiguous, false);
});

test('generated ids are filesystem safe', () => {
  assert.match(newProjectId("Drive'ım Projesi"), /^drive-m-projesi-[a-f0-9]{6}$/);
});

test('upsertProject records this machine path without dropping the others', () => {
  const reg = upsertProject(
    { version: 1, projects: { x: { name: 'x', paths: { pc: 'C:\\x' } } } },
    { id: 'x', name: 'x', gitRemote: null, machineId: 'macbook', absPath: '/x' }
  );
  assert.deepEqual(reg.projects.x.paths, { pc: 'C:\\x', macbook: '/x' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/identity.test.mjs`
Expected: FAIL — `Cannot find module '../src/identity.mjs'`

- [ ] **Step 3: Write minimal implementation**

`src/registry.mjs`:

```js
import fs from 'node:fs/promises';
import path from 'node:path';

const EMPTY_REGISTRY = { version: 1, projects: {} };

export function registryPath(syncRoot) {
  return path.join(syncRoot, 'registry.json');
}

export async function loadRegistry(syncRoot) {
  try {
    const parsed = JSON.parse(await fs.readFile(registryPath(syncRoot), 'utf8'));
    return { ...EMPTY_REGISTRY, ...parsed, projects: parsed.projects ?? {} };
  } catch {
    return { version: 1, projects: {} };
  }
}

export async function saveRegistry(syncRoot, reg) {
  await fs.mkdir(syncRoot, { recursive: true });
  await fs.writeFile(registryPath(syncRoot), JSON.stringify(reg, null, 2) + '\n', 'utf8');
}

export function upsertProject(reg, { id, name, gitRemote, machineId, absPath }) {
  const existing = reg.projects[id] ?? { name, paths: {} };
  reg.projects[id] = {
    ...existing,
    name: existing.name ?? name,
    ...(gitRemote ? { gitRemote } : {}),
    paths: { ...existing.paths, [machineId]: absPath },
    lastSeen: new Date().toISOString(),
  };
  return reg;
}
```

`src/identity.mjs`:

```js
import crypto from 'node:crypto';

export const MARKER_FILENAME = '.claude-project-id';

export function newProjectId(name) {
  const stem = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
  return `${stem}-${crypto.randomBytes(3).toString('hex')}`;
}

/**
 * Four-step resolution, in priority order:
 *   1. marker file in the project root
 *   2. git remote URL matching a registry entry
 *   3. folder name matching exactly one registry entry
 *   4. otherwise a new id; `ambiguous` marks the case where the folder name
 *      matched several projects, so doctor can ask the user to sort it out.
 */
export function resolveIdentity({ folderName, marker, gitRemote, registry }) {
  const entries = Object.entries(registry.projects ?? {});

  if (marker && registry.projects?.[marker]) {
    return { id: marker, source: 'marker', ambiguous: false };
  }
  if (marker) return { id: marker, source: 'marker', ambiguous: false };

  if (gitRemote) {
    const hit = entries.find(([, p]) => p.gitRemote === gitRemote);
    if (hit) return { id: hit[0], source: 'gitRemote', ambiguous: false };
  }

  const byName = entries.filter(([, p]) => p.name === folderName);
  if (byName.length === 1) return { id: byName[0][0], source: 'folderName', ambiguous: false };

  return { id: newProjectId(folderName), source: 'new', ambiguous: byName.length > 1 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/identity.test.mjs`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add src/registry.mjs src/identity.mjs test/identity.test.mjs
git commit -m "feat: add path-independent project identity resolution"
```

---

### Task 7: settings.json seçici merge

Tüm dosya kopyalanmaz — içinde makineye özel izinler, env değişkenleri ve hook tanımları vardır.

**Files:**
- Create: `src/settings-merge.mjs`
- Test: `test/settings-merge.test.mjs`

**Interfaces:**
- Consumes: yok
- Produces: `SHARED_KEYS`, `extractShared(localSettings) -> object`, `mergeShared(localSettings, sharedSettings) -> object`

- [ ] **Step 1: Write the failing test**

`test/settings-merge.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHARED_KEYS, extractShared, mergeShared } from '../src/settings-merge.mjs';

test('shares exactly the four agreed keys', () => {
  assert.deepEqual(SHARED_KEYS, ['enabledPlugins', 'extraKnownMarketplaces', 'model', 'effortLevel']);
});

test('extract picks up only shared keys that are present', () => {
  const out = extractShared({ model: 'opus', hooks: { Stop: [] }, permissions: { allow: [] } });
  assert.deepEqual(out, { model: 'opus' });
});

test('merge never clobbers machine-local keys', () => {
  const local = { model: 'sonnet', hooks: { Stop: ['x'] }, permissions: { allow: ['a'] } };
  const merged = mergeShared(local, { model: 'opus', effortLevel: 'xhigh' });
  assert.deepEqual(merged, {
    model: 'opus',
    effortLevel: 'xhigh',
    hooks: { Stop: ['x'] },
    permissions: { allow: ['a'] },
  });
});

test('merge does not mutate its input', () => {
  const local = { model: 'sonnet' };
  mergeShared(local, { model: 'opus' });
  assert.equal(local.model, 'sonnet');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/settings-merge.test.mjs`
Expected: FAIL — `Cannot find module '../src/settings-merge.mjs'`

- [ ] **Step 3: Write minimal implementation**

`src/settings-merge.mjs`:

```js
export const SHARED_KEYS = ['enabledPlugins', 'extraKnownMarketplaces', 'model', 'effortLevel'];

export function extractShared(localSettings) {
  const out = {};
  for (const key of SHARED_KEYS) {
    if (localSettings?.[key] !== undefined) out[key] = localSettings[key];
  }
  return out;
}

/**
 * Overlays the shared keys onto local settings. Every other field - hooks,
 * permissions, env - belongs to this machine and is left untouched.
 */
export function mergeShared(localSettings, sharedSettings) {
  const merged = { ...localSettings };
  for (const key of SHARED_KEYS) {
    if (sharedSettings?.[key] !== undefined) merged[key] = sharedSettings[key];
  }
  return merged;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/settings-merge.test.mjs`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/settings-merge.mjs test/settings-merge.test.mjs
git commit -m "feat: merge only shared settings keys, preserving machine-local ones"
```

---

### Task 8: Sır taraması ve doctor

**Files:**
- Create: `src/secrets.mjs`
- Create: `src/doctor.mjs`
- Test: `test/secrets.test.mjs`

**Interfaces:**
- Consumes: `collectManifest()` from `src/manifest.mjs`; `loadRegistry()` from `src/registry.mjs`
- Produces: `scanForSecrets(text) -> Array<{line: number, kind: string}>`, `findProviderConflictArtifacts(names) -> string[]`, `runDoctor(ctx) -> Promise<Array<{name, status, details}>>`

- [ ] **Step 1: Write the failing test**

`test/secrets.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanForSecrets, findProviderConflictArtifacts } from '../src/secrets.mjs';

test('flags an anthropic style key', () => {
  const hits = scanForSecrets('note\nAPI key: sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 2);
});

test('flags aws access key ids and github tokens', () => {
  assert.equal(scanForSecrets('AKIAIOSFODNN7EXAMPLE').length, 1);
  assert.equal(scanForSecrets('ghp_0123456789abcdef0123456789abcdef0123').length, 1);
});

test('flags assignments to secret-looking variables', () => {
  assert.equal(scanForSecrets('DATABASE_PASSWORD="hunter2hunter2"').length, 1);
});

test('does not flag ordinary prose', () => {
  assert.deepEqual(scanForSecrets('We decided to use the API for auth.\nNo secrets here.'), []);
});

test('detects cloud provider conflict artifacts', () => {
  const found = findProviderConflictArtifacts([
    'note.md',
    'note (1).md',
    "note (mert's conflicted copy 2026-08-12).md",
    'note-DESKTOP-ABC123.md',
  ]);
  assert.equal(found.length, 3);
  assert.ok(!found.includes('note.md'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/secrets.test.mjs`
Expected: FAIL — `Cannot find module '../src/secrets.mjs'`

- [ ] **Step 3: Write minimal implementation**

`src/secrets.mjs`:

```js
const PATTERNS = [
  { kind: 'anthropic-key', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { kind: 'openai-key', re: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { kind: 'aws-access-key-id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { kind: 'private-key-block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { kind: 'secret-assignment', re: /\b\w*(PASSWORD|SECRET|TOKEN|API_?KEY)\w*\s*[:=]\s*["']?\S{8,}/i },
];

const PROVIDER_CONFLICT_PATTERNS = [
  /\(\d+\)\.[^.]+$/, //  "note (1).md"        - Google Drive
  /conflicted copy/i, //  Dropbox / iCloud
  /-[A-Z0-9]{6,}\.[^.]+$/, //  "note-DESKTOP-ABC123.md" - OneDrive
];

export function scanForSecrets(text) {
  const hits = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const { kind, re } of PATTERNS) {
      if (re.test(line)) {
        hits.push({ line: i + 1, kind });
        break; // One finding per line is enough to warn the user.
      }
    }
  });
  return hits;
}

export function findProviderConflictArtifacts(names) {
  return names.filter((n) => PROVIDER_CONFLICT_PATTERNS.some((re) => re.test(n)));
}
```

`src/doctor.mjs`:

```js
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectManifest } from './manifest.mjs';
import { loadRegistry } from './registry.mjs';
import { scanForSecrets, findProviderConflictArtifacts } from './secrets.mjs';

const OK = 'ok';
const WARN = 'warn';
const FAIL = 'fail';

export async function runDoctor({ syncRoot, localRoots }) {
  const checks = [];

  // 1. Is syncRoot reachable and writable?
  try {
    await fs.mkdir(syncRoot, { recursive: true });
    const probe = path.join(syncRoot, '.agent-sync-write-probe');
    await fs.writeFile(probe, 'ok');
    await fs.rm(probe);
    checks.push({ name: 'syncRoot writable', status: OK, details: syncRoot });
  } catch (err) {
    checks.push({ name: 'syncRoot writable', status: FAIL, details: err.message });
    return checks; // Nothing else can be checked without the sync root.
  }

  const remote = await collectManifest(syncRoot);
  const names = [...remote.keys()];

  // 2. Cloud provider conflict artifacts.
  const artifacts = findProviderConflictArtifacts(names);
  checks.push({
    name: 'cloud provider conflict copies',
    status: artifacts.length ? WARN : OK,
    details: artifacts.join(', ') || 'none',
  });

  // 3. Our own conflict files awaiting resolution.
  const ours = names.filter((n) => n.includes('.conflict-'));
  checks.push({
    name: 'unresolved sync conflicts',
    status: ours.length ? WARN : OK,
    details: ours.join(', ') || 'none',
  });

  // 4. Registry consistency: memory folders with no registry entry.
  const registry = await loadRegistry(syncRoot);
  const known = new Set(Object.keys(registry.projects));
  const memoryDirs = new Set(
    names.filter((n) => n.startsWith('memory/')).map((n) => n.split('/')[1])
  );
  const orphans = [...memoryDirs].filter((d) => d !== '_global' && !known.has(d));
  checks.push({
    name: 'registry consistency',
    status: orphans.length ? WARN : OK,
    details: orphans.length ? `memory without registry entry: ${orphans.join(', ')}` : 'none',
  });

  // 5. Secret scan across everything that would leave this machine.
  const findings = [];
  for (const { dir } of localRoots) {
    const local = await collectManifest(dir);
    for (const rel of local.keys()) {
      const abs = path.join(dir, ...rel.split('/'));
      const text = await fs.readFile(abs, 'utf8').catch(() => '');
      for (const hit of scanForSecrets(text)) findings.push(`${rel}:${hit.line} (${hit.kind})`);
    }
  }
  checks.push({
    name: 'secret scan',
    status: findings.length ? WARN : OK,
    details: findings.join(', ') || 'none',
  });

  return checks;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/secrets.test.mjs`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/secrets.mjs src/doctor.mjs test/secrets.test.mjs
git commit -m "feat: add secret scanning and doctor health checks"
```

---

### Task 9: CLI kabuğu ve sync akışı

Parçaları birleştirir: `pull`, `push`, `status`, `doctor`, `link`, `forget`, hepsinde `--dry-run`.

**Files:**
- Create: `bin/agent-sync.mjs`
- Create: `src/sync.mjs`
- Test: `test/sync.test.mjs`

**Interfaces:**
- Consumes: `loadConfig()`; `collectManifest()`; `buildPlan()`, `ACTION`; `applyPlan()`; `loadState()`, `saveState()`; `takeSnapshot()`; `stagedDir()`, `stagedSkillsDir()`, `stagedSharedDir()`; `runDoctor()`
- Produces: `syncPairs(config) -> Array<{name, localDir, remoteDir}>`, `runSync({config, dryRun}) -> Promise<{plan, conflicts}>`

**Note on forward references:** `bin/agent-sync.mjs` imports `ensureIdentity`, `linkProject`, `forgetFile` (Task 10), `applyAdapters` (Task 13) and `runWrapped` (Task 14). Those tasks create the modules. Until Task 14 lands, this task's own test (`test/sync.test.mjs`) exercises `syncPairs` directly and does not import the CLI, so it passes standalone.

- [ ] **Step 1: Write the failing test**

`test/sync.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncPairs } from '../src/sync.mjs';

test('pairs cover skills, global memory and shared docs', () => {
  const pairs = syncPairs({ syncRoot: '/sync', machineId: 'macbook' });
  const names = pairs.map((p) => p.name).sort();
  assert.deepEqual(names, ['memory', 'shared', 'skills']);
});

test('every pair maps a local directory to a remote one', () => {
  for (const pair of syncPairs({ syncRoot: '/sync', machineId: 'macbook' })) {
    assert.ok(pair.localDir.length > 0, `${pair.name} needs a localDir`);
    assert.ok(pair.remoteDir.startsWith('/sync'), `${pair.name} must live under syncRoot`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sync.test.mjs`
Expected: FAIL — `Cannot find module '../src/sync.mjs'`

- [ ] **Step 3: Write minimal implementation**

`src/sync.mjs`:

```js
import path from 'node:path';
import { stagedDir, stagedSkillsDir, stagedSharedDir } from './paths.mjs';
import { collectManifest } from './manifest.mjs';
import { buildPlan } from './sync-engine.mjs';
import { applyPlan } from './apply.mjs';
import { loadState, saveState } from './state.mjs';
import { takeSnapshot } from './snapshot.mjs';

/**
 * The three mirrored trees, all local sides living under ~/.agent-sync/staged.
 * The engine deliberately knows nothing about any agent's directories - getting
 * content into CLAUDE.md, AGENTS.md and friends is the adapters' job.
 * `memory` carries every project's notes at once because the whole set is only
 * a few hundred kilobytes.
 */
export function syncPairs(config) {
  return [
    { name: 'skills', localDir: stagedSkillsDir(), remoteDir: path.join(config.syncRoot, 'skills') },
    {
      name: 'memory',
      localDir: path.join(stagedDir(), 'memory'),
      remoteDir: path.join(config.syncRoot, 'memory'),
    },
    {
      name: 'shared',
      localDir: stagedSharedDir(),
      remoteDir: path.join(config.syncRoot, 'shared'),
    },
  ];
}

export async function runSync({ config, dryRun }) {
  const state = await loadState();
  const allConflicts = [];
  const fullPlan = [];

  if (!dryRun) {
    await takeSnapshot(
      syncPairs(config).map((p) => ({ name: p.name, dir: p.localDir })),
      config.snapshotKeep
    );
  }

  for (const pair of syncPairs(config)) {
    const local = await collectManifest(pair.localDir);
    const remote = await collectManifest(pair.remoteDir);
    const base = state.files[pair.name] ?? {};
    const plan = buildPlan(local, remote, base);

    const { applied, conflicts } = await applyPlan(plan, {
      localRoot: pair.localDir,
      remoteRoot: pair.remoteDir,
      machineId: config.machineId,
      dryRun,
    });

    if (!dryRun) {
      const nextBase = { ...base };
      for (const entry of applied) nextBase[entry.relPath] = entry.hash;
      // Files that were already identical keep their recorded hash.
      for (const [rel, hash] of local) if (remote.get(rel) === hash) nextBase[rel] = hash;
      state.files[pair.name] = nextBase;
    }

    fullPlan.push(...plan.map((p) => ({ ...p, pair: pair.name })));
    allConflicts.push(...conflicts.map((c) => ({ ...c, pair: pair.name })));
  }

  if (!dryRun) await saveState(state);
  return { plan: fullPlan, conflicts: allConflicts };
}
```

`bin/agent-sync.mjs`:

```js
#!/usr/bin/env node
import process from 'node:process';
import { loadConfig } from '../src/config.mjs';
import { runSync, syncPairs } from '../src/sync.mjs';
import { runDoctor } from '../src/doctor.mjs';
import { init } from '../src/init.mjs';
import { ensureIdentity, linkProject, forgetFile } from '../src/project.mjs';
import { applyAdapters, collectFromTools } from '../src/adapters/index.mjs';
import { runWrapped } from '../src/run.mjs';

const HELP = `agent-sync <command> [--dry-run]

  init                 Set up this machine: config, sync root, tool targets
  pull | push          Synchronise skills, memory and shared settings
  status               Show this machine, this project, targets and pending changes
  doctor               Health checks: conflicts, registry, secrets
  link <project-id>    Bind the current directory to an existing project
  forget <path>        Delete a file locally and remotely on purpose
  run <command...>     Pull, run the command, then push when it exits
`;

// Hooks and the VS Code extension call this binary. It must never take a
// session down with it.
const HOOK_SAFE = new Set(['pull', 'push']);

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const dryRun = rest.includes('--dry-run');
  const args = rest.filter((a) => a !== '--dry-run');

  if (!command || command === 'help' || command === '--help') {
    process.stdout.write(HELP);
    return 0;
  }
  if (command === 'init') return init({ dryRun });

  const config = await loadConfig();

  switch (command) {
    case 'pull':
    case 'push': {
      const identity = await ensureIdentity(config, process.cwd());
      // Read authored content out of the tools first, or there is nothing to push.
      if (!dryRun) {
        await collectFromTools({ config, projectId: identity.id, cwd: process.cwd() });
      }
      const { plan, conflicts } = await runSync({ config, dryRun });
      const prefix = dryRun ? '[dry-run] ' : '';
      for (const item of plan) {
        process.stdout.write(`${prefix}${item.action.padEnd(8)} ${item.pair}/${item.relPath}\n`);
      }
      if (!plan.length) process.stdout.write(`${prefix}already in sync\n`);
      // Distribute the freshly synced canonical content to the selected tools.
      const written = await applyAdapters({
        config,
        projectId: identity.id,
        cwd: process.cwd(),
        dryRun,
      });
      for (const target of written) {
        process.stdout.write(`${prefix}wrote    ${target.adapter} -> ${target.file}\n`);
      }
      for (const c of conflicts) {
        process.stdout.write(`conflict: ${c.pair}/${c.relPath} - your version kept as ${c.keptAs}\n`);
      }
      return 0;
    }
    case 'status': {
      const identity = await ensureIdentity(config, process.cwd(), { write: false });
      process.stdout.write(`machine:  ${config.machineId}\n`);
      process.stdout.write(`syncRoot: ${config.syncRoot}\n`);
      process.stdout.write(`targets:  ${config.targets.join(', ') || 'none'}\n`);
      process.stdout.write(`project:  ${identity.id} (matched by ${identity.source})\n`);
      const { plan } = await runSync({ config, dryRun: true });
      process.stdout.write(`pending:  ${plan.length} change(s)\n`);
      return 0;
    }
    case 'doctor': {
      const checks = await runDoctor({
        syncRoot: config.syncRoot,
        localRoots: syncPairs(config).map((p) => ({ dir: p.localDir })),
      });
      for (const c of checks) {
        process.stdout.write(`${c.status.toUpperCase().padEnd(5)} ${c.name}: ${c.details}\n`);
      }
      return checks.some((c) => c.status === 'fail') ? 1 : 0;
    }
    case 'link':
      return linkProject(config, process.cwd(), args[0]);
    case 'forget':
      return forgetFile(config, args[0], dryRun);
    case 'run':
      return runWrapped(config, args);
    default:
      process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
      return 1;
  }
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    process.stderr.write(`agent-sync: ${err.message}\n`);
    // Hook-invoked commands always exit 0 so a broken sync never blocks a session.
    process.exit(HOOK_SAFE.has(process.argv[2]) ? 0 : 1);
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sync.test.mjs`
Expected: PASS — 2 tests

- [ ] **Step 5: Commit**

```bash
git add bin/agent-sync.mjs src/sync.mjs test/sync.test.mjs
git commit -m "feat: add CLI and end-to-end sync flow"
```

---

### Task 10: Proje bağlama, marker yazma ve kanonik hafıza dizini

Task 9'daki CLI, `src/project.mjs`'ten üç fonksiyon çağırıyor. Bu task onları yazar ve `homeDir()/memory` ile Claude Code'un gerçek hafıza dizini arasındaki köprüyü kurar.

**Files:**
- Create: `src/project.mjs`
- Test: `test/project.test.mjs`

**Interfaces:**
- Consumes: `resolveIdentity()`, `MARKER_FILENAME`; `loadRegistry()`, `saveRegistry()`, `upsertProject()`; `stagedDir()`, `stagedMemoryDir()`
- Produces: `readMarker(cwd) -> Promise<string|null>`, `readGitRemote(cwd) -> Promise<string|null>`, `addToGitExclude(cwd, name) -> Promise<void>`, `ensureIdentity(config, cwd, opts) -> Promise<{id, source, ambiguous}>`, `linkProject(config, cwd, id) -> Promise<number>`, `forgetFile(config, relPath, dryRun) -> Promise<number>`

- [ ] **Step 1: Write the failing test**

`test/project.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readMarker, addToGitExclude } from '../src/project.mjs';

test('reads and trims a marker file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-proj-'));
  await fs.writeFile(path.join(dir, '.claude-project-id'), 'avukatsite-7f3a9c\n');
  assert.equal(await readMarker(dir), 'avukatsite-7f3a9c');
});

test('a directory with no marker reads as null', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-proj-'));
  assert.equal(await readMarker(dir), null);
});

test('marker is excluded via .git/info/exclude, never .gitignore', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-proj-'));
  await fs.mkdir(path.join(dir, '.git', 'info'), { recursive: true });
  await fs.writeFile(path.join(dir, '.gitignore'), 'node_modules\n');
  await addToGitExclude(dir, '.claude-project-id');
  const exclude = await fs.readFile(path.join(dir, '.git', 'info', 'exclude'), 'utf8');
  assert.match(exclude, /\.claude-project-id/);
  assert.equal(await fs.readFile(path.join(dir, '.gitignore'), 'utf8'), 'node_modules\n');
});

test('excluding twice does not duplicate the entry', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-proj-'));
  await fs.mkdir(path.join(dir, '.git', 'info'), { recursive: true });
  await addToGitExclude(dir, '.claude-project-id');
  await addToGitExclude(dir, '.claude-project-id');
  const exclude = await fs.readFile(path.join(dir, '.git', 'info', 'exclude'), 'utf8');
  assert.equal(exclude.match(/\.claude-project-id/g).length, 1);
});

test('a non-git directory is left completely alone', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-proj-'));
  await addToGitExclude(dir, '.claude-project-id');
  assert.deepEqual(await fs.readdir(dir), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/project.test.mjs`
Expected: FAIL — `Cannot find module '../src/project.mjs'`

- [ ] **Step 3: Write minimal implementation**

`src/project.mjs`:

```js
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MARKER_FILENAME, resolveIdentity } from './identity.mjs';
import { loadRegistry, saveRegistry, upsertProject } from './registry.mjs';
import { stagedDir, stagedMemoryDir } from './paths.mjs';

const run = promisify(execFile);

export async function readMarker(cwd) {
  try {
    return (await fs.readFile(path.join(cwd, MARKER_FILENAME), 'utf8')).trim() || null;
  } catch {
    return null;
  }
}

export async function readGitRemote(cwd) {
  try {
    const { stdout } = await run('git', ['remote', 'get-url', 'origin'], { cwd });
    return stdout.trim() || null;
  } catch {
    return null; // Not a repo, or no origin. Both are fine.
  }
}

/** Uses .git/info/exclude so the user's own .gitignore is never modified. */
export async function addToGitExclude(cwd, name) {
  const excludePath = path.join(cwd, '.git', 'info', 'exclude');
  let current;
  try {
    current = await fs.readFile(excludePath, 'utf8');
  } catch {
    return; // No .git/info directory means this is not a git working tree.
  }
  if (current.split(/\r?\n/).includes(name)) return;
  const sep = current.endsWith('\n') || current === '' ? '' : '\n';
  await fs.writeFile(excludePath, `${current}${sep}${name}\n`, 'utf8');
}

/**
 * Resolves which project this directory belongs to, writes the marker and
 * registry entry, and links Claude Code's memory directory to the synced copy.
 */
export async function ensureIdentity(config, cwd, { write = true } = {}) {
  const registry = await loadRegistry(config.syncRoot);
  const identity = resolveIdentity({
    folderName: path.basename(cwd),
    marker: await readMarker(cwd),
    gitRemote: await readGitRemote(cwd),
    registry,
  });

  if (write) {
    await fs.writeFile(path.join(cwd, MARKER_FILENAME), identity.id + '\n', 'utf8');
    await addToGitExclude(cwd, MARKER_FILENAME);
    await saveRegistry(
      config.syncRoot,
      upsertProject(registry, {
        id: identity.id,
        name: path.basename(cwd),
        gitRemote: await readGitRemote(cwd),
        machineId: config.machineId,
        absPath: cwd,
      })
    );
    await ensureStagedMemory(identity.id);
  }
  return identity;
}

/**
 * Guarantees this project has a canonical memory directory. Getting that
 * content into each tool's own location is the adapters' job, not this
 * module's - the engine stays agent-agnostic.
 */
async function ensureStagedMemory(projectId) {
  await fs.mkdir(stagedMemoryDir(projectId), { recursive: true });
}

export async function linkProject(config, cwd, projectId) {
  if (!projectId) {
    process.stderr.write('Usage: agent-sync link <project-id>\n');
    return 1;
  }
  const registry = await loadRegistry(config.syncRoot);
  if (!registry.projects[projectId]) {
    process.stderr.write(`Unknown project id: ${projectId}\n`);
    return 1;
  }
  await fs.writeFile(path.join(cwd, MARKER_FILENAME), projectId + '\n', 'utf8');
  await addToGitExclude(cwd, MARKER_FILENAME);
  await saveRegistry(
    config.syncRoot,
    upsertProject(registry, {
      id: projectId,
      name: registry.projects[projectId].name,
      gitRemote: await readGitRemote(cwd),
      machineId: config.machineId,
      absPath: cwd,
    })
  );
  await ensureStagedMemory(projectId);
  process.stdout.write(`Linked ${cwd} to ${projectId}\n`);
  return 0;
}

/** The only path that deletes anything, because sync itself never does. */
export async function forgetFile(config, relPath, dryRun) {
  if (!relPath) {
    process.stderr.write('Usage: agent-sync forget <relative-path>\n');
    return 1;
  }
  const targets = [
    path.join(config.syncRoot, ...relPath.split('/')),
    path.join(stagedDir(), ...relPath.split('/')),
  ];
  for (const target of targets) {
    process.stdout.write(`${dryRun ? '[dry-run] ' : ''}delete ${target}\n`);
    if (!dryRun) await fs.rm(target, { force: true });
  }
  return 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/project.test.mjs`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/project.mjs test/project.test.mjs
git commit -m "feat: add project linking, marker handling and staged memory"
```


---

### Task 11: Hafıza digest'i ve sınırlayıcılı blok yazımı

Kanonik hafıza çok sayıda küçük markdown dosyasıdır. Claude Code bunu dizin olarak okur; diğer araçların çoğu tek dosya bekler. Bu task, dizini tek bir belgeye derler ve hedef dosyaya kullanıcının kendi içeriğini bozmadan yazar.

**Files:**
- Create: `src/render.mjs`
- Test: `test/render.test.mjs`

**Interfaces:**
- Consumes: yok (saf)
- Produces: `BEGIN`, `END`, `renderDigest({projectId, memoryFiles, skillNames}) -> string`, `upsertBlock(existingText, blockBody) -> string`

- [ ] **Step 1: Write the failing test**

`test/render.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BEGIN, END, renderDigest, upsertBlock } from '../src/render.mjs';

test('digest lists every memory file under a heading', () => {
  const out = renderDigest({
    projectId: 'avukatsite-7f3a9c',
    memoryFiles: [
      { name: 'db-choice.md', content: 'We use Postgres.' },
      { name: 'auth.md', content: 'Sessions, not JWT.' },
    ],
    skillNames: [],
  });
  assert.match(out, /avukatsite-7f3a9c/);
  assert.match(out, /db-choice/);
  assert.match(out, /We use Postgres\./);
  assert.match(out, /Sessions, not JWT\./);
});

test('digest mentions available skills by name', () => {
  const out = renderDigest({ projectId: 'p', memoryFiles: [], skillNames: ['humanizer'] });
  assert.match(out, /humanizer/);
});

test('digest with nothing in it still produces valid markdown', () => {
  const out = renderDigest({ projectId: 'p', memoryFiles: [], skillNames: [] });
  assert.equal(typeof out, 'string');
  assert.ok(out.length > 0);
});

test('upsert appends a delimited block to a file that has none', () => {
  const out = upsertBlock('# My notes\n\nHand written.\n', 'GENERATED');
  assert.match(out, /Hand written\./);
  assert.match(out, new RegExp(`${BEGIN}[\\s\\S]*GENERATED[\\s\\S]*${END}`));
});

test('upsert replaces only the block, preserving surrounding text', () => {
  const before = `top\n${BEGIN}\nOLD\n${END}\nbottom\n`;
  const out = upsertBlock(before, 'NEW');
  assert.match(out, /^top/);
  assert.match(out, /bottom/);
  assert.match(out, /NEW/);
  assert.ok(!out.includes('OLD'));
});

test('upsert on an empty file produces just the block', () => {
  const out = upsertBlock('', 'GENERATED');
  assert.ok(out.startsWith(BEGIN));
  assert.ok(out.trimEnd().endsWith(END));
});

test('upsert is idempotent', () => {
  const once = upsertBlock('keep\n', 'X');
  assert.equal(upsertBlock(once, 'X'), once);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/render.test.mjs`
Expected: FAIL — `Cannot find module '../src/render.mjs'`

- [ ] **Step 3: Write minimal implementation**

`src/render.mjs`:

```js
export const BEGIN = '<!-- agent-sync:begin -->';
export const END = '<!-- agent-sync:end -->';

/**
 * Compiles the canonical per-project memory directory into one markdown
 * document, for tools that read a single context file rather than a folder.
 */
export function renderDigest({ projectId, memoryFiles, skillNames }) {
  const lines = [
    '## Project memory (synced by agent-sync)',
    '',
    `Project id: \`${projectId}\``,
    '',
  ];

  if (memoryFiles.length === 0) {
    lines.push('_No memory recorded for this project yet._', '');
  } else {
    for (const file of memoryFiles) {
      lines.push(`### ${file.name.replace(/\.md$/, '')}`, '', file.content.trim(), '');
    }
  }

  if (skillNames.length > 0) {
    lines.push(
      '## Available skills',
      '',
      'These are synced as markdown and can be read on demand:',
      '',
      ...skillNames.map((n) => `- ${n}`),
      ''
    );
  }

  return lines.join('\n');
}

/**
 * Writes `blockBody` between our delimiters inside `existingText`, leaving any
 * hand-written content alone. Appends the block when the delimiters are absent.
 */
export function upsertBlock(existingText, blockBody) {
  const block = `${BEGIN}\n${blockBody.trim()}\n${END}\n`;
  const start = existingText.indexOf(BEGIN);
  const end = existingText.indexOf(END);

  if (start !== -1 && end !== -1 && end > start) {
    return existingText.slice(0, start) + block + existingText.slice(end + END.length + 1);
  }
  if (existingText.trim() === '') return block;
  const sep = existingText.endsWith('\n') ? '\n' : '\n\n';
  return existingText + sep + block;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/render.test.mjs`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add src/render.mjs test/render.test.mjs
git commit -m "feat: render memory into a single delimited markdown block"
```

---

### Task 12: Adapter katmanı

Araca özgü **her şeyin** yaşadığı yer. Motor modüllerinde hiçbir araç adı geçmez; burada geçer.

**Files:**
- Create: `src/adapters/claude.mjs`
- Create: `src/adapters/agents-md.mjs`
- Create: `src/adapters/simple.mjs`
- Create: `src/adapters/index.mjs`
- Test: `test/adapters.test.mjs`

**Interfaces:**
- Consumes: `slugForPath()`, `stagedMemoryDir()`, `stagedSkillsDir()`, `stagedSharedDir()`; `renderDigest()`, `upsertBlock()`; `extractShared()`, `mergeShared()`
- Produces: `ADAPTERS` (array), `byId(id) -> adapter`, `selectAdapters(targets) -> adapter[]`, `planWrites({adapters, projectId, cwd}) -> Array<{adapter, file, kind}>`, `applyAdapters({config, projectId, cwd, dryRun}) -> Promise<Array<{adapter, file}>>`, `collectFromTools({config, projectId, cwd}) -> Promise<void>`, `detectInstalled() -> Promise<Array<{id, label, installed}>>`; `buildHooks()`, `hookCommand()`, `claudeHome()` from `adapters/claude.mjs`
- Adapter shape: `{id, label, detect(), globalInstructionsPath(), projectMemoryDir(cwd), projectInstructionsPath(cwd), installHooks(ctx)}`

- [ ] **Step 1: Write the failing test**

`test/adapters.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ADAPTERS, byId, selectAdapters, planWrites } from '../src/adapters/index.mjs';

test('every known target has an adapter', () => {
  const ids = ADAPTERS.map((a) => a.id).sort();
  assert.deepEqual(ids, ['aider', 'claude', 'codex', 'cursor', 'gemini', 'opencode']);
});

test('every adapter implements the full shape', () => {
  for (const a of ADAPTERS) {
    assert.equal(typeof a.id, 'string', `${a.id}: id`);
    assert.equal(typeof a.label, 'string', `${a.id}: label`);
    assert.equal(typeof a.detect, 'function', `${a.id}: detect`);
    assert.equal(typeof a.globalInstructionsPath, 'function', `${a.id}: globalInstructionsPath`);
    assert.equal(typeof a.projectMemoryDir, 'function', `${a.id}: projectMemoryDir`);
    assert.equal(typeof a.projectInstructionsPath, 'function', `${a.id}: projectInstructionsPath`);
  }
});

test('selectAdapters honours the targets list and ignores unknown ids', () => {
  assert.deepEqual(selectAdapters(['codex', 'nope']).map((a) => a.id), ['codex']);
  assert.deepEqual(selectAdapters([]).map((a) => a.id), []);
});

test('codex and opencode both aim at AGENTS.md', () => {
  const cwd = path.join(path.sep, 'proj');
  assert.equal(byId('codex').projectInstructionsPath(cwd), path.join(cwd, 'AGENTS.md'));
  assert.equal(byId('opencode').projectInstructionsPath(cwd), path.join(cwd, 'AGENTS.md'));
});

test('planWrites deduplicates the shared AGENTS.md target', () => {
  const cwd = path.join(path.sep, 'proj');
  const writes = planWrites({
    adapters: selectAdapters(['codex', 'opencode']),
    projectId: 'p',
    cwd,
  });
  const agentsWrites = writes.filter((w) => w.file === path.join(cwd, 'AGENTS.md'));
  assert.equal(agentsWrites.length, 1);
});

test('claude writes a memory directory, the others write single files', () => {
  const cwd = path.join(path.sep, 'proj');
  assert.ok(byId('claude').projectMemoryDir(cwd));
  assert.equal(byId('gemini').projectMemoryDir(cwd), null);
  assert.equal(byId('gemini').projectInstructionsPath(cwd), path.join(cwd, 'GEMINI.md'));
  assert.equal(byId('aider').projectInstructionsPath(cwd), path.join(cwd, 'CONVENTIONS.md'));
  assert.equal(
    byId('cursor').projectInstructionsPath(cwd),
    path.join(cwd, '.cursor', 'rules', 'agent-sync.mdc')
  );
});

test('only claude declares hook support', () => {
  assert.equal(typeof byId('claude').installHooks, 'function');
  for (const a of ADAPTERS.filter((x) => x.id !== 'claude')) {
    assert.equal(a.installHooks, null, `${a.id} must not claim hook support`);
  }
});

test('only claude feeds content back to the canonical store', () => {
  assert.equal(typeof byId('claude').collect, 'function');
  for (const a of ADAPTERS.filter((x) => x.id !== 'claude')) {
    assert.equal(a.collect, undefined, `${a.id} must not write to the canonical store`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/adapters.test.mjs`
Expected: FAIL — `Cannot find module '../src/adapters/index.mjs'`

- [ ] **Step 3: Write minimal implementation**

`src/adapters/simple.mjs`:

```js
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Builds an adapter for a tool that reads one markdown file per project. */
export function singleFileAdapter({ id, label, projectFile, globalFile, detectPath }) {
  return {
    id,
    label,
    async detect() {
      if (!detectPath) return false;
      return fs
        .access(path.join(os.homedir(), detectPath))
        .then(() => true)
        .catch(() => false);
    },
    globalInstructionsPath() {
      return globalFile ? path.join(os.homedir(), ...globalFile.split('/')) : null;
    },
    projectMemoryDir() {
      return null;
    },
    projectInstructionsPath(cwd) {
      return path.join(cwd, ...projectFile.split('/'));
    },
    installHooks: null,
  };
}
```

`src/adapters/agents-md.mjs`:

```js
import { singleFileAdapter } from './simple.mjs';

/**
 * AGENTS.md is the de-facto cross-tool convention. Codex and OpenCode both
 * read it, so they share this base and are deduplicated at write time.
 */
export const codex = singleFileAdapter({
  id: 'codex',
  label: 'Codex CLI',
  projectFile: 'AGENTS.md',
  globalFile: '.codex/AGENTS.md',
  detectPath: '.codex',
});

export const opencode = singleFileAdapter({
  id: 'opencode',
  label: 'OpenCode',
  projectFile: 'AGENTS.md',
  globalFile: '.config/opencode/AGENTS.md',
  detectPath: '.config/opencode',
});
```

`src/adapters/claude.mjs`:

```js
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugForPath, stagedMemoryDir, stagedSkillsDir, stagedSharedDir } from '../paths.mjs';
import { mergeShared, extractShared } from '../settings-merge.mjs';

const MARK = 'agent-sync';

export function claudeHome() {
  return path.join(os.homedir(), '.claude');
}

export function hookCommand() {
  const bin = fileURLToPath(new URL('../../bin/agent-sync.mjs', import.meta.url));
  // Quoted because home directories and cloud folders routinely contain spaces.
  return `node "${bin}"`;
}

/** Adds our two hooks without disturbing anything the user already configured. */
export function buildHooks(existingSettings) {
  const settings = { ...existingSettings, hooks: { ...(existingSettings.hooks ?? {}) } };
  for (const [event, command] of [
    ['SessionStart', `${hookCommand()} pull`],
    ['Stop', `${hookCommand()} push`],
  ]) {
    const current = (settings.hooks[event] ?? []).filter(
      (entry) => !JSON.stringify(entry).includes(MARK)
    );
    settings.hooks[event] = [...current, { hooks: [{ type: 'command', command }] }];
  }
  return settings;
}

export const claude = {
  id: 'claude',
  label: 'Claude Code',
  async detect() {
    return fs
      .access(claudeHome())
      .then(() => true)
      .catch(() => false);
  },
  globalInstructionsPath() {
    return path.join(claudeHome(), 'CLAUDE.md');
  },
  projectMemoryDir(cwd) {
    return path.join(claudeHome(), 'projects', slugForPath(cwd), 'memory');
  },
  projectInstructionsPath() {
    // Claude reads the memory directory directly, so no digest file is needed.
    return null;
  },
  async installHooks() {
    const settingsPath = path.join(claudeHome(), 'settings.json');
    const existing = JSON.parse(await fs.readFile(settingsPath, 'utf8').catch(() => '{}'));
    await fs.mkdir(claudeHome(), { recursive: true });
    await fs.writeFile(
      settingsPath,
      JSON.stringify(buildHooks(existing), null, 2) + '\n',
      'utf8'
    );
  },
  async mergeSettings(sharedSettings) {
    const settingsPath = path.join(claudeHome(), 'settings.json');
    const existing = JSON.parse(await fs.readFile(settingsPath, 'utf8').catch(() => '{}'));
    await fs.writeFile(
      settingsPath,
      JSON.stringify(mergeShared(existing, sharedSettings), null, 2) + '\n',
      'utf8'
    );
  },

  /**
   * Claude is the only adapter that feeds content back into the canonical
   * store, because it is where the user actually authors memory and skills.
   * Without this the staged tree would stay empty and nothing would ever sync.
   */
  async collect({ projectId, cwd }) {
    await fs.mkdir(stagedMemoryDir(projectId), { recursive: true });
    await fs.mkdir(stagedSkillsDir(), { recursive: true });
    await fs.mkdir(stagedSharedDir(), { recursive: true });

    await fs
      .cp(this.projectMemoryDir(cwd), stagedMemoryDir(projectId), { recursive: true })
      .catch(() => {});
    await fs
      .cp(path.join(claudeHome(), 'skills'), stagedSkillsDir(), { recursive: true })
      .catch(() => {});
    await fs
      .cp(this.globalInstructionsPath(), path.join(stagedSharedDir(), 'CLAUDE.md'))
      .catch(() => {});

    const settings = JSON.parse(
      await fs.readFile(path.join(claudeHome(), 'settings.json'), 'utf8').catch(() => '{}')
    );
    await fs.writeFile(
      path.join(stagedSharedDir(), 'settings-shared.json'),
      JSON.stringify(extractShared(settings), null, 2) + '\n',
      'utf8'
    );
  },
};
```

`src/adapters/index.mjs`:

```js
import fs from 'node:fs/promises';
import path from 'node:path';
import { claude } from './claude.mjs';
import { codex, opencode } from './agents-md.mjs';
import { singleFileAdapter } from './simple.mjs';
import { stagedMemoryDir, stagedSkillsDir, stagedSharedDir } from '../paths.mjs';
import { renderDigest, upsertBlock } from '../render.mjs';

const gemini = singleFileAdapter({
  id: 'gemini',
  label: 'Gemini CLI',
  projectFile: 'GEMINI.md',
  globalFile: '.gemini/GEMINI.md',
  detectPath: '.gemini',
});

const aider = singleFileAdapter({
  id: 'aider',
  label: 'Aider',
  projectFile: 'CONVENTIONS.md',
  globalFile: null,
  detectPath: '.aider.conf.yml',
});

const cursor = singleFileAdapter({
  id: 'cursor',
  label: 'Cursor',
  projectFile: '.cursor/rules/agent-sync.mdc',
  globalFile: null,
  detectPath: '.cursor',
});

export const ADAPTERS = [claude, codex, opencode, gemini, aider, cursor];

export function byId(id) {
  return ADAPTERS.find((a) => a.id === id) ?? null;
}

export function selectAdapters(targets) {
  return (targets ?? []).map(byId).filter(Boolean);
}

/**
 * Works out every file each selected adapter wants written, then drops
 * duplicates by absolute path - codex and opencode both target AGENTS.md and
 * it must only be written once.
 */
export function planWrites({ adapters, projectId, cwd }) {
  const writes = [];
  const seen = new Set();
  for (const adapter of adapters) {
    const dir = adapter.projectMemoryDir(cwd);
    if (dir && !seen.has(dir)) {
      seen.add(dir);
      writes.push({ adapter: adapter.id, file: dir, kind: 'memory-dir' });
    }
    const file = adapter.projectInstructionsPath(cwd);
    if (file && !seen.has(file)) {
      seen.add(file);
      writes.push({ adapter: adapter.id, file, kind: 'digest' });
    }
  }
  return writes;
}

async function readMemoryFiles(projectId) {
  const dir = stagedMemoryDir(projectId);
  const names = (await fs.readdir(dir).catch(() => [])).filter((n) => n.endsWith('.md'));
  const files = [];
  for (const name of names.sort()) {
    files.push({ name, content: await fs.readFile(path.join(dir, name), 'utf8') });
  }
  return files;
}

export async function applyAdapters({ config, projectId, cwd, dryRun }) {
  const adapters = selectAdapters(config.targets);
  if (adapters.length === 0) return [];

  const memoryFiles = await readMemoryFiles(projectId);
  const skillNames = (await fs.readdir(stagedSkillsDir()).catch(() => [])).sort();
  const body = renderDigest({ projectId, memoryFiles, skillNames });
  const written = [];

  for (const write of planWrites({ adapters, projectId, cwd })) {
    if (dryRun) {
      written.push({ adapter: write.adapter, file: write.file });
      continue;
    }
    if (write.kind === 'memory-dir') {
      await fs.mkdir(write.file, { recursive: true });
      for (const file of memoryFiles) {
        await fs.writeFile(path.join(write.file, file.name), file.content, 'utf8');
      }
    } else {
      await fs.mkdir(path.dirname(write.file), { recursive: true });
      const existing = await fs.readFile(write.file, 'utf8').catch(() => '');
      await fs.writeFile(write.file, upsertBlock(existing, body), 'utf8');
    }
    written.push({ adapter: write.adapter, file: write.file });
  }

  // Claude is the only adapter carrying settings, and only when selected.
  if (adapters.some((a) => a.id === 'claude') && !dryRun) {
    const sharedPath = path.join(stagedSharedDir(), 'settings-shared.json');
    const shared = JSON.parse(await fs.readFile(sharedPath, 'utf8').catch(() => '{}'));
    await claude.mergeSettings(shared);
  }

  return written;
}

/**
 * Reads authored content out of the tools and into the canonical staged tree.
 * Must run before runSync on the way out, otherwise there is nothing to push.
 * Only adapters that declare `collect` participate; today that is Claude alone.
 */
export async function collectFromTools({ config, projectId, cwd }) {
  for (const adapter of selectAdapters(config.targets)) {
    if (typeof adapter.collect === 'function') await adapter.collect({ projectId, cwd });
  }
}

export async function detectInstalled() {
  const out = [];
  for (const adapter of ADAPTERS) {
    out.push({ id: adapter.id, label: adapter.label, installed: await adapter.detect() });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/adapters.test.mjs`
Expected: PASS — 8 tests

- [ ] **Step 5: Commit**

```bash
git add src/adapters test/adapters.test.mjs
git commit -m "feat: add per-tool adapters with deduplicated write targets"
```

---

### Task 13: `run` sarmalayıcısı

VS Code dışında ve hook desteği olmayan araçlar için tetikleme yolu.

**Files:**
- Create: `src/run.mjs`
- Test: `test/run.test.mjs`

**Interfaces:**
- Consumes: `runSync()` from `src/sync.mjs`; `applyAdapters()` from `src/adapters/index.mjs`; `ensureIdentity()` from `src/project.mjs`
- Produces: `runWrapped(config, argv) -> Promise<number>`

- [ ] **Step 1: Write the failing test**

`test/run.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnChild } from '../src/run.mjs';

test('propagates the child exit code', async () => {
  assert.equal(await spawnChild(process.execPath, ['-e', 'process.exit(0)']), 0);
  assert.equal(await spawnChild(process.execPath, ['-e', 'process.exit(7)']), 7);
});

test('a child killed by a signal reports a non-zero code', async () => {
  const code = await spawnChild(process.execPath, ['-e', 'process.kill(process.pid, "SIGTERM")']);
  assert.notEqual(code, 0);
});

test('a command that does not exist reports non-zero instead of throwing', async () => {
  const code = await spawnChild('this-command-does-not-exist-12345', []);
  assert.notEqual(code, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/run.test.mjs`
Expected: FAIL — `Cannot find module '../src/run.mjs'`

- [ ] **Step 3: Write minimal implementation**

`src/run.mjs`:

```js
import { spawn } from 'node:child_process';
import process from 'node:process';
import { runSync } from './sync.mjs';
import { applyAdapters, collectFromTools } from './adapters/index.mjs';
import { ensureIdentity } from './project.mjs';

/**
 * Runs a command with stdio inherited so interactive TUIs behave normally.
 * Never throws: a missing binary or a fatal signal comes back as a code.
 */
export function spawnChild(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: false });
    child.on('error', () => resolve(127));
    child.on('close', (code, signal) => resolve(signal ? 128 : (code ?? 0)));
  });
}

export async function runWrapped(config, argv) {
  if (argv.length === 0) {
    process.stderr.write('Usage: agent-sync run <command> [args...]\n');
    return 1;
  }
  const cwd = process.cwd();
  const identity = await ensureIdentity(config, cwd);

  await runSync({ config, dryRun: false });
  await applyAdapters({ config, projectId: identity.id, cwd, dryRun: false });

  const code = await spawnChild(argv[0], argv.slice(1));

  // Push whatever the session produced, however the command ended.
  await collectFromTools({ config, projectId: identity.id, cwd });
  await runSync({ config, dryRun: false });
  return code;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/run.test.mjs`
Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/run.mjs test/run.test.mjs
git commit -m "feat: add run wrapper that syncs around any agent command"
```

---

### Task 14: Etkileşimli kurulum

Makinede kurulu araçları tespit eder, seçtirir, `<syncRoot>` iskeletini kurar. Hook kurulumu artık opsiyonel — VS Code extension'ı tetiklemeyi üstlenecekse gerekmez.

**Files:**
- Create: `src/init.mjs`
- Test: `test/init.test.mjs`

**Interfaces:**
- Consumes: `DEFAULT_CONFIG`, `saveConfig()`, `validateConfig()`; `detectInstalled()`, `byId()`; `stagedDir()`
- Produces: `parseSelection(input, options) -> string[]`, `init({dryRun}) -> Promise<number>`

- [ ] **Step 1: Write the failing test**

`test/init.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSelection } from '../src/init.mjs';
import { buildHooks } from '../src/adapters/claude.mjs';

const options = ['claude', 'codex', 'opencode'];

test('parses a comma separated list of numbers', () => {
  assert.deepEqual(parseSelection('1,3', options), ['claude', 'opencode']);
});

test('tolerates spaces and repeated entries', () => {
  assert.deepEqual(parseSelection(' 2 , 2, 1 ', options), ['codex', 'claude']);
});

test('an empty answer selects nothing', () => {
  assert.deepEqual(parseSelection('', options), []);
});

test('out of range numbers are ignored rather than fatal', () => {
  assert.deepEqual(parseSelection('1,9', options), ['claude']);
});

test('installs a SessionStart pull and a Stop push', () => {
  const settings = buildHooks({});
  assert.ok(JSON.stringify(settings.hooks.SessionStart).includes('pull'));
  assert.ok(JSON.stringify(settings.hooks.Stop).includes('push'));
});

test('keeps hooks the user already had', () => {
  const existing = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } };
  const settings = buildHooks(existing);
  assert.ok(JSON.stringify(settings.hooks.Stop).includes('echo mine'));
  assert.ok(JSON.stringify(settings.hooks.Stop).includes('push'));
});

test('running init twice does not duplicate our hooks', () => {
  const twice = buildHooks(buildHooks({}));
  assert.equal(JSON.stringify(twice.hooks.Stop).split('agent-sync').length - 1, 1);
});

test('leaves unrelated settings untouched', () => {
  const settings = buildHooks({ model: 'opus', permissions: { allow: ['a'] } });
  assert.equal(settings.model, 'opus');
  assert.deepEqual(settings.permissions, { allow: ['a'] });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/init.test.mjs`
Expected: FAIL — `Cannot find module '../src/init.mjs'`

- [ ] **Step 3: Write minimal implementation**

`src/init.mjs`:

```js
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { DEFAULT_CONFIG, saveConfig, validateConfig, configPath } from './config.mjs';
import { detectInstalled, byId } from './adapters/index.mjs';
import { stagedDir } from './paths.mjs';

/** Turns "1,3" into adapter ids. Unknown or out-of-range entries are dropped. */
export function parseSelection(input, options) {
  const picked = [];
  for (const raw of input.split(',')) {
    const n = Number.parseInt(raw.trim(), 10);
    if (!Number.isInteger(n)) continue;
    const id = options[n - 1];
    if (id && !picked.includes(id)) picked.push(id);
  }
  return picked;
}

export async function init({ dryRun }) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const syncRoot = (await rl.question('Path to the shared sync folder (syncRoot): ')).trim();
  const machineId = (await rl.question('Short name for this machine (e.g. macbook): ')).trim();

  const detected = await detectInstalled();
  process.stdout.write('\nTools found on this machine:\n');
  detected.forEach((d, i) => {
    process.stdout.write(`  ${i + 1}. ${d.label}${d.installed ? '' : '  (not detected)'}\n`);
  });
  const answer = await rl.question('\nWhich should agent-sync write to? (e.g. 1,2): ');
  const targets = parseSelection(answer, detected.map((d) => d.id));

  const wantHooks =
    targets.includes('claude') &&
    /^y/i.test(await rl.question('Install Claude Code hooks for terminal use? [y/N]: '));
  rl.close();

  const config = { ...DEFAULT_CONFIG, syncRoot, machineId, targets };
  const { ok, errors } = validateConfig(config);
  if (!ok) {
    process.stderr.write(`Invalid input: ${errors.join('; ')}\n`);
    return 1;
  }

  if (dryRun) {
    process.stdout.write(`[dry-run] would write ${configPath()}\n`);
    process.stdout.write(`[dry-run] would create ${syncRoot} skeleton\n`);
    process.stdout.write(`[dry-run] would create ${stagedDir()}\n`);
    process.stdout.write(`[dry-run] targets: ${targets.join(', ') || 'none'}\n`);
    if (wantHooks) process.stdout.write('[dry-run] would install Claude Code hooks\n');
    return 0;
  }

  for (const dir of ['skills', 'memory/_global', 'shared']) {
    await fs.mkdir(path.join(syncRoot, ...dir.split('/')), { recursive: true });
    await fs.mkdir(path.join(stagedDir(), ...dir.split('/')), { recursive: true });
  }
  await saveConfig(config);
  if (wantHooks) await byId('claude').installHooks();

  process.stdout.write('Done. Run "agent-sync doctor" to verify.\n');
  return 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/init.test.mjs`
Expected: PASS — 8 tests

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test`
Expected: PASS — all files, 0 failures

```bash
git add src/init.mjs test/init.test.mjs
git commit -m "feat: add interactive setup with tool detection and selection"
```

---

### Task 15: Dağıtım paketi

**Files:**
- Create: `README.md`
- Create: `LICENSE`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: yok
- Produces: yok (dokümantasyon)

- [ ] **Step 1: Write `.gitignore`**

```
config.json
state.json
node_modules/
.DS_Store
.claude-project-id
extension/out/
extension/*.vsix
```

- [ ] **Step 2: Write `LICENSE`**

Standart MIT metni, telif sahibi `agent-sync contributors`, yıl 2026.

- [ ] **Step 3: Write `README.md`**

Önce Türkçe bölüm, ardından aynı içeriğin İngilizcesi. Şu başlıklar bu sırayla:

1. Tek paragraf tanım: kodlama ajanlarının skill'lerini, hafızasını ve paylaşılan ayarlarını hem makineler hem araçlar arasında senkronize eder; yolu farklı olsa da aynı projeyi tanır.
2. Gereksinimler: Node >= 20; makineler arasında **zaten paylaşılan** bir klasör (Google Drive, OneDrive, Dropbox, Syncthing veya ağ paylaşımı). Açıkça belirt: agent-sync taşıma işini kendisi yapmaz.
3. Kurulum: `git clone`, ardından her makinede `node bin/agent-sync.mjs init`.
4. Komut tablosu — `bin/agent-sync.mjs` içindeki `HELP` metniyle birebir aynı.
5. Desteklenen araçlar tablosu: `claude`, `codex`, `opencode`, `gemini`, `aider`, `cursor` ve her birinin yazdığı dosya.
6. Proje kimliği nasıl çalışır: 4 çözümleme adımı ve yanlış eşleşmeyi düzeltmek için `link`.
7. VS Code extension: ne yaptığı, VSIX'in nasıl kurulacağı, tetiklemeyi üstlenince hook'ların gereksizleştiği.
8. Bilinçli sınırlar, spec'ten aynen: silme yayılmaz (`forget` kullan); sync sürekli değil, oturum başı/sonu; transcript senkronu varsayılan kapalı; skill'ler yalnızca Claude Code'da otomatik tetiklenir.
9. Uyarı: hafıza notları makineden çıkar; `doctor` bunlar çıkmadan önce sır taraması yapar.
10. Uyarı: `syncRoot` içine git repo koyma — iki makineden eşzamanlı yazma `.git`'i bozar.

- [ ] **Step 4: Verify the suite still passes**

Run: `npm test`
Expected: PASS — all files, 0 failures

- [ ] **Step 5: Commit**

```bash
git add README.md LICENSE .gitignore
git commit -m "docs: add bilingual README, license and ignore rules"
```

---

## Faz 2 — VS Code Extension

Motor ve CLI çalıştıktan **sonra** yapılır. Extension yeni iş mantığı içermez; `src/` modüllerini aynı süreçte çağıran ince bir kabuktur.

### Task 16: VS Code extension kabuğu

**Files:**
- Create: `extension/package.json`
- Create: `extension/extension.mjs`
- Create: `extension/README.md`
- Test: `test/extension-manifest.test.mjs`

**Interfaces:**
- Consumes: `loadConfig()`; `runSync()`; `applyAdapters()`; `ensureIdentity()`; `runDoctor()`; `syncPairs()`
- Produces: VS Code komutları `agent-sync.sync`, `agent-sync.doctor`, `agent-sync.link`; durum çubuğu öğesi

- [ ] **Step 1: Write the failing test**

`test/extension-manifest.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, 'extension', 'package.json'), 'utf8')
);

test('declares the three commands the README promises', () => {
  const ids = manifest.contributes.commands.map((c) => c.command).sort();
  assert.deepEqual(ids, ['agent-sync.doctor', 'agent-sync.link', 'agent-sync.sync']);
});

test('activates on startup so window events can be observed', () => {
  assert.ok(manifest.activationEvents.includes('onStartupFinished'));
});

test('exposes syncRoot, machineId and targets as settings', () => {
  const keys = Object.keys(manifest.contributes.configuration.properties).sort();
  assert.deepEqual(keys, ['agent-sync.machineId', 'agent-sync.syncRoot', 'agent-sync.targets']);
});

test('has no runtime dependencies, matching the engine', () => {
  assert.deepEqual(manifest.dependencies ?? {}, {});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/extension-manifest.test.mjs`
Expected: FAIL — `ENOENT` for `extension/package.json`

- [ ] **Step 3: Write minimal implementation**

`extension/package.json`:

```json
{
  "name": "agent-sync-vscode",
  "displayName": "agent-sync",
  "description": "Sync coding-agent skills, memory and settings across machines and tools",
  "version": "0.1.0",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Other"],
  "main": "./extension.mjs",
  "activationEvents": ["onStartupFinished"],
  "contributes": {
    "commands": [
      { "command": "agent-sync.sync", "title": "agent-sync: Sync now" },
      { "command": "agent-sync.doctor", "title": "agent-sync: Run health checks" },
      { "command": "agent-sync.link", "title": "agent-sync: Link this folder to a project" }
    ],
    "configuration": {
      "title": "agent-sync",
      "properties": {
        "agent-sync.syncRoot": {
          "type": "string",
          "default": "",
          "description": "Folder shared between your machines (Drive, OneDrive, Dropbox, Syncthing)."
        },
        "agent-sync.machineId": {
          "type": "string",
          "default": "",
          "description": "Short name for this machine. Used in conflict filenames."
        },
        "agent-sync.targets": {
          "type": "array",
          "items": { "type": "string" },
          "default": [],
          "description": "Which agents to write context for."
        }
      }
    }
  },
  "dependencies": {}
}
```

`extension/extension.mjs`:

```js
import vscode from 'vscode';
import { loadConfig } from '../src/config.mjs';
import { runSync, syncPairs } from '../src/sync.mjs';
import { applyAdapters } from '../src/adapters/index.mjs';
import { ensureIdentity } from '../src/project.mjs';
import { runDoctor } from '../src/doctor.mjs';

let statusItem;
let output;

function workspaceRoot() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
}

/**
 * One sync pass. Never throws into VS Code - a broken sync shows up in the
 * status bar and the output channel, it does not interrupt the user.
 */
async function sync({ silent }) {
  const cwd = workspaceRoot();
  if (!cwd) return;
  try {
    const config = await loadConfig();
    const identity = await ensureIdentity(config, cwd);
    const { plan, conflicts } = await runSync({ config, dryRun: false });
    await applyAdapters({ config, projectId: identity.id, cwd, dryRun: false });

    const time = new Date().toLocaleTimeString();
    statusItem.text = conflicts.length
      ? `$(warning) agent-sync ${conflicts.length} conflict(s)`
      : `$(sync) agent-sync ${time}`;
    statusItem.backgroundColor = conflicts.length
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined;
    statusItem.tooltip = `${plan.length} change(s) synced at ${time}\nProject: ${identity.id}`;
    if (!silent) output.appendLine(`Synced ${plan.length} change(s) for ${identity.id}`);
  } catch (err) {
    statusItem.text = '$(error) agent-sync';
    statusItem.tooltip = String(err.message);
    output.appendLine(`Sync failed: ${err.message}`);
  }
}

export function activate(context) {
  output = vscode.window.createOutputChannel('agent-sync');
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.command = 'agent-sync.sync';
  statusItem.text = '$(sync) agent-sync';
  statusItem.show();

  context.subscriptions.push(
    statusItem,
    output,
    vscode.commands.registerCommand('agent-sync.sync', () => sync({ silent: false })),
    vscode.commands.registerCommand('agent-sync.doctor', async () => {
      const config = await loadConfig();
      const checks = await runDoctor({
        syncRoot: config.syncRoot,
        localRoots: syncPairs(config).map((p) => ({ dir: p.localDir })),
      });
      output.clear();
      for (const c of checks) output.appendLine(`${c.status.toUpperCase()}  ${c.name}: ${c.details}`);
      output.show();
    }),
    vscode.commands.registerCommand('agent-sync.link', async () => {
      const cwd = workspaceRoot();
      if (!cwd) return;
      const config = await loadConfig();
      const identity = await ensureIdentity(config, cwd, { write: false });
      vscode.window.showInformationMessage(
        `This folder resolves to ${identity.id} (matched by ${identity.source}).`
      );
    }),
    // Focus regained means another machine may have pushed since we last looked.
    vscode.window.onDidChangeWindowState((s) => {
      if (s.focused) sync({ silent: true });
    })
  );

  sync({ silent: true });
}

export function deactivate() {
  return sync({ silent: true });
}
```

`extension/README.md`: extension'ın ne yaptığı, `agent-sync.syncRoot` ve `agent-sync.machineId` ayarlanmadan çalışmayacağı, ve VSIX kurulum komutu (`code --install-extension agent-sync-vscode-0.1.0.vsix`).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/extension-manifest.test.mjs`
Expected: PASS — 4 tests

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test`
Expected: PASS — all files, 0 failures

```bash
git add extension test/extension-manifest.test.mjs
git commit -m "feat: add VS Code extension frontend over the shared engine"
```

---

## Manual Acceptance (spec kabul kriterleri)

Birim testleri geçtikten sonra, iki gerçek makinede sırayla:

- [ ] `node bin/agent-sync.mjs init --dry-run` üç platformda da ne yapacağını yazar, hiçbir şeye dokunmaz
- [ ] `init` makinede kurulu araçları tespit edip listeler; seçilenler `config.json`'daki `targets`'a yazılır
- [ ] macOS'ta bir skill eklenir → `push` → `<syncRoot>/skills/` altında görünür
- [ ] İkinci makinede `pull` → skill yerelde belirir ve Claude Code onu listeler
- [ ] macOS'ta `~/Desktop/testproj` içinde oturum açılır → marker yazılır, registry'ye kayıt düşer
- [ ] İkinci makinede `C:\dev\testproj` içinde oturum açılır → `folderName` eşleşmesi devreye girer, aynı kimlik benimsenir, hafıza notu orada görünür
- [ ] `targets` içinde `codex` varken `pull` → proje kökünde `AGENTS.md` oluşur, sınırlayıcılar arasında digest bulunur
- [ ] `AGENTS.md`'ye elle bir paragraf eklenir → sonraki `pull` o paragrafı korur, yalnızca blok güncellenir
- [ ] `targets` hem `codex` hem `opencode` içerirken `AGENTS.md` tek kez yazılır
- [ ] Aynı hafıza dosyası iki makinede değiştirilir → iki içerik de korunur, `.conflict-*` dosyası oluşur, `doctor` raporlar
- [ ] `syncRoot` erişilemez hale getirilir → oturum normal açılır, yalnızca uyarı görülür
- [ ] Bir hafıza dosyasına sahte API anahtarı yazılır → `doctor` yakalar
- [ ] `agent-sync run codex` → pull olur, codex etkileşimli çalışır, çıkışta push olur, çıkış kodu korunur
- [ ] Extension VSIX olarak kurulur → durum çubuğunda öğe belirir, son sync zamanını gösterir
- [ ] VS Code penceresi odak kazanır → sync çalışır, kullanıcı hiçbir komut yazmaz
