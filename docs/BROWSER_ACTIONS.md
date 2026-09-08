# Browser actions: a proposal before an effect

browser_action_prepare creates an intent for extension review through the existing stdio MCP server. No HTTP endpoint or automatic browser dispatch is added.

The caller supplies a stable operation ID, subject DID reference, exact HTTPS origin, page without query/fragment, registered game target, spell.cast or sticker.place, content commitment and expiry within five minutes. An identical current request has the same digest. A changed target/content must not reuse an approved operation ID.

The proposal is not consent, holder authentication or a credential. Target IDs must resolve in a game registry, never as executable code, HTML, selectors or arbitrary URLs.

## Extension and host responsibilities

Derive the real top-level origin/page from browser APIs. Authenticate the holder, scoped delegation and exact approved intent with a fresh challenge. Reject frames, mismatches, expired requests and unregistered actions. Page postMessage flags are not identity.

Before execution, atomically reserve operationId plus intentDigest in durable host storage. Changed digest for an existing ID is a conflict. Return a retained result for a completed retry and reconcile uncertain operations before repeating effects. This tool does not implement that effect ledger. Evidence-fold idempotence cannot prevent duplicate game effects.

The game produces an actual original artefact packet. Its service receipt binds intent digest, operation ID and packet proof. verifyBrowserResult is a library seam for host-owned verification; it is not exposed as an MCP tool accepting caller-provided verifiers. The verifier must authenticate service identity/signature, current status and exact intent. The returned packet must still pass foldJourney validation to enter the private bundle. Retain the receipt in host-owned private storage.

Tests explicitly use a synthetic verifier and packet. They establish rejection behaviour, stdio operation and idempotent evidence folding, not live authorisation, transport or duplicate-effect prevention. Missing adapters remain missing; no browser cast or VTA exchange is claimed.

## Public repository boundary

Publishing source does not publish a hosted service. This server is for a trusted local stdio client: several tools read local paths and sigil_render can write a caller-chosen path. Do not expose it directly as a multi-tenant network endpoint. VTA_MODE hides plain comparison; it does not sandbox filesystem access or authenticate callers.

Keep private keys, credentials, original journey bundles, consent records and runtime ledgers outside the repository. Review full history and the intended publication set before changing visibility. A filename/pattern scan of the checkout cannot establish that history contains no secrets.

## Durable local runtime

`lib/browser-action-runtime.mjs` now exports `createBrowserActionRuntime({directory, adapter, verifyReceipt, now})`. The host supplies an existing private directory, an authenticated browser context, and trusted `authorize`, `execute`, and `reconcile` adapter functions. Run it with `{proposal, bundle, context:{subject,origin,page}}`. These are host integration functions, not remotely caller-supplied code or an automatically enabled MCP tool.

The runtime reserves an operation by writing and flushing a pending record before dispatch. A lock prevents cooperating processes using the same directory from dispatching concurrently. Completion atomically replaces the record after receipt verification and original-packet journey validation. Completed retries reverify and fold the retained result without dispatch. Different content under the same operation ID is rejected. Lost replies/invalid results stay pending and require reconciliation, never blind execution.

The host must persist the returned evolved bundle in its actual private journey store. If that final save fails, retrying against the previous bundle returns the same retained artefact. Do not infer that returning a bundle has saved it in the VTA.

This protects cooperating local processes, not distributed replicas with different ledgers. It is not encrypted storage and does not manage Windows ACLs. Use a host-owned directory outside repositories and public/sync/export folders. File contents are flushed; directory metadata durability after power loss depends on the filesystem. A crashed writer may leave a lock that requires operator inspection; locks are not automatically deleted. Source context must come from trusted browser/holder observation, never the website request body.

The current runtime requires an unexpired proposal even to replay/reconcile. A pending operation past its deadline must be investigated through a separate authenticated service-status workflow; do not mint a new operation and repeat its effect just to bypass expiry. Historical recovery is a remaining integration task.

Five filesystem/runtime tests cover reopen/replay, lost responses, concurrency, consent/context denial, invalid artefacts, retained locks and expiry during consent. These use synthetic game adapters and receipt verifiers. Live extension dispatch, VTA authentication and cryptographic service receipt verification remain unconnected.
