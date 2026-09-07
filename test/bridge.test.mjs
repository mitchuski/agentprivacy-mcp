// test/bridge.test.mjs — Phase 1 "done when": inscribing a constellation on
// spellweb evolves the SAME City Key (same κ) as walking the equivalent stars
// on the guide. Both routes go through key.evolve; the bridge maps node ids to
// slugs; identity is the slug, never the host.
import { bridge, resolveWalk } from '../lib/bake.mjs';
import { evolve, defaultKey } from '../lib/key.mjs';

let fails = 0;
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fails++; };

const br = bridge();
const ids = Object.keys(br);
ok(ids.length > 0, `bridge loaded: ${ids.length} spellweb nodes carry a guide page`);

// a constellation: the first postured bridged node, then five more bridged nodes
const postured = ids.filter(id => br[id].postured);
const constellation = [...postured.slice(0, 2), ...ids.filter(id => !br[id].postured).slice(0, 4)];
ok(constellation.length === 6, `constellation of ${constellation.length} node ids (${postured.length} bridged nodes are postured)`);

// route A · spellweb: node ids → key.evolve
const A = evolve(defaultKey('bearer'), constellation, { name: 'the same six' });
// route B · guide: the equivalent stars by slug → key.evolve
const walk = constellation.map(id => ({ site: br[id].site, slug: br[id].slug }));
const B = evolve(defaultKey('bearer'), walk, { name: 'the same six' });
ok(!A.error && !B.error, 'both routes evolve');
ok(A.kappa === B.kappa, `same κ from a spellweb constellation and a guide walk: ${A.kappa.slice(0, 23)}…`);
ok(A.walk.digest === B.walk.digest, 'same walk digest');
ok(A.walk.steps.every((s, i) => s.element === B.walk.steps[i].element), 'same PSI elements step for step');

// identity is the slug, never the host: naming a copy on another site resolves to the same reference
const r = resolveWalk([{ slug: br[constellation[0]].slug }]);
ok(r.steps.length === 1 && r.steps[0].slug === br[constellation[0]].slug, 'a bare slug resolves without a host');

// a step that is neither a slug nor a bridged node is reported, not silently dropped
const r2 = resolveWalk(['no-such-node-or-page-xyz']);
ok(r2.steps.length === 0 && r2.missing.length === 1, 'an unknown step is reported as missing');

console.log(fails ? `\n${fails} failing` : '\nbridge holds');
process.exit(fails ? 1 : 0);
