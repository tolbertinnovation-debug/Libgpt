# Phase 2 execution Stage 1 — disabled preparation

The [final security review](pr66-security-review.md) supersedes the original implementation details where it adds stricter saved-state validation, project continuity, effective resource bounds, raw-byte accounting, bounded cleanup retries and TLS conflict handling. Pre-review nonempty mock ledgers missing the new safety counters fail closed; no production migration or automatic history reset is performed.

This increment starts from production PR #65 (`e449076`). It is preparation for execution, not an enabled full-stack runner. Real secure execution remains hard-disabled; no provider SDK, sandbox, provider key, enabling route, paid allowance, or new service is introduced. All new execution results are explicitly synthetic and `executed:false`.

## Implementation

- `server/build-execution.js`: immutable disabled adapter; validated source manifest; declared capability compatibility checks for isolation, egress, secrets, database access, persistence, cleanup, supported checks and all six resource bounds. Readiness exposes distinct not-run/not-verified categories. A declared profile is not evidence a provider enforces it.
- `server/execution-attempts.js`: provider-neutral mock state machine, with injectable transactional storage and no provider/transport invocation. Tracks source hash, project/generation, attempt identity, hashed capability, bounded retry lineage, controller claim, cleanup and conservative mock quota usage. Default quota is zero. One unresolved attempt holds the slot even across UTC rollover. A duplicate identity returns its existing attempt; source/generation changes cannot overwrite it. Terminal failure requires an explicit retry; at most two retries and no duplicate child of a previous attempt.
- Claims are random and expiring. Cancellation fences late writes. Expired work becomes unknown, retaining its slot; it is not restarted. A reconciled synthetic provider identity and a fresh cleanup claim are necessary before the slot is released. Reserved-but-never-claimed work can be cancelled without cleanup. Full reserved mock quota remains charged on failure/cancellation; ambiguous work is never refunded.
- The SQL storage implementation uses a caller-supplied pool, scope isolation, transactions, row locking, lock/statement timeouts and rollback. Its bounded ledger stops at 1,000 attempts rather than deleting history. It is NOT imported/mounted by the production app and does not run a production migration. PGlite tests exercise persistence and transaction behavior locally. No actual provider idempotency, stop, deletion or reconciliation behavior is established.
- Result envelopes must match source, generation and the exact ordered check set. Real success statuses, unknown fields and forged runtime claims become unknown. Only `mock_passed`/failed synthetic results are accepted, and they cannot grant a release token or change production readiness. Logs are byte-bounded, oversized chunks halt acceptance, overflow prevents mock success, and common credential/control-sequence forms are redacted. Redaction is heuristic; future log rendering must escape text and never trust project HTML or terminal output.
- Plan now explicitly separates source checks, frontend observations, unexecuted builds/tests, and unverified backend/database/authentication. New cache versions ensure clients fetch the updated view. Source reviews, approval gates and task behavior remain intact.

## PostgreSQL correction prepared in code

Both production pool constructors now use `server/postgres-options.js`. The helper normalizes legacy SSL aliases to explicit `sslmode=verify-full`, preserves URL parameters (including CA and channel-binding), and forbids a separate SSL object that pg's URL parser could overwrite. Remote URLs without a mode also require full verification. It rejects duplicate/unknown TLS modes and explicit remote verification bypasses. Plaintext remains possible only for an explicit loopback test host. Query-string host overrides are checked: `localhost?host=remote` cannot bypass that rule.

This changes connection options only when the proposed code is eventually deployed; no production environment variable, secret, database or administrator setting has been modified. Existing custom insecure remote configurations would fail closed rather than silently connect. Operators need to review compatibility with their current CA/host configuration before approving deployment. Unix-socket/empty-host URL formats are intentionally not supported by this helper; do not adopt this change for such a deployment without adding reviewed support.

Offline tests cover parser behavior, absence of the warning, retained CA/channel-binding options, hostname mismatch rejection, duplicate parameters, insecure modes, query-host override and both constructor call sites. These do not constitute a live certificate handshake test, CA rotation test, or database connectivity test.

## Frontend preview permission review

The existing iframes omit `allow-same-origin`, protecting the parent application's DOM/storage origin. This is useful but not a deny-all network boundary. Generated external `<script>`, stylesheet, image, fetch and form requests can still be attempted; the visible preview also permits popups and modals. Browser policies/CORS restrict reading responses, not every outbound request. Browser checks also cannot reliably preempt an infinite loop in the same renderer. Consequently the preview must remain labeled frontend-only.

No iframe permission/CSP changes are made in this PR: blanket removal would break existing CDN assets, forms, navigation and preview behavior without an asset policy and compatibility tests. Proposed separate hardening:

1. Inventory external asset needs and add an explicit restricted-preview mode; start with `connect-src 'none'`, `form-action 'none'`, `object-src 'none'`, `base-uri 'none'` and narrowly reviewed image/style/script rules. Enforce policy before project code, not after its scripts execute. Do not assume a meta CSP is equivalent to an isolated response origin/header policy.
2. Serve previews on a dedicated credential-free origin with no application cookies, tokens or authenticated backend proxy. Preserve no-same-origin isolation and validate postMessage source plus per-check nonce. Do not loosen CORS on production APIs.
3. Make popup/modal/form capabilities explicit opt-ins and test ordinary links, local CSS/JS/images, downloaded projects and phone layouts before changing defaults.
4. Use network interception in browser acceptance tests to prove the intended allow/deny behavior, including redirects and navigations. Never claim iframe sandbox flags alone enforce a network firewall.

These are documented improvements, not implemented enforcement. Preview outbound network permissions remain a known limitation.

## Validation and release boundary

New regression cases exercise concurrent reservation/claim, idempotency, owner denial, source/generation fencing, quota exhaustion, bounded retries, worker/cleanup interruptions, unknown/forged responses, no automatic restart, cancellation and log limits. PGlite checks retained state, denied-write rollback, cross-instance claim contention and scope separation. Existing administrator tests verify no route or query parameter activates execution and no visitor can raise budgets.

Browser regressions use mocked AI/jobs and local application assets at 320×740, 390×844 and 1440×1000. They cover Plan verification categories, Continue, Stop, request-history changes/reload, Changes and a real frontend fixture preview. These are not backend execution tests or physical Android testing. Test/build/CI results for the final commit are recorded in the draft PR report.

The $0.50/day platform, $0.20/day Coding and two-paid-AI-call controls are unchanged. Mock quotas are synthetic units, NOT a second real spending allowance. Any future metered execution needs worst-case atomic reservations against the existing platform and Coding totals, not only these mock counters. Quota/billing entitlement and provider limits must be independently verified before enabling anything.

Remaining blockers: approved isolated provider, entitlement/use eligibility, actual resource enforcement (the current 256MiB/64MiB/PID contract cannot be assumed on a larger VM), trusted external acceptance tests, safe dependencies/images, real provider lifecycle/reconciliation, cost reconciliation and a reviewed integration with current project ownership. This module's capability hashes protect its records; it does not itself verify a capability against the existing cloud job row. A future controller must authenticate that job and its current generation before admission. No new production execution controls or schema migration should be wired until reviewed.

Human review is appropriate for this disabled increment only. Full-stack execution, database/authentication verification and real sandbox cleanup remain incomplete. Do not merge/deploy without owner approval. Development branch `codex/phase2-execution-stage1` has automatic Vercel deployment disabled before its first push.
