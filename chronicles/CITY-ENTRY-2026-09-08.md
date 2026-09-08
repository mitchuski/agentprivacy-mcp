# MCP City entry integration — 2026-09-08

Added city_invitation_draft and experience_route to the existing MCP server. Invitation/offer/request/mark drafts retain publish:false, carry a draft digest and explain approval plus the existing Portal signing envelope. No send/sign/publication or credential operation is exposed. Static route guidance connects arrival, learning, key custody, casting and collaboration to existing tools and site entry points.

Updated the Mages City agent skill with a link to site/mcp-entry.md, and added the cross-site workflow to MCP docs/CITY_ENTRY.md and README. The human's compact Star control and agent's tool entry are complementary. Existing MyTerms, VRC, task and admission checks remain separate.

Validation: all 20 entry/action/runtime/journey/browser tests passed. A direct compatibility check against the existing Portal parser confirmed that publish:false drafts are refused, the explicitly approved event shape parses, and an unsigned invitation is still refused. City static-front verification passed. No Portal message was sent; no site deployment, commit, push or repo visibility change occurred.

Remaining live connections: authorised transport, existing AgentCard signer invocation, actual VTA/extension consent, game dispatch and verified result receipts. Route guidance is not live service discovery.
