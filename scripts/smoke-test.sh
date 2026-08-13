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
SLUG="$(cd "$SB/proj" && node -e "import('$REPO/src/paths.mjs').then(m=>console.log(m.slugForPath(process.cwd())))")"
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
SLUG_B="$(cd "$SB/elsewhere/dev/proj" && node -e "import('$REPO/src/paths.mjs').then(m=>console.log(m.slugForPath(process.cwd())))")"
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
