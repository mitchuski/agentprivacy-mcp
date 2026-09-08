// Browser URL -> exact baked federation page. No browser/identity authority inferred.
import fs from 'node:fs';
import path from 'node:path';
import * as B from './bake.mjs';
import { canonicalJSON, sha256hex, elementOf } from './kappa.mjs';
import { isVertex, bits, dimsOf, neg, bnot, succ } from './lattice.mjs';

const PROFILE = 'agentprivacy.baked-page-context/1';
const hash = bytes => 'sha256:' + sha256hex(bytes);
const fail = message => { throw new Error(message); };
function safePart(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(value)) fail('Unsafe snapshot path segment');
  return value;
}
function normalizedUrl(input) {
  if (typeof input !== 'string' || input.length > 4096) fail('Expected a page URL');
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search) fail('Expected HTTPS page URL without credentials, port or query');
  // Fragments only select a location within the same static page representation.
  url.hash = '';
  return url.href;
}
export function createSiteContextTools({ bake = B, readFile = fs.readFileSync } = {}) {
  function capabilities() {
    const data = bake.load();
    return { profile: PROFILE, source: 'local-bake', bakedAt: data.baked ?? null,
      sites: data.sites.map(site => ({ id: site.id,
        pageBase: `https://guide.agentprivacy.ai/${site.sub}/`,
        pages: [...data.byKey.values()].filter(r => r.site === site.id).length })),
      capabilities: ['exact-page-url-resolution', 'snapshot-content-digest', 'lattice-context', 'federation-copy-disambiguation'],
      limits: ['No live-page freshness check', 'No browser key import or origin authorization', 'No signer, VTA or runtime attestation'] };
  }
  function context({ url }) {
    const normalized = normalizedUrl(url), data = bake.load();
    // Resolve through the catalog, never interpolate untrusted URL paths into file paths.
    const matches = [...data.byKey.values()].filter(rec => bake.publicUrl(rec) === normalized);
    if (matches.length !== 1) fail(matches.length ? 'Ambiguous catalog URL' : 'Page URL is not registered in this local bake; use site_capabilities and guide_search');
    const rec = matches[0];
    if (!isVertex(rec.vertex)) fail('Page has no valid lattice seat');
    const root = fs.realpathSync(bake.SITE);
    const sub = rec.sub.split('/').map(safePart);
    const candidate = path.resolve(root, ...sub, safePart(rec.slug) + '.json');
    const real = fs.realpathSync(candidate);
    const rel = path.relative(root, real);
    if (rel.startsWith('..') || path.isAbsolute(rel)) fail('Snapshot escaped its root');
    const bytes = readFile(real);
    if (bytes.length > 8 * 1024 * 1024) fail('Snapshot page exceeds 8 MiB');
    const page = JSON.parse(bytes.toString('utf8'));
    if (!page || typeof page !== 'object' || Array.isArray(page) || !Array.isArray(page.story)) fail('Expected a FedWiki page snapshot');
    const revision = hash(canonicalJSON(page));
    const element = elementOf(rec.vertex, rec.slug, rec.links);
    const integrity = rec.element == null ? 'unlabelled' : element === rec.element ? 'match' : 'mismatch';
    if (integrity === 'mismatch') fail('Catalog PSI element mismatch; refresh or repair the bake');
    const text = page.story.filter(item => item?.type !== 'posture').map(item => item?.type === 'reference' ? `→ [[${item.title || item.slug || ''}]]` : String(item?.text || '')).join('\n\n');
    const evidence = { kind: PROFILE, page: { url: normalized, slug: rec.slug, revision, vertex: rec.vertex },
      representation: 'fedwiki-page-json/canonical-sorted-v1', fileDigest: hash(bytes),
      catalog: { site: rec.site, bakedAt: data.baked ?? null, links: [...rec.links].sort(), element,
        elementIntegrity: integrity, postureSource: rec.postured ? 'explicit-in-catalog' : 'derived-in-catalog' } };
    return { ...evidence, evidenceDigest: hash(canonicalJSON(evidence)),
      lattice: { bits: bits(rec.vertex), axes: dimsOf(rec.vertex), neg: neg(rec.vertex), bnot: bnot(rec.vertex), succ: succ(rec.vertex) },
      title: String(page.title || rec.title || rec.slug), text, contentTrust: 'untrusted-page-content',
      copies: (data.bySlug.get(rec.slug) || []).map(copy => ({ site: copy.site, url: bake.publicUrl(copy), selected: copy.site === rec.site })),
      next: { readNeighbours: { tool:'guide_neighbours', arguments:{site:rec.site,slug:rec.slug} },
        evolveExplicitWalk: { tool:'key_evolve', step:{site:rec.site,slug:rec.slug} } },
      livePage: 'not-checked', browserCarry: 'not-connected', keyChanged: false,
      limits: ['Revision binds local snapshot JSON, not current live HTML', 'PSI binds catalog topology, not execution or comprehension', 'No key mutation or trust edge from page inspection'] };
  }
  return [
    { name:'site_capabilities',title:'AgentPrivacy site capabilities',description:'List exact baked federation page bases supported by this MCP. Reports snapshot coverage and integration limits; domain membership grants no authority.',
      inputSchema:{type:'object',properties:{},additionalProperties:false},run:capabilities },
    { name:'site_context',title:'AgentPrivacy page context',description:'Resolve an exact registered page URL to its local snapshot revision, evidence digest, lattice operators and explicit federation copy. Page text is untrusted. Does not read the browser, fetch live content, import a key or evolve it.',
      inputSchema:{type:'object',properties:{url:{type:'string',maxLength:4096}},required:['url'],additionalProperties:false},run:context }
  ];
}
