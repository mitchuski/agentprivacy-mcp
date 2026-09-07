// lib/bake.mjs — the agent reads the BAKE, never the live farm (plan §7: a walk
// must be reproducible). Everything here is a read over files that
// agentprivacy.guide/tools/star-chart.mjs and tools/snapshot.mjs wrote:
//
//   site/star-chart/data/wiki-sites.json         the charted sites + strands
//   site/star-chart/data/labs.json               the six strands (latticeAxisVertex canon)
//   site/star-chart/data/pages.json              the per-page record (vertex · element · links)
//   site/star-chart/data/sitemaps/<id>/system/sitemap.json
//   site/star-chart/data/vpkb/{search.js,index/*.json}   the lexical index (BM25) — guide.search
//   site/<sub>/<slug>.json                       the page itself (fedwiki JSON, de-localhosted)
//
// Identity is the slug, never the host: the same page forked across sites is
// one reference. Lookups are by slug first; `site` disambiguates.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { moveName, moveLabel, isVertex } from './lattice.mjs';

const require = createRequire(import.meta.url);
export const SITE = process.env.AGENTPRIVACY_GUIDE_SITE || path.join(os.homedir(), 'agentprivacy.guide', 'site');
const DATA = () => path.join(SITE, 'star-chart', 'data');
const readJSON = f => JSON.parse(fs.readFileSync(f, 'utf8'));

let _bake = null;
export function load(force = false) {
  if (_bake && !force) return _bake;
  const data = DATA();
  if (!fs.existsSync(path.join(data, 'pages.json')))
    throw new Error(`no bake at ${data} — run: node tools/star-chart.mjs in agentprivacy.guide (set AGENTPRIVACY_GUIDE_SITE to point elsewhere)`);
  const sitesDoc = readJSON(path.join(data, 'wiki-sites.json'));
  const labs = readJSON(path.join(data, 'labs.json'));
  const pagesDoc = readJSON(path.join(data, 'pages.json'));
  const strands = Object.fromEntries(labs.strands.map(s => [s.id, s]));
  // the snapshot subpath per site id — read back from the chart's own HOSTPATH line
  const html = fs.readFileSync(path.join(SITE, 'star-chart', 'index.html'), 'utf8');
  const m = html.match(/const HOSTPATH = (\{[^\n]*?\});/);
  const hostpath = m ? JSON.parse(m[1]) : {};
  const sites = sitesDoc.sites.filter(s => !s.url).map(s => ({ id: s.host, strand: s.strand, sub: hostpath[s.host] || s.host }));

  const byKey = new Map(), bySlug = new Map(), backlinks = new Map();
  for (const site of sites) {
    const f = path.join(data, 'sitemaps', site.id, 'system', 'sitemap.json');
    if (!fs.existsSync(f)) continue;
    for (const row of readJSON(f)) {
      const rec = { site: site.id, sub: site.sub, strand: site.strand, slug: row.slug, title: row.title, date: row.date || 0,
        links: Object.keys(row.links || {}).sort(), vertex: null, postured: false, posture: null, by: row.by || null, forkedFrom: row.forkedFrom || null };
      byKey.set(site.id + '/' + row.slug, rec);
      if (!bySlug.has(row.slug)) bySlug.set(row.slug, []);
      bySlug.get(row.slug).push(rec);
    }
  }
  for (const p of pagesDoc.pages) {
    const rec = byKey.get(p.site + '/' + p.slug); if (!rec) continue;
    Object.assign(rec, { vertex: p.vertex, postured: !!p.postured, posture: p.posture, element: p.element, priorVertex: p.priorVertex ?? null });
  }
  for (const rec of byKey.values()) for (const l of rec.links) {
    if (!backlinks.has(l)) backlinks.set(l, []);
    backlinks.get(l).push(rec);
  }
  _bake = { data, sites, strands, byKey, bySlug, backlinks, baked: pagesDoc.baked, count: pagesDoc.count };
  return _bake;
}

/** Resolve (site?, slug) → record. Slug is the identity; site disambiguates. */
export function resolve(slug, site) {
  const b = load();
  if (site) return b.byKey.get(site + '/' + slug) || null;
  const rows = b.bySlug.get(slug) || [];
  if (!rows.length) return null;
  // prefer a postured copy, then the most recently edited one
  return [...rows].sort((x, y) => (y.postured - x.postured) || (y.date - x.date))[0];
}

export const publicUrl = rec => `https://guide.agentprivacy.ai/${rec.sub}/${rec.slug}.html`;
export const summary = rec => ({ site: rec.site, slug: rec.slug, title: rec.title, vertex: rec.vertex, posture: rec.posture,
  postured: rec.postured, strand: rec.strand, links: rec.links.length, element: rec.element, url: publicUrl(rec) });

/** The page's own story text, from the snapshot's raw page JSON. */
export function pageText(rec) {
  const f = path.join(SITE, rec.sub, rec.slug + '.json');
  if (!fs.existsSync(f)) return { text: null, items: 0, note: 'page JSON not in the snapshot (re-run tools/snapshot.mjs)' };
  const page = readJSON(f);
  const items = Array.isArray(page.story) ? page.story : [];
  const text = items.filter(it => it.type !== 'posture').map(it => it.type === 'reference' ? `→ [[${it.title || it.slug}]]` : String(it.text || '')).join('\n\n');
  return { text, items: items.length, title: page.title };
}

/** Linked pages (out + back), each with the lattice move from this page. */
export function neighbours(rec) {
  const b = load();
  const out = [], seen = new Set();
  for (const slug of rec.links) {
    const to = resolve(slug, b.byKey.has(rec.site + '/' + slug) ? rec.site : undefined);
    const mv = to ? moveName(rec.vertex, to.vertex) : { op: 'none', flipped: [] };
    out.push({ dir: 'out', slug, resolved: !!to, ...(to ? summary(to) : {}), move: moveLabel(mv), flipped: mv.flipped });
    if (to) seen.add(to.site + '/' + to.slug);
  }
  for (const from of (b.backlinks.get(rec.slug) || [])) {
    if (from === rec || seen.has(from.site + '/' + from.slug)) continue;
    const mv = moveName(rec.vertex, from.vertex);
    out.push({ dir: 'in', ...summary(from), resolved: true, move: moveLabel(mv), flipped: mv.flipped });
  }
  return out;
}

// ---- search: the VPKB lexical core, baked with the chart --------------------------
let _search = null;
function searchCore() {
  if (_search) return _search;
  const b = load();
  const core = path.join(b.data, 'vpkb', 'search.js'), idxDir = path.join(b.data, 'vpkb', 'index');
  if (!fs.existsSync(core) || !fs.existsSync(idxDir)) return (_search = { available: false });
  // search.js is a UMD; the guide repo is "type": "module", so require() would
  // load it as ESM and hand back an empty namespace. Evaluate it as CommonJS.
  const mod = { exports: {} };
  new Function('module', 'exports', fs.readFileSync(core, 'utf8'))(mod, mod.exports);
  const Search = mod.exports;
  if (typeof Search.walk !== 'function') return (_search = { available: false });
  const indexes = fs.readdirSync(idxDir).filter(f => /^[a-z0-9-]+\.json$/.test(f) && f !== 'manifest.json')
    .map(f => readJSON(path.join(idxDir, f)));
  return (_search = { available: true, Search, indexes });
}
/** query → ordered walk (BM25 + link expansion), each step decorated with its vertex. */
export function search(query, { limit = 9, sites = [] } = {}) {
  const s = searchCore();
  if (!s.available) return fallbackSearch(query, limit);
  const use = sites.length ? s.indexes.filter(i => sites.includes(i.site)) : s.indexes;
  const w = s.Search.walk(use, query, { limit, perSite: 3, candidates: 14 });
  if (!w) return { query, steps: [], candidates: [], note: 'nothing matched' };
  const deco = h => { const rec = resolve(h.slug, h.site); return { ...h, ...(rec ? { vertex: rec.vertex, posture: rec.posture, element: rec.element, url: publicUrl(rec) } : {}) }; };
  return { query, matched: w.matched, steps: w.steps.map(deco), candidates: (w.candidates || []).map(deco) };
}
function fallbackSearch(query, limit) {
  const b = load(), terms = query.toLowerCase().split(/\W+/).filter(t => t.length > 2);
  const hits = [];
  for (const rec of b.byKey.values()) {
    const t = rec.title.toLowerCase(); let score = 0;
    for (const q of terms) if (t.includes(q)) score += 2;
    if (score) hits.push({ ...summary(rec), score });
  }
  hits.sort((x, y) => y.score - x.score);
  return { query, matched: hits.length, steps: hits.slice(0, limit), candidates: [], note: 'title-only fallback (no vpkb index baked)' };
}

// ---- the spellweb bridge (Phase 1A) --------------------------------------------------
// spellweb/scripts/build-guide-bridge.mjs writes node id → {site, slug}. A step that
// names a spellweb node id resolves through it, so a constellation inscribed on
// spellweb and a walk on the guide are the same steps — and evolve the same κ.
export const BRIDGE = process.env.SPELLWEB_BRIDGE || path.join(os.homedir(), 'spellweb', 'public', 'spellweb', 'guide-bridge.json');
let _bridge;
export function bridge() {
  if (_bridge !== undefined) return _bridge;
  try { _bridge = readJSON(BRIDGE).bridge || {}; } catch { _bridge = {}; }
  return _bridge;
}

/** Normalise a walk (pathway.v1 · constellation · [{site,slug}] · [slug] · [spellweb node id]) into baked steps. */
export function resolveWalk(walk) {
  const steps = Array.isArray(walk) ? walk : (walk?.steps || walk?.walk || walk?.nodes || []);
  const out = [], missing = [];
  for (let st of steps) {
    if (typeof st === 'object' && st && !st.slug && st.node) st = st.node;           // {node: 'concept-…'}
    if (typeof st === 'string' && !resolve(st) && bridge()[st]) st = { ...bridge()[st], node: st };   // a spellweb node id
    const slug = typeof st === 'string' ? st : st.slug, site = typeof st === 'string' ? undefined : (st.site || st.host);
    const rec = resolve(slug, site && site.replace(/\.localhost$/, ''));
    if (!rec) {
      if (typeof st === 'object' && isVertex(st.vertex)) out.push({ site: site || null, slug, vertex: st.vertex, unbaked: true });
      else missing.push(site ? site + '/' + slug : slug);
      continue;
    }
    out.push({ site: rec.site, slug: rec.slug, vertex: rec.vertex, element: rec.element, title: rec.title });
  }
  return { steps: out, missing };
}
