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
