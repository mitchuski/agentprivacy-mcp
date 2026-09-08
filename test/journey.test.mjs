import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createBundle, foldJourney, inspectJourney, packetProof, validateBundle } from '../lib/journey.mjs';
import { stamp, merkleRoot } from '../lib/kappa.mjs';
import { encode, embedKey, extractKey } from '../lib/png.mjs';
import { pubFromSeed, didKey, recordBytes, sign } from '../lib/sign.mjs';

// Public fixture identity ONLY; never provisioned or used to issue credentials.
const seed = '01'.repeat(32), pub = pubFromSeed(seed);
const H = 'sha256:' + 'a'.repeat(64);
const key = () => stamp({ version: 1, name: 'journey test', palette: {}, descriptions: {}, identity: { publicKeyHex: pub, displayName: 'fixture' }, did: didKey(pub), walks: [], charts: [{ private: 'preserve me' }], extension: { future: true } });
const packet = (overrides = {}) => {
  const p = { v: 1, shopHref: '/forget', vertex: 19, class: 'weapon', witness: 'ZK-witness', ceremony: 'Run · Evoke · Craft', payloadMode: 'sealed', commitment: H,
    ceremonyTrace: [{ phase: 'craft', evidence: H, kind: 'hash' }], bearer: { publicKeyHex: pub }, timestamp: '2026-09-07T12:00:00Z', anchoredTo: H, districtRoot: H, ...overrides };
  p.proof = packetProof(p); return p;
};
const task = () => ({ id: 'fixture-challenge', type: 'https://trusttasks.org/spec/auth/challenge/0.1', payload: { purpose: 'journey-test' } });

test('fold preserves identity, unknown details, originals, lineage, PNG carrier and exact retry', () => {
  const original = key(), p = packet(), b = createBundle(original);
  const r = foldJourney(b, { packet: p });
  assert.equal(b.packets.length, 0); assert.deepEqual(b.key, original);
  assert.equal(r.prior, original.kappa); assert.notEqual(r.kappa, original.kappa);
  for (const field of ['identity', 'did', 'charts', 'walks', 'extension']) assert.deepEqual(r.bundle.key[field], original[field]);
  assert.deepEqual(r.bundle.packets[0], p);
  assert.equal(r.bundle.key.packets.root, merkleRoot([p.proof]));
  assert.equal(JSON.stringify(r.bundle.key).includes('ceremonyTrace'), false);
  assert.equal(JSON.stringify(r.bundle.key).includes('private body'), false);
  const retry = foldJourney(r.bundle, { packet: p });
  assert.equal(retry.changed, false); assert.deepEqual(retry.bundle, r.bundle);
  const png = embedKey(encode(Buffer.alloc(4), 1, 1), r.bundle.key);
  assert.deepEqual(extractKey(png), r.bundle.key);
});

test('task document is retained intact but never treated as verified or authorized', () => {
  const r = foldJourney(createBundle(key()), { taskDocument: task() });
  const report = inspectJourney(r.bundle);
  assert.deepEqual(r.bundle.taskDocuments, [task()]);
  assert.equal(report.taskDocuments[0].verification, 'not-verified');
  assert.equal(report.issuanceAllowed, false); assert.equal(report.qualification, 'not-assessed');
  assert.equal(foldJourney(r.bundle, { taskDocument: task() }).changed, false);
  assert.throws(() => foldJourney(r.bundle, { taskDocument: { ...task(), payload: { purpose: 'substitution' } } }), /id reused/);
});

test('tamper, wrong holder, lossy projection, leaked sealed body and missing originals fail', () => {
  const b = createBundle(key()), p = packet();
  assert.throws(() => foldJourney(b, { packet: { ...p, ceremony: 'changed' } }), /proof mismatch/);
  assert.throws(() => foldJourney(b, { packet: packet({ bearer: { publicKeyHex: '02'.repeat(32) } }) }), /bearer differs/);
  const projection = { ...p }; delete projection.ceremonyTrace;
  assert.throws(() => foldJourney(b, { packet: projection }), /original ceremonyTrace/);
  assert.throws(() => foldJourney(b, { packet: packet({ body: 'private body' }) }), /sealed packet/);
  const folded = foldJourney(b, { packet: p }).bundle;
  assert.throws(() => createBundle(folded.key), /original packets required/);
  assert.throws(() => createBundle({ ...key(), name: 'tampered' }), /kappa mismatch/);
  assert.throws(() => createBundle({ version: 1, kappa: null }), /kappa mismatch/);
  assert.throws(() => createBundle({ version: 1, bad: NaN }), /non-finite/);
});

test('existing packet roots are preserved and cannot be silently replaced', () => {
  const p = packet(), second = packet({ timestamp: '2026-09-07T13:00:00Z' });
  const old = stamp({ ...key(), packets: { count: 1, root: merkleRoot([p.proof]), extra: 'preserve' } });
  const r = foldJourney(createBundle(old, [p]), { packet: second });
  assert.equal(r.bundle.key.packets.extra, 'preserve');
  assert.equal(r.bundle.key.packets.root, merkleRoot([p.proof, second.proof]));
  assert.throws(() => createBundle(old, [second]), /root\/count/);
  assert.throws(() => createBundle(key(), [p, p]), /duplicate packet/);
});

test('catalog and signed record checks stay separate from qualification/freshness', () => {
  const p = packet(), b = foldJourney(createBundle(key()), { packet: p }).bundle;
  const catalog = { district_root: H, artefacts: [{ shop: p.shopHref, proof: H, witness: p.witness, ceremony: p.ceremony, class: p.class, vertex: p.vertex }] };
  const record = { kind: 'agentprivacy.vta/1', publicKeyHex: pub, kappa: b.key.kappa, prior: b.key.prior, at: '2026-09-07T12:00:00Z', walks: 0, vrcs: [] };
  record.sig = sign(seed, recordBytes(record));
  const report = inspectJourney(b, { record, catalog });
  assert.equal(report.keySignature.ok, true); assert.equal(report.artefacts[0].descriptor, 'match');
  assert.equal(report.freshness, 'not-checked'); assert.equal(report.issuanceAllowed, false);
  catalog.artefacts[0].proof = 'sha256:' + 'b'.repeat(64);
  assert.equal(inspectJourney(b, { catalog }).artefacts[0].descriptor, 'mismatch');
  const unbound = foldJourney(createBundle(key()), { packet: packet({ bearer: {} }) }).bundle;
  assert.equal(inspectJourney(unbound).artefacts[0].bearer, 'unavailable');
});

test('changing or dropping a committed task is detected', () => {
  const b = foldJourney(createBundle(key()), { taskDocument: task() }).bundle;
  b.taskDocuments[0].payload.purpose = 'changed';
  assert.throws(() => validateBundle(b), /original unavailable or changed/);
});

test('MCP returns structured journey results and errors, without changing protocol', () => {
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'journey_start', arguments: { key: key() } } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'journey_fold', arguments: { bundle: createBundle(key()), packet: { nope: true } } } },
  ];
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], { input: messages.map(m => JSON.stringify(m)).join('\n') + '\n', encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const replies = r.stdout.trim().split('\n').map(s => JSON.parse(s));
  assert.equal(replies[0].result.tools.filter(t => t.name.startsWith('journey_')).length, 3);
  assert.equal(replies[1].result.structuredContent.kind, 'agentprivacy.journey-bundle/1');
  assert.equal(replies[2].result.isError, true);
});
