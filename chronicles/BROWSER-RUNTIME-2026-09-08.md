# Durable browser action runtime — 2026-09-08

Implemented lib/browser-action-runtime.mjs in the existing MCP repository. The host-owned runtime checks the observed subject/origin/page, requires authorization, reserves a durable pending operation before execution, validates receipt/original artefact, and retains completion. Completed retries reuse the stored result; uncertain outcomes require reconciliation with the same operation ID. Changed intent under an existing ID is rejected.

Five new filesystem/runtime tests pass. All 17 action, runtime, journey and browser-roundtrip tests pass; git diff --check passes. Synthetic adapters and receipt verifiers are labelled fixtures. No live casts or VTA exchanges were performed.

The caller must save the returned evolved bundle in its actual private journey store. The ledger does not imply VTA memory retention. Locks coordinate only processes sharing the same local directory. Crash locks require inspection. Expired pending operations require a separate authenticated historical-status/recovery workflow, which remains to be implemented.

Next connection: host-owned extension transport with real observed browser context, explicit holder/delegation approval, registered game dispatch and a cryptographic service receipt verifier. No unsafe postMessage privilege path or network service was added. No commit, push, deployment or publication occurred.
