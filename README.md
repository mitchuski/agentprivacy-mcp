# agentprivacy-mcp

The privacy guide, the 64-vertex sovereignty lattice and the City Key, exposed as
MCP tools. This is the **Mage's** half of the Verifiable Trust Agent described in
`agentprivacy_master/docs/PLAN_KNOWLEDGE_GRAPH_TO_VTA_2026-09-03.md` (Phase 3, read
tools): every tool is a pure function over a City Key or a graph snapshot, so an agent
can compose them and a human can audit the composition. Nothing here holds a secret.

Zero dependencies. Node ≥ 18. MCP over stdio.

```
claude mcp add agentprivacy -- node C:/Users/mitch/agentprivacy-mcp/server.mjs
node server.mjs --list          # what the bake holds + the tool roster
npm test                        # canon vectors + the scripted agent (bin/walk-demo.mjs)
```

## What it reads

The **bake**, never the live farm, so a walk is reproducible (plan §7):

| file | written by | carries |
|---|---|---|
| `site/star-chart/data/pages.json` | `agentprivacy.guide/tools/star-chart.mjs` | one row per page: `vertex`, `postured`, `posture`, `sorted_links`, `element`, `forkedFrom`, `priorVertex` |
| `site/star-chart/data/sitemaps/<id>/system/sitemap.json` | same | title · date · links · vertex · posture |
| `site/star-chart/data/vpkb/` | same (from `~/vpk/pathways`) | the BM25 search core + per-site lexical indexes |
| `site/<sub>/<slug>.json` | `tools/snapshot.mjs` | the page itself |

Point elsewhere with `AGENTPRIVACY_GUIDE_SITE=<dir>`.

## Tools

| tool (plan name) | in | out |
|---|---|---|
| `guide_search` (guide.search) | query, limit?, sites? | an **ordered walk**: steps with site · slug · vertex · posture · PSI element · url |
| `guide_page` (guide.page) | slug, site? | text, weave (links), vertex + six bits, dims, stratum, element, copies across sites |
| `guide_neighbours` (guide.neighbours) | slug, site? | out-links and backlinks, each with the **named lattice move**: succ · neg · bnot · flip *dim* · jump ×k |
| `lattice_move` (lattice.move) | vertex, op | the resulting vertex, bits, dims, stratum, reading. `op` = succ · neg · bnot · `flip <dim>` · `to <vertex>` |
| `key_derive` (key.derive) | key (JSON · sigil PNG · path) | Law L5: canonical form → κ → verdict `verified` / `mismatch` / `unlabelled`, prior, 64 glyphs, lit + walked vertices |
| `key_evolve` (key.evolve) | key?, walk, name? | the evolved key: `walks[]` appended, `prior` chained, κ stamped, **unsigned** |
| `sigil_render` (sigil.render) | key, out?, size? | a PNG that carries the key (tEXt `cityKey`, base64 JSON) — imports on soulbis /star, /lattice, /sigil |
| `compare_plain` (compare.plain) | a, b | the ∩ in the open. **Development only**; hidden under `VTA_MODE=1` |

Identity is the slug, never the host: `guide_page` and `key_evolve` take a slug and an
optional site; the same page forked across sites is one reference.

### The walk, as content

`key_evolve` appends to the City Key's additive `walks` field:

```jsonc
{ "chart": "https://guide.agentprivacy.ai/star-chart/", "name": "…",
  "steps": [ { "site": "guide", "slug": "the-private-knowledge-network", "vertex": 36,
               "element": "sha256:…" } ],            // element = sha256("<vertex>|<slug>|<sorted links>")
  "digest": "sha256:…",                              // over the canonical steps
  "moves": [ "flip connection", "jump ×2 (memory value)" ] }
```

It is deterministic: no timestamps, no randomness. The same key and the same walk give
the same κ whoever calls, which is what lets a human's constellation on spellweb and an
agent's walk on the guide evolve the *same* key (Phase 1). Consumers that do not know
`walks` ignore it (the v1 extensibility clause); `prior` chains to the key it grew from
(C87: the key accumulates).

## The bit canon

`d1 protection = 32 · d2 delegation = 16 · d3 memory = 8 · d4 connection = 4 · d5 computation = 2 · d6 value = 1`
(game42 `axisSpace`, soulbis `/sigil`, `agentprivacy_master/src/lib/lattice-vertex.ts`,
spellweb's vertex nodes, and `agentprivacy.guide/tools/lattice.mjs` all agree;
`test/canon.test.mjs` checks this package against the game42 file when it is present).

## The Swordsman ⚔️ (Rung 1) — a second process, no LLM

`swordsman/swordsman.mjs` holds the bearer's ed25519 seed and signs what it is handed
**after a fixed policy check** it will not argue about. It is its own MCP server, so a
prompt-injected Mage can *request* a bad signature and still not *get* one.

```
node swordsman/swordsman.mjs init [--seed <ceremony privateKeyHex>] [--card AgentCard.json]
node swordsman/swordsman.mjs status
claude mcp add swordsman -- node C:/Users/mitch/agentprivacy-mcp/swordsman/swordsman.mjs
```

Keystore `~/.agentprivacy/swordsman/` (`identity.json` 0600 · `policy.json` · `ledger.jsonl`).
`--seed` imports the identity `/ceremony` minted, so the Swordsman IS the AgentCard that
mages.city admits.

| tool | does | policy it enforces |
|---|---|---|
| `key_sign` | signs a City Key evolution → the **VTA record** `{publicKeyHex, participantId, did, kappa, prior, at, walks, vrcs, sig}` | κ must re-derive (L5) · own bearer only · `prior` = ledger head (no history rewrites; unchanged content not re-signed) · no unbaked steps · rate limit from the ledger |
| `vta_publish` | what a VTA publishes: public key · κ · prior · VRC commitments, plus a ready `proofs` page item for `<name>.mages.city` | never the key, never the walk, never the seed |
| `sigil_seal` | writes the record into a sigil PNG as a `cityKeySig` chunk beside `cityKey` | record must verify |
| `policy_show` | the policy + ledger head | read-only; the seed is never returned |

Public verification lives on the **Mage** side, holding nothing: `key_verify` (record ±
key ± PNG, and the liveness predicate `evolved_since(t)`) and `card_verify` (an AgentCard
as `/ceremony` signs it). The signed record travels *beside* the key, so the κ rule is
unchanged everywhere.

`node bin/walk-demo.mjs --sign` runs the whole Phase 3 done-when across the two processes.

## Not here yet

Rungs 2–5 of `agentprivacy_master/docs/PLAN_CITY_KEY_CRYPTO_UPGRADE_2026-09-03.md`:
`carrier.seal`, `psi.blind/unblind`, `proof.predicate`, `vrc.issue`, and the two
human-consent tools. Designed there; not built.
