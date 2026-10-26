// scripts/star-hold-v2-fixture.mjs — a star-hold/2 fixture from the /1 runtime
// fixture's own items: same envelopes, re-rooted with the κ registry tree and
// re-signed by a fixed test bearer. star-key verifies it to the same root
// (tests/star-hold.test.mts), so the two implementations of /2 cannot drift.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { holdFor } from '../lib/hold.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const v1 = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'test', 'fixtures', 'star-hold.fixture.json'), 'utf8'));
const seedHex = '07'.repeat(32);   // a published test seed: this fixture proves the tree, not a bearer
const at = '2026-10-25T00:00:00.000Z';
const { key, hold } = holdFor({ seedHex, key: v1.key, items: v1.hold.items, at });
const out = { schema: 'star-hold-fixture/1', generatedBy: 'agentprivacy-mcp scripts/star-hold-v2-fixture.mjs (items from the /1 runtime fixture)', at, key, hold,
  expected: { root: hold.root, count: hold.count, kappa: key.kappa, states: v1.expected.states, tree: 'kappa-merkle/1' } };
const dest = process.argv[2] || path.join(HERE, '..', 'test', 'fixtures', 'star-hold-v2.fixture.json');
fs.writeFileSync(dest, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${dest}: ${hold.kind} root ${hold.root} over ${hold.count} items`);
