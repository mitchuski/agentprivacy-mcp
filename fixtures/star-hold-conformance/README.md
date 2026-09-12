# Star Hold conformance pack

Fixtures for a receiving implementation of the seam agreed in [Flaxscrip/hearthold#90](https://github.com/Flaxscrip/hearthold/issues/90): *the Star presents; the receiver verifies and enforces.* A verifier that reproduces every expectation here reads the Star's bytes as the Star writes them.

Everything is deterministic: one published test seed, fixed timestamps, fixed pixels. Regenerate with `node scripts/star-hold-conformance.mjs`; check for drift with `--check`. `node verify.mjs` in this folder is a zero-dependency checker (node:crypto and node:zlib only) you can copy next to the fixtures and run on your side.

## The rules the pack locks

**City canonicalization profile (Law L5).** `kappa = "sha256:" + hex(SHA-256(UTF-8(canonical(key without top-level kappa))))`. `canonical` sorts object keys recursively (default JavaScript sort, code-unit order), preserves array order, encodes primitives with `JSON.stringify`, emits no whitespace. Unknown fields stay in the preimage; `prior` is content; `kappa` is the only excluded field and only at the top level. This is not RFC 8785 JCS. The credential signature layer (`eddsa-jcs-2022`) canonicalizes with JCS separately; the two never meet.

**`agentprivacy.vta/1` record.** The bearer's Swordsman signs `canonical({kind, publicKeyHex, kappa, prior, at, walks, vrcs})` with defaults `prior → null`, `walks → 0`, `vrcs → []`. Ed25519, pure (no prehash), over the UTF-8 preimage bytes. `publicKeyHex` is 32 bytes lowercase hex; `sig` is 64 bytes lowercase hex. Hex case is preimage-significant: uppercase input changes the signed bytes and the signature fails, so a conforming verifier rejects rather than normalises. `at` is required. `did` and `participantId` are optional and must derive from `publicKeyHex` (`did:key:z` + base58btc(`0xed 0x01` ‖ key); `ap-` + first 16 hex characters). A verifying record is a bearer attestation, not a delegation, a grant or a receipt.

**Bound-signer challenge** (the shape in hearthold PR #92). Preimage = `canonical({nonce, kappa, audience, exp})` under the same profile; the response is an Ed25519 signature by the record's key. Order of checks: record, κ equality, expiry, signature. The nonce is single-use on the receiver.

**PNG carriers.** A City Key travels inside its sigil image. Carrier A (soulbis `/star`, `/lattice`, `/sigil`, the Swordsman): `tEXt` chunk before `IEND`, keyword `cityKey`, text = base64 of the key JSON. Carrier B (the guide star-chart keepsake): `iTXt` chunk, keyword `citykey`, uncompressed, text = the key JSON itself. A signed sigil adds `tEXt cityKeySig` = base64 of the record JSON. Readers accept both carriers and re-derive κ from what the image carried; pixels are not part of κ.

**Merkle roots** (`packets` and `holds`). Leaves sorted once; each round pairs `left|right` as `"sha256:" + hex(SHA-256(UTF-8(left + "|" + right)))` over the prefixed strings; an odd tail is promoted unchanged; the empty set is `null`.

## Files

| file | locks |
|---|---|
| `city-key.fixture.json` | seven cases (`minimal`, `unnamed`, `nested-order`, `full`, `unknown-field`, `unchanged-reexport`, `mismatch`), each with the key, its canonical bytes, its κ and the expected verdict; the packets Merkle vector and the Hold root vector carried by `full.holds` |
| `vta-record.fixture.json` | the test key (seed, public key, did:key, participantId), a record signed over `full`'s κ, the record a City resident publishes on its proofs page, and three records that must fail (uppercase hex, tampered, did mismatch), each with preimage and preimage digest |
| `challenge.fixture.json` | a challenge, its preimage, the test key's response, and the verdicts at three moments |
| `png-carrier.fixture.json` + three PNGs | carrier A, carrier A with `cityKeySig`, carrier B; file digests, chunk lists, the κ each unfolds to |
| `verify.mjs` | the self-contained checker |

## Origin

The bytes come from the code that produces them in use: `lib/kappa.mjs` (`canonicalJSON`, `kappaOf`, `merkleRoot`), `lib/sign.mjs` (`recordBytes`, `sign`, `verifyRecord`), `lib/png.mjs` (`embedKey`, `withTextChunk`, `extractKey`). The `full` key and the Hold root are the Star Hold runtime's fixture (`test/fixtures/star-hold.fixture.json`, seven retained items, root `sha256:909e1f2e…`). The farm record is public data from a mages.city resident site. The test seed `0x01 × 32` is published on purpose and is never a bearer.
