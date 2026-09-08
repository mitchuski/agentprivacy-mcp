# MCP task engine: VTA + Star knowledge spaces

8 September 2026 · integration design, not a live-service claim.

Canonical contract: [The agent knowledge space](../../cityofmages/mages-city/KNOWLEDGE_SPACES.md). Shared backlog: [KS-01–KS-07](../../cityofmages/mages-city/KNOWLEDGE_SPACE_TASKS.json).

Own KS-01 and KS-05; coordinate KS-03/04 through authenticated adapters. Use site_context to bind a supported URL to its baked revision; use browser_action_prepare only as a reviewable proposal. Neither implies browser access or permission to write.

Introduce a versioned wiki task adapter only after its receiving service exposes a supported grant and operation contract. Its inputs bind subject, audience, space ID, action, expected page revision, payload digest, operation ID and expiry. Do not accept endpoint URLs or executable code from an imported key. Keep prepare, authorize, execute and retain distinguishable.

Reuse journey evidence retention and κ/prior evolution. Preserve actual receipt bodies privately; graph projections and digests alone cannot reconstruct them. The prototype Star receipt tools use asynchronous WebCrypto; the current synchronous dispatcher must await them before registration. New task names are local proposals until registered/supported elsewhere.
