# MCP browser-action boundary — 2026-09-08

Added browser_action_prepare to the existing stdio MCP server, with lib/browser-action.mjs and test/browser-action.test.mjs. The proposal binds operation ID, subject reference, exact HTTPS audience/page, action, registered target, content digest and expiry within five minutes. It never authorises or dispatches an effect.

Added a host-owned receipt-verification seam. Synthetic approved-result tests exercise the existing original-packet journey fold and confirm repeated folding does not duplicate evidence. Actual effect idempotency still requires a durable host ledger; no exactly-once browser execution is claimed.

Validation: canon, bridge and Swordsman suites passed; all 12 journey/browser-action/browser-roundtrip tests passed. git diff --check passed. New tests are included in the standard test script; its signing demo was not rerun in this pass.

Publication preparation: documentation distinguishes public source from a hosted service. Added ignore patterns for local credentials/private runtime files. A targeted checkout scan for standard private-key/token signatures returned no matches; tracked filenames matched none of the selected credential/checkpoint/archive patterns. This is not a complete secret scan or git-history audit. No commit, push, visibility change or publication occurred.

Open: authenticated extension/VTA transport, exact-origin consent, durable effect ledger, registered game dispatch and real service receipt verifier. Missing connections are not represented as successful casts or issued credentials.
