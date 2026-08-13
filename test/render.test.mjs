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
