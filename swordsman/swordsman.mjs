#!/usr/bin/env node
// swordsman/swordsman.mjs — the Swordsman ⚔️: a separate process that holds the
// bearer's private key and signs what it is handed, AFTER A FIXED POLICY CHECK.
// No LLM in the loop. Page content is untrusted input; a Mage that reads a
// hostile page can be talked into REQUESTING a bad signature — it cannot talk
// this process into GRANTING one. That separation is Φ_agent as a security
// property (plan Phase 4), built here at Rung 1 scale.
//
//   node swordsman/swordsman.mjs init [--seed <hex>] [--card <AgentCard.json>] [--force]
//   node swordsman/swordsman.mjs status
//   node swordsman/swordsman.mjs                   # speak MCP on stdin/stdout (write tools)
//   claude mcp add swordsman -- node C:/Users/mitch/agentprivacy-mcp/swordsman/swordsman.mjs
//
// Keystore: $AGENTPRIVACY_HOME/swordsman/ (default ~/.agentprivacy/swordsman/)
//   identity.json   { publicKeyHex, participantId, did, seedHex, createdAt, card? }  — the ONLY secret
//   policy.json     the fixed policy (copied from swordsman/policy.json on init)
//   ledger.jsonl    every signature: { at, kappa, prior, sig, participantId }
//
// Identity weaves with the rest of the City: `--seed` takes the ceremony's
// privateKeyHex (agentprivacy /ceremony keeps it in sessionStorage), so this
// Swordsman IS the bearer's AgentCard identity — the one mages.city admits.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { kappaOf, verifyKappa, stamp } from '../lib/kappa.mjs';
import { isCityKey, parseKeyInput } from '../lib/key.mjs';
import { VTA_KIND, pubFromSeed, participantId, didKey, sign, recordBytes, verifyRecord, isHex } from '../lib/sign.mjs';
import { embedKey, withTextChunk } from '../lib/png.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME = path.join(process.env.AGENTPRIVACY_HOME || path.join(os.homedir(), '.agentprivacy'), 'swordsman');
const F = { id: path.join(HOME, 'identity.json'), policy: path.join(HOME, 'policy.json'), ledger: path.join(HOME, 'ledger.jsonl') };
const VERSION = '0.1.0';

const readJSON = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const ledger = () => fs.existsSync(F.ledger) ? fs.readFileSync(F.ledger, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const head = () => { const L = ledger(); return L.length ? L[L.length - 1] : null; };
const policy = () => fs.existsSync(F.policy) ? readJSON(F.policy) : readJSON(path.join(HERE, 'policy.json'));
function identity() { if (!fs.existsSync(F.id)) throw new Error(`no Swordsman identity at ${HOME} — run: node swordsman/swordsman.mjs init`); return readJSON(F.id); }
const publicIdentity = id => ({ publicKeyHex: id.publicKeyHex, participantId: id.participantId, did: id.did, createdAt: id.createdAt, card: id.card ? { displayName: id.card.displayName, trustTier: id.card.trustTier } : null });

// ---- init -----------------------------------------------------------------------------
function init(args) {
  const seedArg = (args.find(a => a.startsWith('--seed=')) || '').slice(7) || (args.includes('--seed') ? args[args.indexOf('--seed') + 1] : null);
  const cardArg = (args.find(a => a.startsWith('--card=')) || '').slice(7) || (args.includes('--card') ? args[args.indexOf('--card') + 1] : null);
  if (fs.existsSync(F.id) && !args.includes('--force')) { console.error(`identity exists at ${F.id} (use --force to replace — the old key is gone for good)`); process.exit(1); }
  const seedHex = seedArg ? seedArg.toLowerCase() : crypto.randomBytes(32).toString('hex');
  if (!isHex(seedHex, 64)) { console.error('--seed must be 32 bytes hex (the ceremony\'s privateKeyHex)'); process.exit(1); }
  const publicKeyHex = pubFromSeed(seedHex);
  let card = null;
  if (cardArg) {
    card = readJSON(cardArg);
    if ((card.publicKeyHex || '').toLowerCase() !== publicKeyHex) { console.error(`the card's publicKeyHex (${card.publicKeyHex}) is not this seed's (${publicKeyHex})`); process.exit(1); }
  }
  fs.mkdirSync(HOME, { recursive: true });
  const id = { kind: 'agentprivacy.swordsman-identity/1', publicKeyHex, participantId: participantId(publicKeyHex), did: didKey(publicKeyHex), seedHex, createdAt: new Date().toISOString(), card };
  fs.writeFileSync(F.id, JSON.stringify(id, null, 1), { mode: 0o600 });
  if (!fs.existsSync(F.policy)) fs.copyFileSync(path.join(HERE, 'policy.json'), F.policy);
  if (!fs.existsSync(F.ledger)) fs.writeFileSync(F.ledger, '');
  console.log(`⚔️ Swordsman identity ${seedArg ? 'imported' : 'minted'} at ${HOME}\n   participantId ${id.participantId}\n   did           ${id.did}\n   public key    ${publicKeyHex}${card ? `\n   card          ${card.displayName} · ${card.trustTier}` : ''}`);
  console.log('   the seed never leaves identity.json; back it up as you would a wallet.');
}

// ---- the policy check, then the signature -----------------------------------------------
function signKey(input) {
  const id = identity(), P = policy();
  const p = parseKeyInput(input); if (p.error) return { refused: p.error };
  let key = p.key;
  if (!isCityKey(key)) return { refused: 'not a City Key v1' };
  // L5 — the key must be what it says
  const v = verifyKappa(key);
  if (v.verdict === 'mismatch') return { refused: `κ mismatch: stamped ${v.stamped.slice(0, 23)}… re-derives to ${v.derived.slice(0, 23)}…` };
  if (v.verdict === 'unlabelled') key = stamp(key);
  // own bearer only
  if (P.signOnlyOwnBearer && key.identity?.publicKeyHex && key.identity.publicKeyHex.toLowerCase() !== id.publicKeyHex)
    return { refused: `a Swordsman signs only its bearer's key (key names ${key.identity.publicKeyHex.slice(0, 16)}…, this is ${id.publicKeyHex.slice(0, 16)}…)` };
  // no history rewrites: prior must be the ledger head
  const H = head();
  if (P.signOnlyChainedEvolutions && H) {
    if (key.kappa === H.kappa) return { refused: `already signed: ${H.kappa.slice(0, 23)}… is the ledger head (unchanged content, no new signature)` };
    if ((key.prior ?? null) !== H.kappa) return { refused: `prior ${String(key.prior).slice(0, 23)}… is not the ledger head ${H.kappa.slice(0, 23)}… — sign each evolution, or re-evolve from the signed key` };
  }
  if (!H && !P.allowGenesisWithPrior && key.prior) return { refused: 'genesis signature must have no prior' };
  // no unbaked steps (a page the bake does not know is a page the auditor cannot re-derive)
  if (P.refuseUnbakedSteps) for (const w of (key.walks || [])) for (const st of (w.steps || [])) if (st.unbaked) return { refused: `walk step ${st.slug} is not in the bake` };
  // rate limit — a runaway Mage cannot mint a lineage
  const minuteAgo = Date.now() - 60e3, recent = ledger().filter(l => new Date(l.at).getTime() > minuteAgo).length;
  if (recent >= (P.maxSignaturesPerMinute || 6)) return { refused: `rate limit: ${recent} signatures in the last minute (policy ${P.maxSignaturesPerMinute})` };

  const rec = { kind: VTA_KIND, publicKeyHex: id.publicKeyHex, participantId: id.participantId, did: id.did,
    kappa: key.kappa, prior: key.prior ?? null, at: new Date().toISOString(), walks: (key.walks || []).length, vrcs: [] };
  rec.sig = sign(id.seedHex, recordBytes(rec));
  // the ledger keeps the whole signed record — it is public data (what a VTA
  // publishes), and the head must be re-publishable verbatim
  fs.appendFileSync(F.ledger, JSON.stringify(rec) + '\n');
  return { key, vta: rec, ledgerHead: rec.kappa, ledgerLength: ledger().length, verified: verifyRecord(rec, key).ok };
}

// what a VTA publishes: the record, and the `proofs` page item for a mages.city resident site
function publish(input) {
  let rec;
  if (input != null) { const r = signKey(input); if (r.refused) return r; rec = r.vta; }
  else { const H = head(); if (!H) return { refused: 'nothing signed yet — hand me a key first' };
    rec = H; if (!verifyRecord(rec).ok) return { refused: 'the ledger head does not verify — the ledger was edited' }; }
  const proofs = { v: 1, packets: [], cityKey: { kappa: rec.kappa, prior: rec.prior, did: rec.did, publicKeyHex: rec.publicKeyHex, signedAt: rec.at, vta: rec }, swordsmansKey: null, drakeOrb: null };
  return { vta: rec, did: rec.did, publishes: ['publicKeyHex', 'kappa', 'prior', 'vrcs (commitments)'], withholds: ['the key', 'the walk', 'the seed'],
    proofsPageItem: { type: 'code', text: JSON.stringify(proofs, null, 2) },
    residentPage: 'proofs', note: 'paste proofsPageItem onto <name>.mages.city/proofs — the board reads cityKey.vta and verifies it with lib/sign.mjs verifyRecord; liveness = evolved_since(t) over signedAt' };
}

// ---- MCP over stdio (write tools) --------------------------------------------------------
const keyProp = { anyOf: [{ type: 'object' }, { type: 'string' }], description: 'City Key JSON, or a string holding JSON / a sigil PNG (base64) / a path' };
const TOOLS = [
  { name: 'key_sign', title: 'key.sign', description: 'Sign a City Key evolution under the fixed policy: κ must re-derive (L5), the key must name this bearer (or no bearer), its prior must be the ledger head (no history rewrites), no unbaked steps, rate-limited. Returns the key (κ stamped) and the signed VTA record. Refusals say why.',
    inputSchema: { type: 'object', properties: { key: keyProp }, required: ['key'] }, run: ({ key }) => signKey(key) },
  { name: 'vta_publish', title: 'vta.publish', description: 'What this VTA publishes (plan Phase 5): bearer public key, current κ, prior, VRC commitments — never the key or the walk. With a key: signs it first. Returns the record and a ready `proofs` page item for a mages.city resident site.',
    inputSchema: { type: 'object', properties: { key: keyProp } }, run: ({ key }) => publish(key ?? null) },
  { name: 'sigil_seal', title: 'sigil.seal (carrier with signature)', description: 'Given a sigil PNG (base64 / path) and a signed VTA record, write the record into the image as a second text chunk (cityKeySig) so the picture carries both the key and its signature. Returns the PNG.',
    inputSchema: { type: 'object', properties: { png: { type: 'string' }, vta: { type: 'object' }, out: { type: 'string' } }, required: ['png', 'vta'] },
    run: ({ png, vta, out }) => { let buf = fs.existsSync(png) ? fs.readFileSync(png) : Buffer.from(png.replace(/^data:image\/png;base64,/, ''), 'base64');
      const v = verifyRecord(vta); if (!v.ok) return { refused: v.why };
      buf = withTextChunk(buf, 'cityKeySig', Buffer.from(JSON.stringify(vta)).toString('base64'));
      if (out) fs.writeFileSync(out, buf); return { bytes: buf.length, wrote: out ? path.resolve(out) : null, _image: buf.toString('base64') }; } },
  { name: 'policy_show', title: 'policy.show', description: 'The fixed policy this Swordsman enforces, and the ledger head. Read-only.',
    inputSchema: { type: 'object', properties: {} }, run: () => ({ policy: policy(), ledgerHead: head(), ledgerLength: ledger().length, identity: publicIdentity(identity()) }) },
];
const byName = Object.fromEntries(TOOLS.map(t => [t.name, t]));
const send = m => process.stdout.write(JSON.stringify(m) + '\n');
function callTool(name, args) {
  const t = byName[name]; if (!t) return { content: [{ type: 'text', text: `unknown tool ${name}` }], isError: true };
  let out; try { out = t.run(args || {}); } catch (e) { return { content: [{ type: 'text', text: `${name}: ${e.message}` }], isError: true }; }
  const content = [];
  if (out && out._image) { content.push({ type: 'image', data: out._image, mimeType: 'image/png' }); out = { ...out }; delete out._image; }
  content.unshift({ type: 'text', text: JSON.stringify(out, null, 1) });
  return { content, structuredContent: out, isError: !!(out && (out.error || out.refused)) };
}
function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: ['2025-06-18', '2025-03-26', '2024-11-05'].includes(params?.protocolVersion) ? params.protocolVersion : '2025-06-18',
    capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'agentprivacy-swordsman', version: VERSION },
    instructions: 'The Swordsman ⚔️ signs City Key evolutions under a fixed policy it will not argue about. Hand it a key (key_sign); it returns the signed VTA record or a refusal with the reason. vta_publish gives the record a mages.city resident page carries. It holds the seed; it never returns it.' } });
  if (method?.startsWith('notifications/')) return;
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS.map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema })) } });
  if (method === 'tools/call') return send({ jsonrpc: '2.0', id, result: callTool(params?.name, params?.arguments) });
  if (method === 'resources/list') return send({ jsonrpc: '2.0', id, result: { resources: [] } });
  if (method === 'prompts/list') return send({ jsonrpc: '2.0', id, result: { prompts: [] } });
  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } });
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'init') init(rest);
else if (cmd === 'status' || cmd === '--list') {
  try { const id = identity(); console.log(JSON.stringify({ home: HOME, ...publicIdentity(id), ledgerLength: ledger().length, ledgerHead: head()?.kappa || null, policy: policy() }, null, 1)); } catch (e) { console.error(e.message); process.exit(1); }
} else {
  try { identity(); } catch (e) { console.error(e.message); process.exit(1); }
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', line => { line = line.trim(); if (!line) return; let m; try { m = JSON.parse(line); } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); } Array.isArray(m) ? m.forEach(handle) : handle(m); });
  rl.on('close', () => process.exit(0));
}
