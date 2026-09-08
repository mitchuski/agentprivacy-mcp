// The private journey bundle preserves evidence; the City Key carries commitments.
// Folding records an observation, never grants authority or verifies a credential.
import { canonicalJSON, kappaOf, merkleRoot, sha256hex, stamp } from './kappa.mjs';
import { didKey, verifyRecord } from './sign.mjs';

export const BUNDLE_KIND = 'agentprivacy.journey-bundle/1';
const digest = value => 'sha256:' + sha256hex(canonicalJSON(value));
const hash = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const modes = new Set(['sealed', 'revealed', 'refractive', 'composed', 'relational']);
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };

// Only JSON values may enter a commitment. Reject lossy coercions and excessive nesting.
function json(value, depth = 0) {
  requireThat(depth <= 40, 'evidence exceeds nesting limit');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { requireThat(Number.isFinite(value), 'non-finite number'); return; }
  requireThat(typeof value === 'object', 'evidence must contain only JSON values');
  requireThat(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, 'non-JSON object');
  for (const v of Object.values(value)) json(v, depth + 1);
}
const copy = value => { json(value); return JSON.parse(JSON.stringify(value)); };

export function packetProof(packet) {
  const content = copy(packet); delete content.proof; return digest(content);
}

export function checkPacket(packet, key) {
  json(packet);
  requireThat(object(packet) && packet.v === 1, 'expected ProofPacket v1');
  for (const f of ['shopHref', 'class', 'witness', 'ceremony', 'timestamp']) requireThat(typeof packet[f] === 'string' && packet[f].length > 0, 'packet missing ' + f);
  requireThat(Array.isArray(packet.ceremonyTrace), 'original ceremonyTrace required; a graph projection is not a packet');
  requireThat(modes.has(packet.payloadMode), 'unknown packet disclosure mode');
  requireThat(packet.vertex === null || (Number.isInteger(packet.vertex) && packet.vertex >= 0 && packet.vertex < 64), 'invalid packet vertex');
  requireThat(hash(packet.anchoredTo) && hash(packet.districtRoot), 'packet descriptor commitments required');
  requireThat(hash(packet.proof) && packetProof(packet) === packet.proof, 'packet proof mismatch');
  if (packet.payloadMode === 'sealed') {
    requireThat(hash(packet.commitment), 'sealed packet needs a commitment');
    requireThat(!Object.hasOwn(packet, 'body') && !Object.hasOwn(packet, 'publicFacet'), 'sealed packet contains public content');
  }
  const bearer = packet.bearer?.publicKeyHex;
  if (bearer !== undefined) {
    requireThat(typeof bearer === 'string' && /^[a-f0-9]{64}$/i.test(bearer), 'invalid packet bearer key');
    requireThat(typeof key.identity?.publicKeyHex === 'string' && bearer.toLowerCase() === key.identity.publicKeyHex.toLowerCase(), 'packet bearer differs from City Key');
  }
  return { proof: packet.proof, integrity: 'match', bearer: bearer ? 'matches-key-claim' : 'unavailable', qualification: 'not-assessed' };
}

function checkKey(key) {
  json(key);
  requireThat(object(key) && key.version === 1, 'expected City Key v1');
  if (Object.hasOwn(key, 'kappa')) requireThat(hash(key.kappa) && key.kappa === kappaOf(key), 'City Key kappa mismatch');
  const pub = key.identity?.publicKeyHex;
  if (pub !== undefined) {
    requireThat(typeof pub === 'string' && /^[a-f0-9]{64}$/i.test(pub), 'invalid City Key public key');
    if (key.did !== undefined) requireThat(key.did === didKey(pub), 'City Key DID differs from public key');
  }
  if (key.journey !== undefined) requireThat(object(key.journey) && key.journey.version === 1 && Array.isArray(key.journey.steps), 'unsupported journey shape');
}

function checkTask(document) {
  json(document);
  requireThat(object(document) && typeof document.id === 'string' && document.id.length > 0 && object(document.payload), 'expected Trust Task document id and payload');
  requireThat(typeof document.type === 'string' && /^https:\/\/trusttasks\.org\/spec\/[a-z0-9][a-z0-9/-]*\/\d+\.\d+(?:#response)?$/.test(document.type), 'expected versioned registry Trust Task type');
  // This is an opaque document commitment under the City's L5 rule, NOT a
  // framework taskDigest/stepDigest and NOT proof/schema/status verification.
  return { id: document.id, type: document.type, documentCommitment: digest(document) };
}

export function createBundle(key, packets = [], taskDocuments = []) {
  const bundle = { kind: BUNDLE_KIND, key: copy(key), packets: copy(packets), taskDocuments: copy(taskDocuments) };
  validateBundle(bundle);
  return bundle;
}

export function validateBundle(bundle) {
  requireThat(object(bundle) && bundle.kind === BUNDLE_KIND, 'expected private journey bundle');
  checkKey(bundle.key);
  requireThat(Array.isArray(bundle.packets) && Array.isArray(bundle.taskDocuments), 'bundle evidence arrays required');
  requireThat(bundle.packets.length <= 1000 && bundle.taskDocuments.length <= 1000, 'bundle evidence limit exceeded');
  const packets = bundle.packets.map(p => checkPacket(p, bundle.key));
  requireThat(new Set(packets.map(p => p.proof)).size === packets.length, 'duplicate packet proof');
  const declared = bundle.key.packets;
  if (declared !== undefined) {
    requireThat(object(declared) && Number.isInteger(declared.count) && declared.count >= 0, 'invalid key packet summary');
    requireThat(declared.count === packets.length && declared.root === merkleRoot(packets.map(p => p.proof)), 'complete original packets required to match key root/count');
  }
  const tasks = bundle.taskDocuments.map(checkTask);
  requireThat(new Set(tasks.map(t => t.id)).size === tasks.length, 'duplicate Trust Task id');
  const steps = bundle.key.journey?.steps || [];
  requireThat(steps.length <= 2000, 'journey step limit exceeded');
  const ids = new Set();
  for (const step of steps) {
    requireThat(object(step) && hash(step.id) && hash(step.keyBefore) && step.status === 'recorded', 'invalid journey step');
    const content = { ...step }; delete content.id;
    requireThat(digest(content) === step.id && !ids.has(step.id), 'journey step commitment mismatch or duplicate'); ids.add(step.id);
    if (step.kind === 'artefact') requireThat(packets.some(p => p.proof === step.packetProof), 'journey packet original unavailable');
    else if (step.kind === 'trust-task') requireThat(tasks.some(t => t.id === step.taskId && t.type === step.taskType && t.documentCommitment === step.documentCommitment), 'journey task original unavailable or changed');
    else throw new Error('unknown journey step kind');
  }
  return { packets, tasks };
}

/** Append one observed artefact or task document. Retry is an exact no-op. */
export function foldJourney(input, { packet, taskDocument } = {}) {
  validateBundle(input);
  requireThat((packet !== undefined) !== (taskDocument !== undefined), 'supply exactly one packet or taskDocument');
  const bundle = copy(input);
  const keyBefore = kappaOf(bundle.key);
  let entry;
  if (packet !== undefined) {
    checkPacket(packet, bundle.key);
    if (bundle.key.journey?.steps.some(s => s.kind === 'artefact' && s.packetProof === packet.proof)) return { bundle, changed: false, kappa: bundle.key.kappa ?? keyBefore };
    if (!bundle.packets.some(p => p.proof === packet.proof)) bundle.packets.push(copy(packet));
    entry = { kind: 'artefact', status: 'recorded', keyBefore, packetProof: packet.proof, shop: packet.shopHref, vertex: packet.vertex, payloadMode: packet.payloadMode };
    bundle.key.packets = { ...(bundle.key.packets || {}), count: bundle.packets.length, root: merkleRoot(bundle.packets.map(p => p.proof)) };
  } else {
    const ref = checkTask(taskDocument);
    const prior = bundle.taskDocuments.find(t => t.id === ref.id);
    if (prior) requireThat(digest(prior) === ref.documentCommitment, 'Trust Task id reused with different content');
    if (bundle.key.journey?.steps.some(s => s.kind === 'trust-task' && s.taskId === ref.id)) return { bundle, changed: false, kappa: bundle.key.kappa ?? keyBefore };
    if (!prior) bundle.taskDocuments.push(copy(taskDocument));
    entry = { kind: 'trust-task', status: 'recorded', keyBefore, taskId: ref.id, taskType: ref.type, documentCommitment: ref.documentCommitment };
  }
  entry.id = digest(entry);
  bundle.key.journey = { ...(bundle.key.journey || {}), version: 1, steps: [...(bundle.key.journey?.steps || []), entry] };
  bundle.key.prior = keyBefore;
  bundle.key = stamp(bundle.key);
  validateBundle(bundle);
  return { bundle, changed: true, step: entry, prior: keyBefore, kappa: bundle.key.kappa };
}

/** The City's intake view. Never an admission or issuance authorization. */
export function inspectJourney(bundle, { record = null, catalog = null } = {}) {
  const checked = validateBundle(bundle);
  const descriptors = catalog?.artefacts;
  const artefacts = bundle.packets.map((p, i) => {
    const descriptor = Array.isArray(descriptors) ? descriptors.find(d => d.shop === p.shopHref) : null;
    const descriptorState = !catalog ? 'unavailable' : !descriptor ? 'unknown-workshop' :
      descriptor.proof === p.anchoredTo && catalog.district_root === p.districtRoot && descriptor.witness === p.witness && descriptor.ceremony === p.ceremony && descriptor.class === p.class && descriptor.vertex === p.vertex ? 'match' : 'mismatch';
    return { ...checked.packets[i], shop: p.shopHref, descriptor: descriptorState };
  });
  const signature = record ? verifyRecord(record, bundle.key) : { ok: false, why: 'no signed key record supplied' };
  const subject = bundle.key.identity?.publicKeyHex ? didKey(bundle.key.identity.publicKeyHex) : null;
  return { kind: 'agentprivacy.journey-intake/1', kappa: kappaOf(bundle.key), subject,
    steps: bundle.key.journey?.steps.length || 0, artefacts,
    taskDocuments: checked.tasks.map(t => ({ ...t, verification: 'not-verified' })),
    keySignature: signature, freshness: 'not-checked', qualification: 'not-assessed', issuanceAllowed: false,
    next: ['fresh-holder-challenge', 'versioned-task-evaluation', 'authorized-issuer'],
  };
}
