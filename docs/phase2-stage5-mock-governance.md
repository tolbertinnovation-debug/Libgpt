# Phase 2 Stage 5 — persistent mock governance and evidence

27 October 2026. Production baseline: PR #68 merge `2a0c01eb01321e95c395be9fba607cb621452da8`. Development branch: `codex/phase2-stage5-mock-governance`.

**Scope:** disabled preparation only. Live execution remains NO-GO. No provider SDK/transport, process runner, execution-enabling route or production persistence integration is added. No production database, secret, administrator setting, AI budget or billing setting is changed. The branch disables its own Vercel automatic deployment before its first publication. Do not merge or deploy without separate approval.

## Audit and reuse

Reused the Stage 3 provider-neutral infrastructure controller and HMAC full-stack contracts, existing disabled execution adapter, ownership/source hashing and named checks, Plan view and source verification. The existing controller already provided expiring synthetic approvals, default-deny administrator/project/quote/settlement callbacks, atomic storage transactions, duplicate identities, worker fences, unknown-operation holds and bounded cleanup. The gaps were a concrete durable storage adapter, billing-final reconciliation, persistent evidence identities/nonce ownership, and clearer workspace distinctions.

## Persistent offline infrastructure storage

`server/mock-governance-storage.js` provides an explicitly supplied pool adapter, without importing `pg`, reading environment variables or constructing any pool. Construction/import performs no SQL. Only an explicit `initialize()` creates the additive `public.grandpa_mock_governance_v1` table. The module is unmounted; application startup and existing pools never call it. Tests supply only local PGlite databases, including temporary disk databases closed and reopened during tests. No submitted SQL or generated application was run.

Rows are partitioned by infrastructure/evidence purpose and explicit `mock:` scope. INSERT-on-conflict and SELECT FOR UPDATE serialize initialization/admission, and state plus audit and revision update commit in one transaction. A revision predicate guards lost updates; rollback preserves both audit and reservations. Bounded canonical JSON, checksum verification and controller schema validation fail closed on corruption. Checksums detect accidental storage corruption; they are not protection against a database administrator who can rewrite the record and checksum. Dedicated host storage is trusted.

Schema initialization is idempotent and additive. There are no DROP, migration-on-import or production connection fallbacks. Unknown/missing schemas or state versions fail closed. Rollback means disabling the new caller without deleting reservations/history; do not restore an old state snapshot that omits liabilities. Old Stage 3 infrastructure state without `observedAt` is accepted and upgrades transactionally; existing attempts/approvals are preserved. An old settlement lacking the new billing fields is conservatively rejected, not silently refunded. These are offline interface changes, with no mounted production consumer.

The adapter's transaction callback is trusted controller code, never a user-supplied function. Driver errors are sanitized; controller errors are reclassified by the outer mock controller. No claim of real concurrent multi-host testing is made: PGlite is a local PostgreSQL engine, and tests serialize its single session while exercising independent controller instances and real rollback/SQL behavior. Production distributed load tests and a live storage rollout are incomplete.

## Holds, cancellation and reconciliation

`server/infrastructure-quota.js` retains the complete reservation until a trusted mock settlement confirms all of: matching source/generation, `simulation:true`, `executed:false`, cleanup confirmation, `resourcesBillable:false`, `billingFinal:true`, bounded known actual usage, and the configured trusted verifier returning exactly true. Merely reporting that cleanup succeeded is insufficient. Missing fields, unknown response shapes and thrown verification errors fence the old worker, mark the result unknown and retain the hold. No charge is refunded on a failed/unconfirmed started operation.

A reserved attempt that never received a worker claim can still be cancelled with zero known use; no provider exists and no operation was dispatched. Claimed/cancelled/unknown attempts retain liabilities across restarts and UTC rollover. Cleanup remains limited to three claims, with failure/manual reconciliation retaining the liability. A final confirmed settlement records actual usage; an overrun pauses admissions rather than raising limits. This simulates accounting only; it cannot stop an infrastructure invoice.

The last successful observation time is persisted even on status reads, closing rollback gaps between audit events. A clock moving backwards or backwards during a transaction fails closed, retaining prior state. Forward clock changes can expire claims, but cannot refund claimed work; recovery preserves unknown costs. Operator intervention may be needed after clock faults.

Synthetic approval remains default-deny, expires, and cannot accept real provider identities or authorize live spending. Real readiness always reports zero allowance and disabled execution. The live AI ledger remains separate: $0.50 platform AI/day, $0.20 Coding/day inside it, two concurrent paid AI calls. No combined live AI/infrastructure monetary bridge or provider-side hard stop is implemented or claimed. Because no real infrastructure admission exists, no real infrastructure allowance is created.

## Trusted mock verification evidence

`server/trusted-mock-evidence.js` wraps existing mock full-stack contracts with trusted producer/verifier identity configuration, key IDs, durable challenge issuance and replay records. Producer and verifier identities must differ and use mock namespaces. Keys are copied from trusted configuration, never accepted from report input or stored in the ledger. There is no signing endpoint. Missing attempt authority denies issuance.

A trusted host resolver must return a current running mock attempt. Ownership is independently checked against the supplied capability hash; project, source hash, generation, expiry and private worker fence are bound to the challenge. Challenges are idempotent per attempt, random, short-lived and persistent; changing expectations, source, verifier identity or fence cannot reuse them. Verification re-resolves the current attempt, verifies the registered key and domain-separated HMAC through the original contract verifier, and consumes the nonce atomically. Identical replay is idempotent; altered replay is denied even if freshly signed. Expiry, clock rollback, cancelled workers, stale generations, changed source/project and rotated key identities deny acceptance.

Output remains `mock_passed`/`mock_failed`, `simulation:true`, `executed:false`, `independentlyVerified:false`; backend/database/authentication remain `not_verified`. Evidence calls the independence level `identity_separated_mock_only`. Distinct identities are a mock protocol boundary, not proof that an actual independent actor or isolated verifier ran. The host owns the resolver, cases, storage and key registry. No guest receives a key; no provider attestation, generated backend, database migration or actual login is tested. Durable audit tracks issuance and accepted verification with bounded history, without raw capability tokens or private fences.

## Coding Workspace

New `public/build-verification.js` renders explicit Planned, Generated, Simulated, Executed, Independently verified, Backend/database/authentication and Failures rows in a collapsible disclosure across workspace tabs and within Plan. Generated means saved source, not tested functionality. With real execution disabled, the display always says not executed, awaiting real evidence and not verified. A mock project result is not connected to the production workspace; the simulation row says so instead of fabricating a passed result.

Saved/imported project verification flags and iframe messages cannot grant real verification. Plan approval and source presence are not runtime evidence. Failure labels direct users to task/source findings without inventing a runtime result. The disclosure preserves its open state on workspace redraw; mobile text wraps with a bounded scroll area. Existing Plan coverage, source checks, preview restrictions, diagnostics and unloading remain available. Cache versions change while preserving the shared build module's original identity.

## Validation

Final suite: **619 tests passed, zero failed/skipped** (25 additional to PR #68). Node 22/24 GitHub CI must be checked on the published draft head. Local production build passes, 50.3 MB output. An initial full run caught a Plan test fixture missing the new renderer dependency; the fixture now uses the actual renderer and checks the new coverage labels. No application feature was disabled to satisfy that test.

New/extended mocked tests cover: explicit initialization/default zero, pool/scope separation, concurrent duplicate reservation and claims, rollback/digest corruption, actual disk reopen with retained holds and stale fencing, durable nonce replay after disk reopen, unknown cleanup/settlement responses, billing-final checks, cancellation races, backward clocks, independent mock identities/default denial, source/project/generation/fence binding, key rotation, concurrent issuance/verification, unsigned/altered and signed conflicting replay, queued input mutation, and imported UI success flags.

Responsive Chromium at 320/390/1440 px passes with the verification disclosure opened, no horizontal overflow/page errors and explicit not-executed/not-verified labels despite imported success flags. Existing locally intercepted standard/restricted resource probes, diagnostic flood (30 bounded combined UI findings), parent/top navigation denial and unload checks pass. Backend APIs are blocked and configuration mocked; zero model/provider calls. Screenshots are local test evidence, not physical Android testing. Plan content is additionally exercised by the automated rendering regression.

## Remaining limitations and recommendation

No unresolved critical/high or merge-blocking medium issue is identified for disabled preparation, subject to final CI. Existing medium preview limitations remain: self-navigation can bypass initial CSP, browser CPU/memory and message deserialization are not isolated, and same-frame reports are forgeable. No live infrastructure quota, commercial entitlement, exact resource enforcement, independent runtime attestation or complete full-stack verification is delivered. Current provider/resource and financial activation blockers remain NO-GO.

Persistent mock storage is implemented and tested offline, not migrated or connected to production. Histories and serialized size are bounded and fail closed for maintenance; no automatic pruning or approval increases occur. The production execution adapter and administrator/TLS paths are unchanged. No new dependencies or paid services are introduced.

Recommendation: safe for human review and merge as **disabled preparation only**, after successful CI and explicit owner approval. Live provider activation needs a separate commercial, security, resource and funding review and explicit approval.

Important files: `server/mock-governance-storage.js`, `server/trusted-mock-evidence.js`, `server/infrastructure-quota.js`; `public/build-verification.js` and workspace integration in `public/ritual.js`, `public/index.html`, `public/styles.css`, `public/app.js`; new storage/evidence/status tests, extended infrastructure and Plan regressions; branch deployment exclusion in `vercel.json`; this report.
