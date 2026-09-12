# TODO: observe and share Star collections through MCP

Date: 2026-09-10
Status: deferred exploration; start after the Star visual/data contract stabilises.

## Intent

The Star is being explored as a future wallet interface for VTA declarations, signatures and ZK proofs. Folding organises their measured byte footprints; a circuit path illustrates traversal through the collection. MCP should eventually expose the underlying collection and events without interpreting rendered pixels.

The current local prototype uses signature-size metadata, including classical and PQC profiles. Folding does not compress bytes, verify signatures, execute proofs or produce an attested trace. The spherical overlap experiment does not measure mutual information or additional capacity.

## Proposed work

- Define stable record IDs and a versioned collection schema. Distinguish declarations, public verification keys, signatures, proofs and references. No secret signing material is needed for observation.
- Define explicit vertex assignments with their model meaning and provenance. Do not infer a sovereignty state from byte length or algorithm.
- Instrument selection, fold/unfold and traversal as visual events with sequence numbers, collection revision and mapping version. An observed visit must remain distinct from a verification result.
- Add separate verification result records with the algorithm or proof system, statement/public-input reference, verifier version and result. Unsupported and unverified are distinct from invalid. Signature validity alone does not establish claim truth or permission.
- Design read-only MCP interfaces for collection summaries, authorised record inspection, path inspection and bounded event-log reads. Prefer pure functions over explicit snapshots, consistent with this repo's existing architecture. Do not silently add a browser polling service or global observer.
- Define observation scope: aggregate byte totals, selected references, or explicit public evidence. Revealing identifiers, relationships and traversal order can itself disclose information. The user chooses which snapshot or subset is exposed.
- Define a shareable path manifest: ordered record and vertex references, transitions, collection/mapping versions and selected evidence. Distinguish a planned route, an observed execution and an attested execution. Sharing a path does not implicitly export the full collection.
- Reuse existing City Key parsing/derivation and snapshot conventions where applicable. Keep existing derivation verdicts distinct from cryptographic signature verification.
- Specify replay and provenance: logs are observations unless authenticated; include truncation/sequence gaps and avoid treating a visual event log as tamper-proof evidence.

## Start gate

Proceed when stable IDs, serialisation, byte-accounting boundaries and deterministic path semantics are agreed. Confirm the visual selection maps to the same records after fold/unfold and export/import. Establish the disclosure policy before connecting an observer.

## Acceptance checks

The same snapshot gives identical totals and references in the UI and MCP. Geometry changes preserve measured bytes. Selecting a component does not reduce the collection total. Unsupported evidence remains explicitly unverified. An exported subset contains only the selected data and necessary disclosed dependencies. A trace cannot report verification merely because its marker visited a region.

This is a future task note only; it adds no MCP tools, service or external transmission.
