import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as nodeCore from '../lib/journey.mjs';
import { stamp } from '../lib/kappa.mjs';
import { pubFromSeed, didKey } from '../lib/sign.mjs';

const suite = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const spell = path.join(suite, 'spellweb'), master = path.join(suite, 'agentprivacy_master');
const ts = (await import(pathToFileURL(path.join(spell, 'node_modules/typescript/lib/typescript.js')))).default;
const pub = pubFromSeed('01'.repeat(32));
const H = 'sha256:' + 'a'.repeat(64);
const key = stamp({ version: 1, name: 'Test explorer', identity: { publicKeyHex: pub }, did: didKey(pub), palette: {}, descriptions: {}, lit: [19], future: { preserve: true } });
const packet = { v: 1, shopHref: '/forget', vertex: 19, class: 'weapon', witness: 'ZK-witness', ceremony: 'Run · Evoke · Craft', payloadMode: 'sealed', commitment: H, ceremonyTrace: [{ phase: 'craft', kind: 'hash', evidence: H }], bearer: { publicKeyHex: pub }, timestamp: '2026-09-07T12:00:00Z', anchoredTo: H, districtRoot: H };
packet.proof = nodeCore.packetProof(packet);
const task = { id: 'example-invitation', type: 'https://trusttasks.org/spec/vtc/invitations/issue/0.1', payload: { subjectDid: key.did, role: 'participant', validityDays: 7 } };

test('browser rules and game modules carry master → Spellweb strike → task → master without losing originals', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'journey-browser-test-'));
  const saved = { window: globalThis.window, localStorage: globalThis.localStorage, CustomEvent: globalThis.CustomEvent };
  try {
    for (const name of ['journey-core.js', 'journey-core.d.ts', 'journey-store.ts']) assert.equal(fs.readFileSync(path.join(master, 'src/lib', name), 'utf8'), fs.readFileSync(path.join(spell, 'src/lib', name), 'utf8'), name + ' drift');
    fs.copyFileSync(path.join(spell, 'src/lib/journey-core.js'), path.join(temp, 'journey-core.mjs'));
    for (const [base, source, output] of [
      [spell, 'src/lib/journey-store.ts', 'journey-store'], [spell, 'src/types/graph.ts', 'graph'],
      [spell, 'src/lib/cityKey.ts', 'cityKey'], [spell, 'src/lib/cityKeyJourney.ts', 'cityKeyJourney'],
      [spell, 'src/lib/proofPackets.ts', 'proofPackets'], [master, 'src/lib/city-key-journey.ts', 'city-key-journey'],
      [master, 'src/lib/proof-packets-store.ts', 'proof-packets-store'],
      [master, 'src/lib/proof-packet-digest.ts', 'proof-packet-digest'],
    ]) {
      let code = ts.transpileModule(fs.readFileSync(path.join(base, source), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
      code = code.replace(/from '([^']+)'/g, (_, dep) => "from './" + dep.split('/').at(-1) + ".mjs'");
      fs.writeFileSync(path.join(temp, output + '.mjs'), code);
    }
    const storage = new Map();
    let failQuota = false;
    globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k,v) => { if (failQuota) throw Error('quota'); storage.set(k,v); } };
    globalThis.window = { localStorage, dispatchEvent() {} };
    globalThis.CustomEvent = class {};
    const load = name => import(pathToFileURL(path.join(temp, name + '.mjs')));
    const B = await load('journey-core'), S = await load('journey-store'), K = await load('cityKey'), P = await load('proofPackets');
    const F = await load('cityKeyJourney'), M = await load('city-key-journey'), PS = await load('proof-packets-store');
    assert.deepEqual(await B.createBundle(key), nodeCore.createBundle(key));
    const expected = nodeCore.foldJourney(nodeCore.createBundle(key), { packet });
    assert.deepEqual(await B.foldJourney(await B.createBundle(key), { packet }), expected);
    await assert.rejects(B.createBundle({ ...key, name: 'tampered' }), /kappa mismatch/);
    await assert.rejects(B.createBundle(expected.bundle.key), /original packets/);
    await assert.rejects(B.foldJourney(await B.createBundle(key), { packet: { ...packet, commitment: 'bad' } }), /proof mismatch/);
    PS.addProofPacket(packet); // The actual workshop store, consumed by the master export.
    const fromMaster = await M.prepareCityJourney(key);
    nodeCore.validateBundle(fromMaster);
    assert.equal(fromMaster.key.journey.steps.length, 1);
    const repeat = await M.prepareCityJourney(key);
    assert.deepEqual(repeat, fromMaster, 're-export is an exact no-op');
    // Move to a separate browser origin via a private bundle, then strike the key.
    storage.clear();
    await S.adoptJourney(fromMaster);
    const adopted = await K.importKeyJSON(JSON.stringify(fromMaster.key));
    K.saveKey(adopted.key);
    P.ingestPacketsPayload({ kind: 'spellweb.bearer.packets', packets: fromMaster.packets });
    const struck = await K.foldCharge(K.loadKey(), { id: 'explore-v20', label: 'Read a spell', source: 'fixture', vertex: 20, weight: 1, foldedAt: '2026-09-07T13:00:00Z' });
    K.saveKey(struck);
    const afterStrike = await F.foldActiveJourney();
    assert.equal(afterStrike.key.journey.steps.length, 1);
    const withTask = await F.foldActiveJourney([], [task]);
    assert.equal(withTask.key.journey.steps.length, 2);
    assert.deepEqual(withTask.taskDocuments, [task]);
    assert.deepEqual(K.loadKey().charges, struck.charges, 'journey fold does not mint game charges');
    assert.deepEqual((await F.foldActiveJourney([], [task])).key, withTask.key, 'task retry is idempotent');
    const changedTask = { ...task, payload: { changed: true } };
    await assert.rejects(F.foldActiveJourney([], [changedTask]), /id reused/);
    await assert.rejects(S.carryJourney(fromMaster.key), /predates/);
    storage.clear();
    await S.adoptJourney(withTask);
    const home = await M.prepareCityJourney(key);
    nodeCore.validateBundle(home);
    assert.deepEqual(home.key.future, key.future);
    assert.equal(home.key.journey.steps.length, 2);
    assert.deepEqual(home.packets, [packet]);
    assert.deepEqual(home.taskDocuments, [task]);
    assert.deepEqual(home.key.charges, withTask.key.charges);
    assert.equal(nodeCore.inspectJourney(home).issuanceAllowed, false);
    await assert.rejects(M.prepareCityJourney({ ...key, identity: { publicKeyHex: '02'.repeat(32) } }), /another identity/);
    const before = S.loadJourney();
    failQuota = true;
    await assert.rejects(S.adoptJourney(home), /quota/);
    assert.deepEqual(S.loadJourney(), before);
    failQuota = false;
    storage.clear();
    await S.adoptJourney(nodeCore.createBundle(key, [packet], [task]));
    const unindexed = await S.carryJourney(key);
    assert.equal(unindexed.key.journey.steps.length, 2, 'originals from an initial CLI bundle gain steps without being dropped');
    assert.deepEqual(unindexed.packets, [packet]);
    assert.deepEqual(unindexed.taskDocuments, [task]);
  } finally {
    Object.assign(globalThis, saved);
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
