# Formally verified parts of this repository

Sealed in the κ registry: formal_mage evidence bundle `evidence/2026-10-26_75`, root `sha256:d4d42f9e333323b20d5b649525cbe28f8885fa2cb0cdd10943a04cac3793b9da` (75 theorems, 75/75 within the standard axioms).

Code here whose behaviour carries a machine-checked receipt in `formal_mage` (Lean 4, core library, kernel-checked, axiom-audited). `node tools/formal_census.mjs <this repo>` in formal_mage fails if a tag names a theorem outside the audited census.

| Claim | Code | Status | Tag |
|---|---|---|---|
| The Star Hold /2 root (κ registry tree) is a tree over exactly the refs; a proof that climbs to it carries one of them | `lib/merkle-kappa.mjs` holdRootV2 / holdVerifyV2 | proved (code loop) | formal: proved formal_mage:Formal.MerkleCode.code_disclosure_sound |
| Every proof `holdProofV2` generates climbs to the root | `lib/merkle-kappa.mjs` holdProofV2 | proved (code loop) | formal: proved formal_mage:Formal.MerkleCode.proof_complete |
| The legacy packets root (journey packets, Hold /1) is a tree over exactly its leaves | `lib/kappa.mjs` merkleRoot | proved (code loop) | formal: proved formal_mage:Formal.MerkleCode.rootP_tree |
| The lattice helpers match the Lean reference on all 4,096 ordered pairs (differential: formal_mage `checks/lattice_diff.mjs`) | `lib/lattice.mjs` | checked | formal: proved formal_mage:Formal.Moves.flip_is_edge |
| succ and bnot coincide at exactly 31 and 63; neg never coincides with either (moveName's precedence resolves the overlap) | `lib/lattice.mjs` moveName | proved | formal: proved formal_mage:Formal.Moves.succ_eq_bnot_iff · formal: proved formal_mage:Formal.Moves.neg_never_succ_or_bnot |
| Canonical JSON is injective on JSON values: equal canonical text means equal value, so κ names one value | `lib/kappa.mjs` canonicalJSON | proved (model) | formal: proved formal_mage:Formal.CanonJson.enc_injective |
| Two different ref sets never share a Hold /2 root | `lib/merkle-kappa.mjs` holdRootV2 | proved (code loop) | formal: proved formal_mage:Formal.MerkleInj.codeRoot_injective |

Since 2026-10-26 `canonicalJSON` refuses values that are not JSON (NaN, Infinity, undefined), as star-key `star-registry.ts` does, so the injectivity theorem covers every value it accepts (formal_mage O12b; test `test/hold.test.mjs`).
