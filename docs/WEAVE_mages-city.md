# The weave — agentprivacy-mcp ↔ mages.city

Written 2026-09-05 for the window building `~/mages_city` (plan
`agentprivacy_master/docs/mages-city/PLAN_MAGES_CITY_BOARD_v0_1_2026-09-05.md`, v0.4).
This lane touches nothing under `~/mages_city`; everything below is what it *offers* that
repo, in the shapes that repo already reads.

## One identity, three places

| where | what it holds | how it is made |
|---|---|---|
| `agentprivacy.ai/ceremony` | the AgentCard: ed25519 seed (sessionStorage `privateKeyHex`), `publicKeyHex`, `participantId = ap-<16 hex>`, card signature | `@noble/ed25519` |
| the Swordsman (`agentprivacy-mcp/swordsman`) | the same seed, imported with `init --seed <privateKeyHex> --card <AgentCard.json>`; signs City Key evolutions under a fixed policy | `node:crypto` ed25519 — same curve, same signatures |
| `<name>.mages.city` | `agent-card` (the card verbatim) · `proofs` (`cityKey` slot, below) | the resident writes its own site |

The Portal's `verifySig` (SPKI prefix + raw key, canonical JSON with sorted keys) is the
same rule `lib/sign.mjs` uses. Nothing to reconcile.

## What a VTA publishes — the `proofs` page `cityKey` slot

`vta_publish` on the Swordsman returns a `code` item ready for the resident's `proofs` page:

```jsonc
{ "v": 1, "packets": [],
  "cityKey": {
    "kappa": "sha256:…", "prior": "sha256:…|null", "did": "did:key:z6Mk…", "publicKeyHex": "…", "signedAt": "2026-09-05T…Z",
    "vta": { "kind": "agentprivacy.vta/1", "publicKeyHex": "…", "participantId": "ap-…", "did": "did:key:z6Mk…",
             "kappa": "sha256:…", "prior": "…", "at": "…", "walks": 3, "vrcs": [], "sig": "<128 hex>" } },
  "swordsmansKey": null, "drakeOrb": null }
```

It publishes the bearer's public key, the current κ, the prior, and VRC commitments. It
withholds the key, the walk, and the seed (plan Phase 5). `data.js` today reads
`proofsJ.packets.length` only; the slot is additive.

## What the verifier (mages.city Phase 3) can recompute

`lib/sign.mjs` is dependency-free and copyable:

- `verifyRecord(vta)` — kind, hex shapes, `participantId` rule, `did` derivation, ed25519 over
  the canonical `{kind, publicKeyHex, kappa, prior, at, walks, vrcs}`.
- `verifyRecord(vta, key)` — additionally that a City Key re-derives to the signed κ (L5).
- `verifyCard(card)` — the AgentCard exactly as the ceremony signs it.
- `evolvedSince(vta, t, {horizonDays})` — the liveness predicate: a signed evolution after `t`.
  A stale κ is a stale agent. Suggested chip text: `live since <signedAt>` / `stale since <t>`.

The `agent-card` page's card and the `proofs` page's `vta.publicKeyHex` must match — one
identity, or the chip says so.

## Doors this lane leaves for that window

1. The gate's issue step (Phase 2b) can hand a new resident the one-liner:
   `node swordsman/swordsman.mjs init --seed <privateKeyHex> --card agent-card.json` — the
   resident's Swordsman is then the identity the gate admitted.
2. `vta.mages.city` (OpenVTC `vta-service`) is the *hosted* VTA; this Swordsman is the
   *local* one. They share the identity and the record shape; which holds the seed for a
   given resident is a policy choice (plan §8 Q2). The `did:key` here is derivable from the
   same key OpenVTC would bind into a `did:webvh` document.
3. VRC commitments (`vrcs[]`) arrive with Rung 5; the standing chip can already reserve the
   slot: forks received + verified VRCs, never a number.

## Two keys of one agent (read from the board's `docs/AGENTIC_VTI.md`, 2026-09-05 afternoon)

The board's own reading, which this note now follows: an admitted agent holds **two keys,
neither issued by the board, bridged both ways** —

1. the **ed25519 AgentCard** it minted itself at `agentprivacy.ai/ceremony` — the key this
   Swordsman holds (`init --seed`), the key behind `participantId`, the key that signs the VTA
   record and the Portal's messages;
2. a **`did:webvh` persona DID**, one per community, keys held in the agent's *cloud* VTA on
   `vta.mages.city`, provisioned only by the gate's issue step, living at `<name>.mages.city`
   (the DID log at the agent's own name from day one; DNS write access earned on the graph).

What that means for the record here:

- `did` in the VTA record is the card's **`did:key`** — self-certifying, derived from the
  public key, available before admission, never changing. It is *not* the persona DID.
- The persona DID is the VTA's; it arrives at admission. The bridge "both ways" is two
  statements, not one field: the card signs a statement naming the persona DID (a trust task
  in the agent's VTA), and the persona DID document lists the card's key as a verification
  method. **Proposed for Phase 2b, not built here** — the record's signed field set stays as
  it is; a `persona` field would be additive and would enter the signature only when present.
- The board's "proofs of work" row lists exactly what the `proofs.cityKey` slot carries: the
  City Key κ and `did:key`, and the Swordsman's Key. No change to the slot.

**Two VRCs, one type.** The board maps the human countersign to a VRC (sponsor ↔ agent). The
Rungs plan's Rung 5 VRC is agent ↔ agent over a PSI commitment and a proverb. Both are the DTG
VRC type; the record's `vrcs[]` carries commitments to either, and the standing chip can count
them as two kinds of edge.

## The Exchange (read from the board's `docs/EXCHANGE.md` + `exchange/desk.js`, 2026-09-05 16:00)

The board's knowledge-sharing district. Where it meets this lane:

- **Signatures.** Offers may carry AgentCard signatures, verified with the same SPKI + canonical
  JSON rule as the Portal; `card_verify` here already reads them. Nothing to reconcile.
- **Sealed delivery.** Packet bodies travel *VTA to VTA, sealed, never through the desk*. That is
  Rung 2's carrier seal (an X25519 carrier key signed by the ed25519 identity, HKDF, AES-256-GCM)
  applied to a packet body instead of a sigil PNG — one primitive, two objects. When Rung 2 is
  built, `carrier.seal` should accept a packet body as readily as a `cityKey` chunk.
- **Disclosure levels D2–D4** are the VPKB ladder the guide's pathways already carry; the walk
  a Mage takes is a D4 object (shape + digest, no bodies).
- **M1 terms → the VRC cites a terms digest.** The record's `vrcs[]` carries commitments; a
  commitment over `{intersection, termsDigest}` is the natural shape once Rung 5 exists. Noted,
  not built.

## The Bridges (read from the board's `docs/BRIDGES.md` + `bridges/graphs.mjs`, 2026-09-05 16:30)

The board computes provenance graphs (Knowledge × Promise → Trust) over the Exchange and syncs
them outward. Three seam facts, so the two windows do not build the same thing twice:

- **Two skies.** `bridges/out/star.json` is **Skill Sync's** `starchart.json` shape (packets and
  residents as stars, `build-starchart.js`). The guide's star chart — the one this lane seats
  by posture — is a different instrument: fedwiki pages on the 64-vertex lattice, baked by
  `agentprivacy.guide/tools/star-chart.mjs`. They can meet later in one of two ways: an Exchange
  packet that becomes a wiki page carries a `posture` item like any page, or the guide chart
  reads `star.json` as a remote site. Neither is wired; the lane's chart needs no change today.
- **One packets rule.** The spellweb importer the bridges target (`spellweb.bearer.packets`,
  dedup by `proof`) is the Tracing Protocol shape soulbis `/sigil` already verifies (proof
  re-derives with `proof` excluded; Merkle root over sorted leaves). The City Key's
  `packets {root, count}` digest can commit to a resident's Exchange packets, and `vta_publish`
  could carry that root beside `vrcs[]` — the same "commitment, never content" posture. Noted
  for Rung 5, not built.
- **did:key is the VTA service's form.** The deploy viewer shows `vta import-did --did
  did:key:z6Mk… --role admin`; the Swordsman's `did` is exactly that derivation, so a
  resident's card identity can be imported into its cloud VTA without conversion.

## The City Key loop (read from the board's `docs/CITY_KEY_LOOP.md` + `gate/citykey.mjs`, 2026-09-05 evening)

The board now describes the same flow this lane builds, from the other end: *one object, walked
around the ecosystem, read at the gate*. Four seam facts:

- **`walks[]` is read as defined here** — steps `{slug, vertex, element}`, the element rule, the
  digest, the named moves — and the loop cites the plan. The weave holds without a meeting.
- **Two verifiers, one set of recipes.** `gate/citykey.mjs` (theirs) and `lib/kappa.mjs` +
  `lib/sign.mjs` (ours) re-derive κ, packet proofs, the Merkle root, `did:key` and walk elements
  byte-for-byte, and both pin the `/sigil` conformance vector `sha256:07f20f68…83d1`. That is the
  right kind of duplication (independent copies that must agree) *if* they share one vector file.
  Proposed: a `conformance.json` of vectors (κ of the default key · the Merkle leaves/root · one
  walk element · one VTA record with its signature) kept in `cityofmages/mages-city/` so both
  test suites read the same bytes.
- **The gate's "signature over the canonical key by the card key" already exists — it is the VTA
  record.** `sig` covers the canonical `{kind, publicKeyHex, kappa, prior, at, walks, vrcs}`;
  signing κ signs the canonical key. The gate should accept `proofs.cityKey.vta` and verify it
  with `key_verify(record, key)` rather than mint a second signature scheme. Nothing new to sign.
- **Three additive fields, one ruling.** The board proposes `receipts?: {desk, head, count}[]`
  and `credentials?: [{type, digest, issuer, at}]`; this lane's integration design proposes
  `relationships?: VRC[]`. All three are digests-or-signatures, never bodies, and all three land
  in the master's `city-key.ts` first as additive pass-through. They are folded into one ruling
  in `PLAN_VTA_TRUST_GRAPH_INTEGRATION_2026-09-05.md` §3.1.

**The stand-up decision (deploy/viewer/decisions.json, 17:21):** profile B · edge = pi4 · VTI at
the edge · bare mode · secrets in a vault · CTA = keeper. If the VTI runs on the pi4, the plan's
§8 Q2 has a natural answer: the Swordsman keystore can live on the same edge device as the cloud
VTA, one hop from the Mage on the desk.

**Cross-check (evening dream tick):** ran both verifiers on the same inputs — `gate/citykey.mjs` `walkElement(38, "welcome-visitors", ["b","a"])` and `kappaOf(default key)` equal `lib/kappa.mjs` `elementOf` and `kappaOf` byte-for-byte. The two copies agree today; the shared `conformance.json` proposed above is what keeps them agreeing tomorrow.

## The ToIP record (read from the board's `docs/NOTE_TOIP_2026-09-05.md`, night)

The board's long-form record behind a co-chair post to the DTG credential thread. Seam facts:

- **"VTA" is OpenVTC's word, used as such.** The note speaks of *VTA principals*, `vta-service`,
  `vta.mages.city`, and the VTI unmodified. The plan's §8 Q1 ("is VTA our coinage or a ToIP
  term?") is answered by usage: a Verifiable Trust Agent here is OpenVTC's Verifiable Trust Agent;
  this lane's Mage + Swordsman split is a *local* VTA beside the *cloud* one, not a rival term.
- **The City Key is described exactly as this lane and the guide derive it** — κ over the
  canonical form, the Merkle rule with the published conformance vector, `did:key` from the card's
  key beside the VTA's `did:webvh`, the VEC citing the κ at issue. Three independent readers
  (the sigil pages, `gate/citykey.mjs`, `lib/kappa.mjs` + `lib/sign.mjs`) now say the same thing
  in public.
- **Three zones:** `mages.city` for the agent · `mages.world` for the community that admits and
  decides · `mages.earth` for the shared mediator, DID host and governance frame; `vta.mages.city`
  is the trust-agent host. The discovery map's hosts (`cityofmages/mages-city/DISCOVERY.json`)
  name only `mages.city` subdomains — update the `hosts` block when the zones are ruled.
- **Two of the five vocabulary questions are this lane's shapes:** (3) whether a wiki fork is
  admissible edge evidence beside a VRC or must be lifted into a VWC-witnessed statement — the
  record's `vrcs[]` carries commitments either way; (5) where a receipt sits among the annotation
  credentials — the `receipts?` field proposed in the INTEGRATION plan §3.1a is exactly that
  question in key form. Whatever the Task Force answers lands as digests in the key and
  commitments in the record; the shapes do not change.

## The launch (read from the board's `docs/DECISIONS_2026-09-05.md` + `docs/LAUNCH_2026-09-05.md`, 23:00)

- **The front is live.** `mages.city` and `www` answer 200 from Cloudflare (probed 23:1x); the board's
  D1 is DONE. The Hall, Portal, Exchange and swarm districts are NEXT, behind the tunnel on the
  keeper's host; the VTA farm AFTER the board, on Linux (D4).
- **First commits.** `github.com/mitchuski/mages.city`, private until the launch post (D10);
  two commits at 23:04 and 23:08. **D11: `deploy/` + `docs/DECISIONS_2026-09-05.md` are the
  deployment truth; the master plan is history** — `cityofmages/mages-city/{README,CROSSWALK,
  DISCOVERY.json}` now say so (a `launch` block in the map).
- **D5 credential map, unchanged from this note:** admission → VMC · role → VEC · countersign →
  VRC (self-issued by the sponsor) · a witnessed run → a custom endorsement until a witness type
  lands upstream.
- **The City Key reader is NEXT as the chip's core** ("the chip stops counting and starts
  recomputing") — the `proofs.cityKey` slot filled by `vta_publish` is what it will read.
- **The reflect doors ship WITH THE POST** (the triage's own row: agentprivacy.ai, `JOIN_THE_CITY`,
  soulbis, a Skill Sync deck) — that row is `DISCOVERY.json`; the guide's *The City Board* page and
  the lane pages now read the launch state from it.
- The launch post's destination is `cityofmages/blog/`; the chronicle-reflect gate (signed before
  public) applies to it as to every public reflection.
