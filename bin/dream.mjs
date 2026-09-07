#!/usr/bin/env node
// bin/dream.mjs — the lane's deterministic dream: a census of everything this
// lane's corpus depends on, a diff against the last census, and (with --sync)
// the mechanical half of the dream loop. The narrative half — chronicles, KG
// dreams, the disclosure page's words — stays with the agent who reads the delta.
//
//   node bin/dream.mjs              # census + delta, prints a report, records the census
//   node bin/dream.mjs --sync       # + rebuild the corpus pages, re-bake the chart if postures moved, run the canon test
//   node bin/dream.mjs --json       # machine-readable delta
//
// Census sources (what "the corpus on all these things" depends on):
//   plans        agentprivacy_master/docs/PLAN_KNOWLEDGE_GRAPH_TO_VTA_*.md · PLAN_CITY_KEY_CRYPTO_UPGRADE_*.md
//   lane code    agentprivacy-mcp (lib · server · swordsman · bin · docs · README)
//   guide tools  agentprivacy.guide/tools/{lattice,posture,star-chart}.mjs · flow/builders/vta-lane.mjs
//   postures     every posture item on the farm (count · vertex spread · by-source)
//   bake         site/star-chart/data/pages.json (count · postured · baked-at)
//   bridge       spellweb/public/spellweb/guide-bridge.json (entries)
//   producer     agentprivacy_master/src/lib/city-key.ts
//   board        ~/mages_city (files changed since last census — read-only, the other window's)
//   corpus       the seven lane pages on the farm (story hash)
//   chronicles   master · spellweb DREAM · docs family-B · cityofmages DREAM · this dir's DREAM
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const HOME = os.homedir();
const H = (...p) => path.join(HOME, ...p);
const STATE = path.join(ROOT, 'chronicles', '.dream-state.json');
const LOG = path.join(ROOT, 'chronicles', 'DREAM-LOG.md');
const args = process.argv.slice(2), sync = args.includes('--sync'), asJSON = args.includes('--json');

const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
const fileHash = f => fs.existsSync(f) ? sha(fs.readFileSync(f)) : null;
const treeHash = (dir, pick = () => true) => {
  if (!fs.existsSync(dir)) return null;
  const files = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) { if (!/node_modules|\.git|\.run/.test(e.name)) walk(f); } else if (pick(f)) files.push(f); } };
  walk(dir); files.sort();
  return { hash: sha(files.map(f => f + ':' + fileHash(f)).join('\n')), files: files.length };
};
const newest = dir => { if (!fs.existsSync(dir)) return null; let t = 0; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) { if (!/node_modules|\.git|\.run|portal[\\/]data/.test(f)) walk(f); } else t = Math.max(t, fs.statSync(f).mtimeMs); } }; walk(dir); return t ? new Date(t).toISOString() : null; };
const readJSON = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

// ---- postures on the farm ---------------------------------------------------------------
function postureCensus() {
  const WIKI = H('.wiki'); const out = { pages: 0, postured: 0, bySource: {}, vertices: new Set(), sites: {} };
  for (const host of fs.readdirSync(WIKI).filter(d => d.endsWith('.localhost'))) {
    const dir = path.join(WIKI, host, 'pages'); if (!fs.existsSync(dir)) continue;
    for (const slug of fs.readdirSync(dir)) {
      const p = readJSON(path.join(dir, slug)); if (!p) continue; out.pages++;
      const it = (p.story || []).find(i => i.type === 'posture'); if (!it) continue;
      const m = /posture:\s*([01]{6})/.exec(it.text || ''); if (!m) continue;
      out.postured++; out.vertices.add(parseInt(m[1], 2));
      const by = (/by:\s*(.+)/.exec(it.text || '') || [, 'unknown'])[1].trim().replace(/\s*\(.*$/, '');
      out.bySource[by] = (out.bySource[by] || 0) + 1; out.sites[host] = (out.sites[host] || 0) + 1;
    }
  }
  return { pages: out.pages, postured: out.postured, vertices: out.vertices.size, bySource: out.bySource, sites: out.sites };
}
const CORPUS = [['harness.localhost', 'the-verifiable-trust-agent'], ['harness.localhost', 'the-swordsman-process'], ['harness.localhost', 'the-vta-record'], ['harness.localhost', 'the-mage-tools'], ['harness.localhost', 'the-walk-as-content'], ['guide.localhost', 'page-posture'], ['dtg.localhost', 'the-rungs']];

function census() {
  const bake = readJSON(H('agentprivacy.guide', 'site', 'star-chart', 'data', 'pages.json'));
  const bridge = readJSON(H('spellweb', 'public', 'spellweb', 'guide-bridge.json'));
  return {
    at: new Date().toISOString(),
    plans: { vta: fileHash(H('agentprivacy_master', 'docs', 'PLAN_KNOWLEDGE_GRAPH_TO_VTA_2026-09-03.md')), rungs: fileHash(H('agentprivacy_master', 'docs', 'PLAN_CITY_KEY_CRYPTO_UPGRADE_2026-09-03.md')) },
    lane: treeHash(ROOT, f => !/chronicles[\\/]|\.dream-state|DREAM-LOG/.test(f)),
    guideTools: { lattice: fileHash(H('agentprivacy.guide', 'tools', 'lattice.mjs')), posture: fileHash(H('agentprivacy.guide', 'tools', 'posture.mjs')), chart: fileHash(H('agentprivacy.guide', 'tools', 'star-chart.mjs')), builder: fileHash(H('agentprivacy.guide', 'flow', 'builders', 'vta-lane.mjs')) },
    postures: postureCensus(),
    bake: bake ? { baked: bake.baked, ...bake.count } : null,
    bridge: bridge ? { entries: Object.keys(bridge.bridge || {}).length } : null,
    producer: fileHash(H('agentprivacy_master', 'src', 'lib', 'city-key.ts')),
    board: { newest: newest(H('mages_city')) },
    corpus: Object.fromEntries(CORPUS.map(([h, s]) => { const p = readJSON(H('.wiki', h, 'pages', s)); return [h.replace('.localhost', '') + '/' + s, p ? sha(JSON.stringify(p.story)) : null]; })),
    chronicles: { master: fileHash(H('agentprivacy_master', 'docs', 'chronicles', '2026-09-05_the-agent-walks-the-guide.md')), spellweb: fileHash(H('spellweb', 'chronicles', 'DREAM-2026-09-05.md')), docs: fileHash(H('agentprivacy-docs', 'chronicles', '2026-09-05_kg_to_vta_first_releases.md')), city: fileHash(H('cityofmages', 'chronicles', 'DREAM-2026-09-05.md')), cityBoard: fileHash(H('cityofmages', 'chronicles', '2026-09-05_the-city-gets-its-board.md')), lane: fileHash(path.join(ROOT, 'chronicles', 'DREAM-2026-09-05.md')) },
    // the canon's account of the board — the crosswalk and the discovery map two builders read
    canonBoard: { crosswalk: fileHash(H('cityofmages', 'mages-city', 'CROSSWALK.md')), discovery: fileHash(H('cityofmages', 'mages-city', 'DISCOVERY.json')), doors: (readJSON(H('cityofmages', 'mages-city', 'DISCOVERY.json')) || {}).doors?.length ?? null },
  };
}

// ---- delta --------------------------------------------------------------------------------
function flat(o, pre = '', out = {}) { for (const [k, v] of Object.entries(o || {})) { const key = pre ? pre + '.' + k : k; if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, key, out); else out[key] = v; } return out; }
function delta(prev, cur) {
  if (!prev) return { first: true, changes: [] };
  const a = flat(prev), b = flat(cur), changes = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { if (k === 'at') continue; if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) changes.push({ key: k, from: a[k] ?? null, to: b[k] ?? null }); }
  return { first: false, changes };
}
const run = (cmd, cwd) => { const r = spawnSync(process.execPath, cmd, { cwd, encoding: 'utf8' }); return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }; };

// ---- go -----------------------------------------------------------------------------------
const prev = readJSON(STATE);
let cur = census();
let d = delta(prev, cur);
const actions = [];
if (sync) {
  const posturesMoved = d.first || d.changes.some(c => c.key.startsWith('postures.') || c.key.startsWith('guideTools.'));
  const laneMoved = d.first || d.changes.some(c => c.key.startsWith('lane.') || c.key.startsWith('plans.'));
  // 1 · the corpus pages follow the sources (manifest-first builder; idempotent)
  const b = run([H('agentprivacy.guide', 'flow', 'builders', 'vta-lane.mjs')], H('agentprivacy.guide'));
  actions.push({ step: 'build corpus pages', ok: b.status === 0, note: (b.out.trim().split('\n').pop() || '') });
  // 2 · re-bake the chart when postures or the chart tools moved (the bake is what the agent reads)
  if (posturesMoved) { const r = run([H('agentprivacy.guide', 'tools', 'star-chart.mjs')], H('agentprivacy.guide')); actions.push({ step: 're-bake star chart', ok: r.status === 0, note: (r.out.match(/posture: .*/) || [''])[0] }); }
  else actions.push({ step: 're-bake star chart', ok: true, note: 'skipped — postures and chart tools unchanged' });
  // 3 · when the lane's code moved, the canon must still hold
  if (laneMoved) { const t = run([path.join(ROOT, 'test', 'canon.test.mjs')], ROOT); actions.push({ step: 'canon test', ok: t.status === 0, note: (t.out.trim().split('\n').pop() || '') }); }
  else actions.push({ step: 'canon test', ok: true, note: 'skipped — lane code unchanged' });
  cur = census(); d = delta(prev, cur);
}
fs.mkdirSync(path.dirname(STATE), { recursive: true });
fs.writeFileSync(STATE, JSON.stringify(cur, null, 1));
const noop = !d.first && d.changes.length === 0;
const line = `| ${cur.at.slice(0, 16).replace('T', ' ')} | ${d.first ? 'first census' : noop ? 'no change' : d.changes.length + ' changed'} | ${cur.postures.postured}/${cur.postures.pages} postured · ${cur.postures.vertices} vertices | bake ${cur.bake ? cur.bake.postured + '/' + cur.bake.pages : '—'} | bridge ${cur.bridge ? cur.bridge.entries : '—'} | board ${cur.board.newest ? cur.board.newest.slice(0, 16).replace('T', ' ') : '—'} | ${sync ? actions.map(a => (a.ok ? '✓' : '✗') + ' ' + a.step).join(' · ') : 'census only'} |`;
if (!fs.existsSync(LOG)) fs.writeFileSync(LOG, `# DREAM-LOG — the lane's deterministic census\n\nAppended by \`bin/dream.mjs\` on every dream tick. The narrative dreams are the dated \`DREAM-*.md\` files beside this one; this is the ledger of what moved between them.\n\n| when | delta | postures | bake | bridge | board newest | actions |\n|---|---|---|---|---|---|---|\n`);
fs.appendFileSync(LOG, line + '\n');
if (asJSON) { console.log(JSON.stringify({ noop, first: d.first, changes: d.changes, actions, census: cur }, null, 1)); }
else {
  console.log(d.first ? '🌙 first census recorded' : noop ? '🌙 no change since the last dream' : `🌙 ${d.changes.length} thing(s) moved since ${prev.at}:`);
  for (const c of d.changes) console.log(`   ${c.key}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`);
  for (const a of actions) console.log(`   ${a.ok ? '✓' : '✗'} ${a.step} — ${a.note}`);
  console.log(`   postures ${cur.postures.postured}/${cur.postures.pages} (${cur.postures.vertices} vertices; ${Object.entries(cur.postures.bySource).map(([k, v]) => k + ' ' + v).join(', ')}) · bake ${cur.bake ? cur.bake.postured + '/' + cur.bake.pages + ' @ ' + cur.bake.baked.slice(0, 16) : '—'} · bridge ${cur.bridge?.entries ?? '—'} · board newest ${cur.board.newest ?? '—'}`);
}
process.exit(actions.some(a => !a.ok) ? 1 : 0);
