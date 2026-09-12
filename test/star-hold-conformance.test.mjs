// test/star-hold-conformance.test.mjs — the conformance pack a receiving
// implementation locks to (hearthold #90 / PR #92) is deterministic, self-checks
// with its zero-dependency verify.mjs, and stays consistent with the runtime
// fixture the rest of the suite verifies. Run: node --test test/star-hold-conformance.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { kappaOf, merkleRoot } from '../lib/kappa.mjs';
import { verifyRecord } from '../lib/sign.mjs';
import { extractKey } from '../lib/png.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const PACK = path.join(ROOT, 'fixtures', 'star-hold-conformance');
const read = (f) => JSON.parse(fs.readFileSync(path.join(PACK, f), 'utf8'));

test('the pack regenerates byte-for-byte (--check) and its own checker passes', () => {
  const gen = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'star-hold-conformance.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(gen.status, 0, gen.stdout + gen.stderr);
  const chk = spawnSync(process.execPath, [path.join(PACK, 'verify.mjs')], { encoding: 'utf8' });
  assert.equal(chk.status, 0, chk.stdout + chk.stderr);
  assert.match(chk.stdout, /\d+ passed, 0 failed/);
});

test('the full City Key, its Hold root and the runtime fixture agree; the test record and the farm record verify with lib/sign.mjs', () => {
  const runtime = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'star-hold.fixture.json'), 'utf8'));
  const city = read('city-key.fixture.json');
  const full = city.cases.find((c) => c.id === 'full');
  assert.equal(full.kappa, runtime.expected.kappa);
  assert.equal(kappaOf(full.key), runtime.expected.kappa);
  assert.equal(city.merkle.holdVector.root, runtime.expected.root);
  assert.equal(merkleRoot(city.merkle.packetsVector.leaves), 'sha256:07f20f689c8bef2d8a9a2a71d94e7014ea8398cc603b0ff72dadba5c517983d1');
  const vr = read('vta-record.fixture.json');
  for (const r of vr.records) assert.equal(verifyRecord(r.record).ok ? 'valid' : 'invalid', r.expect, r.id);
  assert.equal(vr.records.find((r) => r.id === 'test-full-key').record.kappa, full.kappa);
  assert.equal(vr.testKey.seedHex, '01'.repeat(32));
});

test('every PNG carrier unfolds the full key and the signed one carries a verifying record over that κ', () => {
  const pf = read('png-carrier.fixture.json');
  const city = read('city-key.fixture.json');
  const full = city.cases.find((c) => c.id === 'full');
  for (const f of pf.files) {
    const key = extractKey(fs.readFileSync(path.join(PACK, f.file)));
    assert.equal(kappaOf(key), full.kappa, f.file);
  }
});
