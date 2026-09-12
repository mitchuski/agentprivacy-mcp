#!/usr/bin/env node
// agentprivacy-mcp — the guide, the lattice and the City Key as MCP tools.
// Phase 3 (read tools) of agentprivacy_master/docs/PLAN_KNOWLEDGE_GRAPH_TO_VTA_2026-09-03.md
//
// Every tool is a pure function over a City Key or a graph snapshot: an agent
// can compose them and a human can audit the composition. These are the MAGE
// tools — read the graph, derive, evolve, render. Nothing here holds a secret.
// The Swordsman's write tools (sign · seal · psi · prove · vrc) arrive with the
// crypto rungs and run as a separate process without an LLM in the loop.
//
// Transport: MCP over stdio (newline-delimited JSON-RPC 2.0). Zero dependencies.
//   node server.mjs                      # speak MCP on stdin/stdout
//   claude mcp add agentprivacy -- node C:/Users/mitch/agentprivacy-mcp/server.mjs
// Env:  AGENTPRIVACY_GUIDE_SITE  the baked site dir (default ~/agentprivacy.guide/site)
//       VTA_MODE=1               hide compare_plain (the ∩ must come from PSI, not from reading both keys)
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import * as L from './lib/lattice.mjs';
import * as B from './lib/bake.mjs';
import { createSiteContextTools } from './lib/site-context.mjs';
import * as K from './lib/key.mjs';
import { render } from './lib/sigil.mjs';
import { verifyRecord, evolvedSince, didKey, verifyCard } from './lib/sign.mjs';
import { verifyHold, projectHold } from './lib/hold.mjs';
import { readTextChunks } from './lib/png.mjs';
import { createBundle, foldJourney, inspectJourney } from './lib/journey.mjs';
import { prepareBrowserAction } from './lib/browser-action.mjs';
import {cityInvitationDraft,experienceRoute,experienceOverview} from './lib/city-entry.mjs';

const VERSION = '0.2.0';
const VTA = process.env.VTA_MODE === '1';
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];

// ---- the tools ------------------------------------------------------------------
const keyArg = { type: 'object', description: 'A City Key v1 as a JSON object, or a string holding JSON, a sigil PNG (base64 / data: URL), or a path to either.' };
const keyProp = { anyOf: [keyArg, { type: 'string' }] };
const TOOLS = [
  {name:'experience_overview',title:'experience.overview',description:'Start here: source capability inventory for City invitation, Star/key custody, learning, browser actions, agreements and scoped access. Distinguishes implemented local tools from pending live services and design proposals. Not live discovery or authorization.',inputSchema:{type:'object',additionalProperties:false,properties:{}},run:()=>experienceOverview()},
  {name:'city_invitation_draft',title:'city.invitation.draft',description:'Prepare a PRIVATE draft of a City Portal invitation, offer, request or visitor mark. publish stays false; this does not sign, send, admit, issue a credential or create a MyTerms agreement. Supply only a summary the keeper may choose to make public.',inputSchema:{type:'object',additionalProperties:false,properties:{summary:{type:'string',maxLength:500},action:{type:'string',enum:['mark','invitation','offer','request']},target:{type:'string'}},required:['summary']},run:args=>cityInvitationDraft(args)},
  {name:'experience_route',title:'experience.route',description:'Find existing site entry points and MCP tool sequences for arrival, learning, key custody, casting and collaboration. Static guidance only; it does not discover live services or transmit your key.',inputSchema:{type:'object',properties:{intent:{type:'string',enum:['arrive','learn','carry','cast','collaborate']}},required:['intent']},run:args=>experienceRoute(args)},
  ...createSiteContextTools(),
  { name: 'browser_action_prepare', title: 'browser.action.prepare',
    description: 'Prepare a short-lived spell/sticker proposal for explicit extension review. Does not connect to a browser, authorize, cast, place, issue credentials or earn mana. Reuse operationId for the same logical action. Do not include secrets in page URLs or target IDs.',
    inputSchema: {type:'object',additionalProperties:false,properties:{operationId:{type:'string'},subject:{type:'string'},audience:{type:'string'},page:{type:'string'},action:{type:'string',enum:['spell.cast','sticker.place']},target:{type:'string'},contentDigest:{type:'string'},expiresAt:{type:'string'}},required:['operationId','subject','audience','page','action','target','contentDigest','expiresAt']},
    run: args => prepareBrowserAction(args) },
  { name: 'journey_start', title: 'journey.start',
    description: 'Create a PRIVATE journey bundle from a City Key and its complete original packets. Preserves evidence outside the key; no network, signing or credential issuance.',
    inputSchema: { type: 'object', properties: { key: keyProp, packets: { type: 'array', items: { type: 'object' } }, taskDocuments: { type: 'array', items: { type: 'object' } } }, required: ['key'] },
    run: ({ key, packets = [], taskDocuments = [] }) => { const p = K.parseKeyInput(key); if (p.error) return p; return createBundle(p.key, packets, taskDocuments); } },
  { name: 'journey_fold', title: 'journey.fold',
    description: 'Fold one original artefact packet OR observed Trust Task document into the City Key journey. Returns the private bundle and evolved key with κ/prior. Exact retry is a no-op. Recorded tasks are NOT verified credentials; send only material the holder chose to disclose to this agent.',
    inputSchema: { type: 'object', properties: { bundle: { type: 'object' }, packet: { type: 'object' }, taskDocument: { type: 'object' } }, required: ['bundle'], oneOf: [{ required: ['packet'], not: { required: ['taskDocument'] } }, { required: ['taskDocument'], not: { required: ['packet'] } }] },
    run: ({ bundle, packet, taskDocument }) => foldJourney(bundle, { packet, taskDocument }) },
  { name: 'journey_inspect', title: 'journey.inspect',
    description: 'Read the City journey evidence inventory: integrity, bearer claims, optional signed key record, and pending checks. Never authorizes issuance. Does not verify Trust Task proofs, freshness or comprehension.',
    inputSchema: { type: 'object', properties: { bundle: { type: 'object' }, record: { type: 'object' } }, required: ['bundle'] },
    run: ({ bundle, record }) => inspectJourney(bundle, { record }) },
  { name: 'guide_search', title: 'guide.search',
    description: 'Search the guide (the baked fedwiki federation, 20 sites). Returns an ORDERED WALK of pages — BM25 over the baked lexical index, then link-graph expansion — each step with its site, slug, lattice vertex and PSI element. The agent reads the bake, never the live farm, so a walk is reproducible.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 24, default: 9 },
      sites: { type: 'array', items: { type: 'string' }, description: 'restrict to chart site ids (guide, atlas, skill, dtg, …)' } }, required: ['query'] },
    run: ({ query, limit = 9, sites = [] }) => B.search(query, { limit, sites }) },
  { name: 'guide_page', title: 'guide.page',
    description: 'One page by slug (site optional — identity is the slug, never the host): its text, weave (links), lattice vertex + six-bit posture, PSI element and public URL.',
    inputSchema: { type: 'object', properties: { slug: { type: 'string' }, site: { type: 'string' } }, required: ['slug'] },
    run: ({ slug, site }) => { const rec = B.resolve(slug, site); if (!rec) return { error: `no baked page "${slug}"${site ? ' on ' + site : ''}` };
      const copies = (B.load().bySlug.get(slug) || []).map(r => r.site);
      return { ...B.summary(rec), by: rec.by, forkedFrom: rec.forkedFrom, priorVertex: rec.priorVertex ?? null, dims: L.dimsOf(rec.vertex), stratum: L.popcount(rec.vertex),
        weave: rec.links, copies, reading: L.reading(rec.vertex), ...B.pageText(rec) }; } },
  { name: 'guide_neighbours', title: 'guide.neighbours',
    description: 'Linked pages (outgoing and backlinks) of a page, each with the NAMED LATTICE MOVE from this page to it: succ · neg · bnot · flip <dimension> · jump ×k (dimensions), per the 64-vertex sovereignty lattice.',
    inputSchema: { type: 'object', properties: { slug: { type: 'string' }, site: { type: 'string' } }, required: ['slug'] },
    run: ({ slug, site }) => { const rec = B.resolve(slug, site); if (!rec) return { error: `no baked page "${slug}"` };
      return { from: B.summary(rec), neighbours: B.neighbours(rec) }; } },
  { name: 'lattice_move', title: 'lattice.move',
    description: 'Apply a lattice operator to a vertex (0-63): succ (the wheel, +1 mod 64), neg (Swordsman reflection, 64−x), bnot (Mage antipode, 63−x), "flip <dimension>" (one bit), or "to <vertex>" (names the move). Returns the resulting vertex, its six bits (d1 protection … d6 value), dimensions, stratum, and a derived reading.',
    inputSchema: { type: 'object', properties: { vertex: { type: 'integer', minimum: 0, maximum: 63 }, op: { type: 'string', description: 'succ | neg | bnot | flip <dim> | to <vertex>' } }, required: ['vertex', 'op'] },
    run: ({ vertex, op }) => {
      if (!L.isVertex(vertex)) return { error: 'vertex must be 0-63' };
      const o = String(op).trim().toLowerCase(); let to;
      if (L.OPS[o]) to = L.OPS[o](vertex);
      else if (o.startsWith('flip')) { const r = L.vertexFromDims([o.slice(4).trim()]); if (r.error) return r; to = vertex ^ r.vertex; }
      else if (o.startsWith('to')) { to = L.parsePosture(o.slice(2).trim()); if (to == null) return { error: 'to <vertex|bits|dims>' }; }
      else return { error: 'op must be succ | neg | bnot | flip <dim> | to <vertex>' };
      const mv = L.moveName(vertex, to);
      return { from: vertex, to, bits: L.bits(to), dims: L.dimsOf(to), stratum: L.popcount(to), move: L.moveLabel(mv), flipped: mv.flipped, reading: L.reading(to) }; } },
  { name: 'key_derive', title: 'key.derive',
    description: 'Law L5 — a κ is never trusted, only re-derived. Canonical form (keys sorted recursively, no whitespace, kappa excluded) → sha256 → compare with the stamped κ. Accepts a City Key JSON or a sigil PNG (the image carries the key). Returns verdict, derived κ, prior, the 64 glyphs, lit and walked vertices.',
    inputSchema: { type: 'object', properties: { key: keyProp }, required: ['key'] },
    run: ({ key }) => { const p = K.parseKeyInput(key); if (p.error) return p; return { carrier: p.carrier, ...K.derive(p.key) }; } },
  { name: 'key_evolve', title: 'key.evolve',
    description: 'Append a walk to a City Key — pure and deterministic. Walk = an array of {site?, slug} steps (or slugs), a pathway.v1, or a star-chart constellation. Each step is resolved against the bake to its vertex and PSI element; the evolved key gains walks[], prior = κ of the key it grew from, and a fresh κ. UNSIGNED — a Swordsman signs (Rung 1). Omit key to start from the default key.',
    inputSchema: { type: 'object', properties: { key: keyProp, walk: { description: 'steps: [{site, slug}] | [slug] | {steps:[…]}', anyOf: [{ type: 'array' }, { type: 'object' }, { type: 'string' }] },
      name: { type: 'string', description: 'name this walk (a constellation name)' } }, required: ['walk'] },
    run: ({ key, walk, name }) => { let k = K.defaultKey();
      if (key != null) { const p = K.parseKeyInput(key); if (p.error) return p; k = p.key; }
      if (typeof walk === 'string') { try { walk = JSON.parse(walk); } catch { walk = walk.split(/[\s,]+/).filter(Boolean); } }
      return K.evolve(k, walk, { name }); } },
  { name: 'sigil_render', title: 'sigil.render',
    description: 'Draw the key\'s sigil — 64 glyphs, one per vertex, lit by the RE-DERIVED κ (never the stamped claim), coloured by the key\'s palette by stratum; lit vertices ring coral, walked vertices ring cyan — as a PNG that CARRIES the key (tEXt cityKey), importable on soulbis.com/star, /lattice, /sigil. Returns the image; writes it to `out` when given.',
    inputSchema: { type: 'object', properties: { key: keyProp, out: { type: 'string', description: 'file path to write the PNG' }, size: { type: 'integer', minimum: 128, maximum: 2048, default: 512 } }, required: ['key'] },
    run: ({ key, out, size = 512 }) => { const p = K.parseKeyInput(key); if (p.error) return p;
      const r = render(p.key, { size }); let wrote = null;
      if (out) { fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(out, r.png); wrote = path.resolve(out); }
      return { kappa: r.kappa, glyphs: r.glyphs, lit: r.lit, walked: r.walked, size: r.size, bytes: r.png.length, wrote, _image: r.png.toString('base64') }; } },
  { name: 'key_verify', title: 'key.verify (Rung 1, public)',
    description: 'Verify a signed VTA record (kind agentprivacy.vta/1: bearer public key, κ, prior, at, walks, vrcs, ed25519 sig) — and, when the key is given, that the record names THIS key (L5: κ re-derived from the key equals the signed κ). Accepts the record as JSON or a sigil PNG carrying a cityKeySig chunk. With `since`, also evaluates the liveness predicate evolved_since(t). Holds no secret.',
    inputSchema: { type: 'object', properties: { vta: { anyOf: [{ type: 'object' }, { type: 'string' }], description: 'the VTA record, or a PNG (base64 / path) carrying cityKeySig' }, key: keyProp,
      since: { type: 'string', description: 'ISO time — evaluate evolved_since(since)' }, horizonDays: { type: 'number' } }, required: ['vta'] },
    run: ({ vta, key, since, horizonDays }) => {
      let rec = vta, k = null;
      if (typeof vta === 'string') {
        let s = vta.trim(); if (s.startsWith('data:image/png;base64,')) s = s.slice(22);
        const buf = /^iVBOR/.test(s) ? Buffer.from(s, 'base64') : (fs.existsSync(s) && fs.readFileSync(s)[0] === 0x89 ? fs.readFileSync(s) : null);
        if (buf) { const t = readTextChunks(buf); if (!t.cityKeySig) return { error: 'PNG carries no cityKeySig chunk' }; rec = JSON.parse(Buffer.from(t.cityKeySig, 'base64').toString('utf8'));
          if (key == null && t.cityKey) k = JSON.parse(Buffer.from(t.cityKey, 'base64').toString('utf8')); }
        else { try { rec = JSON.parse(s); } catch { return { error: 'vta must be a record object, JSON, or a PNG' }; } }
      }
      if (key != null) { const p = K.parseKeyInput(key); if (p.error) return p; k = p.key; }
      const v = verifyRecord(rec, k);
      const out = { ...v, did: rec?.publicKeyHex ? didKey(rec.publicKeyHex) : null, keyChecked: !!k };
      if (since) out.liveness = evolvedSince(rec, since, { horizonDays: horizonDays ?? null });
      return out; } },
  { name: 'card_verify', title: 'card.verify (public)',
    description: 'Verify an AgentCard as agentprivacy /ceremony signs it (ed25519 over the card payload; participantId = ap-<16 hex of the public key>). Returns participantId, did:key, displayName, trustTier, Drake Orb tier. This is the identity mages.city admits with; the board never re-issues it.',
    inputSchema: { type: 'object', properties: { card: { anyOf: [{ type: 'object' }, { type: 'string' }], description: 'the AgentCard JSON (object, JSON text, or a path)' } }, required: ['card'] },
    run: ({ card }) => { let c = card; if (typeof c === 'string') { const s = c.trim(); try { c = s.startsWith('{') ? JSON.parse(s) : JSON.parse(fs.readFileSync(s, 'utf8')); } catch (e) { return { error: 'card must be JSON or a path to it' }; } } return verifyCard(c); } },
  { name: 'hold_verify', title: 'hold.verify (public)',
    description: 'Verify a Star Hold (kind agentprivacy.star-hold/1): the sidecar of retained signed envelopes beside a City Key. Re-derives every item ref from its retained bytes and the Merkle root from the refs (the packets rule), checks the bearer\'s ed25519 signature over {kind, bearer, kappa, root, count, at}, and re-verifies EVERY item by its profile — OpenVTC eddsa-jcs-2022 Data Integrity proofs (trust tasks, DTG VRCs; did:key resolved locally, other methods report unavailable), agentprivacy.vta/1 records, agentprivacy.vrc/1 bilateral records; declared suites report unsupported. With the key, also checks the Hold belongs to it (κ re-derived; holds{root,count} agree). Returns per-item states, never a single verdict for the whole Hold, and never grants anything. Holds no secret. With `project`, diagnostic mode includes a nested projection; outer diagnostic items still include signer identifiers. Use responseMode=projection for only the projection, with fresh states/measurements and no diagnostic wrapper. Projection retains bearer and linkable refs; it is not unlinkability or authorization.',
    inputSchema: { type: 'object', properties: { hold: { anyOf: [{ type: 'object' }, { type: 'string' }], description: 'the Hold (object, JSON text, or a path)' }, key: keyProp, project: { type: 'boolean', description: 'in diagnostic mode, also include a nested fresh projection; does not remove outer diagnostics' }, responseMode: { type: 'string', enum: ['diagnostic', 'projection'], description: 'diagnostic (default) returns verification details; projection returns only the projection or a bounded error, regardless of project' } }, required: ['hold'] },
    run: ({ hold, key, project, responseMode = 'diagnostic' }) => {
      if (!['diagnostic', 'projection'].includes(responseMode)) return { error: 'responseMode must be diagnostic or projection' };
      let h = hold; if (typeof h === 'string') { const s = h.trim(); try { h = s.startsWith('{') ? JSON.parse(s) : JSON.parse(fs.readFileSync(s, 'utf8')); } catch { return { error: 'hold must be JSON or a path to it' }; } }
      let k = null; if (key != null) { const p = K.parseKeyInput(key); if (p.error) return p; k = p.key; }
      if (responseMode === 'projection') {
        try { return projectHold(h, { key: k }); }
        catch { return { error: 'invalid Hold structure; projection not returned' }; }
      }
      const v = verifyHold(h, { key: k });
      return project && v.ok ? { ...v, projection: projectHold(h, { key: k }) } : v; } },
];
if (!VTA) TOOLS.push({ name: 'compare_plain', title: 'compare.plain (development only)',
  description: 'The ∩ of two keys (walked + lit vertices, shared PSI elements) computed IN THE OPEN by reading both keys. Development only: Rung 3 replaces it with DH-PSI, and it is hidden when VTA_MODE=1.',
  inputSchema: { type: 'object', properties: { a: keyProp, b: keyProp }, required: ['a', 'b'] },
  run: ({ a, b }) => { const pa = K.parseKeyInput(a), pb = K.parseKeyInput(b); if (pa.error) return { error: 'a: ' + pa.error }; if (pb.error) return { error: 'b: ' + pb.error }; return K.comparePlain(pa.key, pb.key); } });
const byName = Object.fromEntries(TOOLS.map(t => [t.name, t]));

// ---- JSON-RPC over stdio ---------------------------------------------------------
const send = msg => process.stdout.write(JSON.stringify(msg) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message, data) => send({ jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } });

function callTool(name, args) {
  const t = byName[name]; if (!t) return { content: [{ type: 'text', text: `unknown tool ${name}` }], isError: true };
  let out; try { out = t.run(args || {}); } catch (e) { return { content: [{ type: 'text', text: `${name}: ${e.message}` }], isError: true }; }
  const content = [];
  if (out && out._image) { content.push({ type: 'image', data: out._image, mimeType: 'image/png' }); out = { ...out }; delete out._image; }
  content.unshift({ type: 'text', text: JSON.stringify(out, null, 1) });
  return { content, structuredContent: out && typeof out === 'object' && !Array.isArray(out) ? out : { result: out }, isError: !!(out && out.error) };
}

const INSTRUCTIONS = `agentprivacy-mcp ${VERSION} — the guide as a walkable lattice. Start with guide_search (an ordered walk), read pages with guide_page, follow guide_neighbours (every link is a named lattice move), then key_evolve to write the walk into a City Key and sigil_render to draw it; key_derive re-derives any key's κ (Law L5). Identity is the slug, never the host. Nothing here signs: that is the Swordsman's.`;

function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    const asked = params?.protocolVersion;
    return reply(id, { protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
      capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'agentprivacy-mcp', version: VERSION }, instructions: INSTRUCTIONS });
  }
  if (method === 'notifications/initialized' || method?.startsWith('notifications/')) return;
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') return reply(id, { tools: TOOLS.map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema })) });
  if (method === 'tools/call') return reply(id, callTool(params?.name, params?.arguments));
  if (method === 'resources/list') return reply(id, { resources: [] });
  if (method === 'prompts/list') return reply(id, { prompts: [] });
  if (id !== undefined) fail(id, -32601, `method not found: ${method}`);
}

if (process.argv.includes('--list')) {            // a human glance, not the protocol
  try { const b = B.load(); console.error(`bake: ${b.count.pages} pages · ${b.count.postured} postured · ${b.sites.length} sites · baked ${b.baked}`); } catch (e) { console.error(e.message); }
  for (const t of TOOLS) console.log(`${t.name.padEnd(18)} ${t.description.split('.')[0]}.`);
  process.exit(0);
}
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', line => {
  line = line.trim(); if (!line) return;
  let msg; try { msg = JSON.parse(line); } catch { return fail(null, -32700, 'parse error'); }
  if (Array.isArray(msg)) msg.forEach(handle); else handle(msg);
});
rl.on('close', () => process.exit(0));
