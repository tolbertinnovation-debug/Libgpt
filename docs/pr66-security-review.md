# PR #66 final security and regression review

Date: 27 October 2026. Original reviewed head: `af7c416b7119709c5b5f276da20b7f72e8cea901`; production base: `e449076a2c249a30c8fa00f94a14a4634723926f`. The final corrected commit and its CI results are recorded in PR #66's description. Review covers every original changed file and the corrections below. This is a fresh code/regression review, not an external penetration-test certification.

## Recommendation

Suitable for human review and merge as **disabled execution preparation only**, subject to owner approval and successful final CI. No unresolved critical/high issue was identified in this bounded scope. Do not interpret that as approval to enable a runner or as full-stack application verification. The existing preview networking limitation remains, as do the provider-integration blockers listed below. Do not merge or deploy without explicit owner approval.

## Severity-ranked findings and corrections

| Severity | Finding | Correction / boundary |
| --- | --- | --- |
| Medium, fixed | Missing, nonnumeric or undercounted saved mock usage could defeat numeric quota comparisons; missing raw-output/cleanup counters could reset limits. | Validate ledger structure and counter ranges before and after transitions. Reconcile daily usage against retained attempts. Missing required safety history fails closed instead of assuming zero. |
| Medium, fixed | Capability check lists accepted strings; sparse report arrays could skip validation. Lower declared resource bounds were validated but replaced by larger manifest defaults. | Require dense, unique named checks, canonical requirement ceilings, complete isolation declarations and bounded integers. Retain effective bounds in attempt identity, quotas, logs and expiry. Sparse reports become unknown. |
| Medium, fixed | Once a previous attempt completed, a different capability could reserve another attempt for the same project; an older generation could be retried after newer work. | Preserve the existing project's capability across retained attempts, reject generation rollback, and include source/checks/resources/retry lineage in idempotent identity. This does not establish ownership for a project's first admission: future integration must verify the existing cloud job capability first. |
| Medium, fixed | Output accounting used redacted bytes, allowing large raw streams consisting of stripped/control/secret-like text to evade the intended bound. | Count UTF-8 bytes before cleaning, bound raw and retained output independently, retain truncation and prevent mock success after overflow. Reject oversized chunks before encoding/copying them. |
| Medium, fixed | Cleanup failures could be reconciled and retried indefinitely; confirmation accepted extra forged fields. | Maximum three cleanup claims, expiring unique claim keys, exact confirmation fields and synthetic provider identity. Failure/unknown state holds the single slot and requires reconciliation; exhaustion never authorizes another create. |
| Low, fixed | Pool acquisition errors occurred before the storage error sanitizer and could expose raw connection diagnostics. | Acquisition, transaction, rollback and release are guarded together; acquisition failures return a generic storage error. No connection URL or password is returned. |
| Low, fixed | Conflicting/unsupported SSL settings could be silently ignored; an undefined connection URL returned before rejecting separate unsafe SSL options. Custom CA testing previously checked URL preservation only. | Reject unknown/duplicate/conflicting SSL and negotiation settings, no-verify modes, ignored `sslca`, and undefined connection URLs. Add a synthetic public CA fixture and inspect actual pg client TLS options offline, retaining CA and hostname verification. |
| Medium, existing limitation | Frontend preview can attempt outbound network requests and permits forms/modals/popups under its existing iframe policy. | Confirmed with an intercepted synthetic egress request. Parent DOM/storage access was denied. No broad permission/CSP change is made because it would require a separate compatible asset/interaction policy. The preview is not a deny-all execution environment. |

The execution/cleanup/counter findings affect the unmounted mock preparation module. There was no live sandbox, paid execution endpoint or real provider report path to exploit. They nevertheless needed correction before reuse. The TLS findings are fail-closed configuration hardening; the old remote alias normalization already selected verified TLS, and this review found no HTTP route that changes database URLs or administrator TLS policy.

## Security properties reviewed

- Production adapter remains immutable and hard-disabled. Constructor arguments, forged enable fields and public execution query/method probes cannot enable execution. There is no provider SDK, process runner, network client or activation endpoint in the adapter.
- Every stored mock attempt is scoped, source-hashed, generation-bound and capability-protected. Worker and cleanup keys are random, private in public snapshots, expiring and invalidated on cancellation/recovery. Concurrent claims are serialized transactionally. A replayed identity returns its existing result without a new reservation.
- Unknown create/results and failed cleanup retain the slot across daily reset; they are not silently refunded, relaunched or passed. Expired reservations that never claimed work can be cancelled. Recovery is idempotent for already-unknown work. Model retries remain explicit; mock execution retries are bounded to two and cleanup claims to three.
- Mock quotas default to zero and do not configure real money. Daily CPU/run usage is reserved atomically; conservative usage is retained on failure. The financial ledger, policy ceilings and paid AI concurrency logic are unchanged.
- The SQL adapter remains unmounted. Importing it does not create a table or pool. Schema creation and state writes occur transactionally only when a caller explicitly uses a supplied pool. A failed initialization rolls back the table; an existing compatible table's extra column/data survive; unsupported saved versions fail without overwriting records. There is no DROP, DELETE, automatic migration of unknown state, or production database operation.
- Raw and retained logs are bounded. Common credentials/terminal controls are redacted, but heuristic text redaction is not complete data-loss prevention and does not promise detection of encoded or fragmented secrets. No production credentials enter a mock runner; any future log UI must escape text rather than render HTML.
- Source-hash integrity uses the existing complete artifact hash. Mock reports require matching source, generation, synthetic identity and exact check names/statuses. A synthetic `mock_passed` always remains `simulation:true, executed:false`; it cannot issue a release approval/token or prove real code execution.

## PostgreSQL TLS review

Both existing pool constructors use the same helper. Legacy modes become explicit `verify-full`; custom CA and channel-binding parameters are preserved. Explicit remote plaintext/verification bypasses, duplicate TLS parameters, contradictory flags, invalid negotiation values and URL/config SSL-object mixing are rejected. Query-string host overrides cannot disguise a remote destination as localhost. Local plaintext fixtures remain supported only for explicit loopback destinations.

Offline verification loads the synthetic CA into real `pg.Client` connection parameters (without connecting), checks that certificate verification and hostname checking are not disabled, validates the fixture's matching hostname and rejects a mismatching hostname, and creates a TLS context with the retained CA. The private key used to generate this public-only test fixture was discarded; no production certificate or key was read. The parser no longer emits the alias warning. Warning suppression, libpq weakening, `rejectUnauthorized:false` and TLS environment bypasses are not used.

Limitations: no live database/TLS handshake, expired/untrusted-chain handshake, CA rotation or production connection-option compatibility test was performed. Undefined/env-only connections, Unix socket formats and explicitly insecure remote URLs fail closed; review deployments relying on those before approving the code's release. A pre-review nonempty mock execution ledger missing raw-output/cleanup counters now stops for explicit reconciliation/migration instead of inferring forgotten history. This mock schema has never been wired to the production app.

## Actual validation

- Baseline re-run at the original draft: **516 tests passed**, zero failures/skips.
- Corrected full suite: **550 tests passed**, zero failures/skips (34 added cases). Final Node 22/24 CI results are recorded in the PR description. All automated provider operations are mocks. No actual sandbox or paid model call was made.
- New regressions cover counter corruption/deletion, quota undercounts, dense check lists, lower effective limits, project capability continuity, generation rollback, raw log accounting, cleanup retry exhaustion/forged confirmations, sanitized pool acquisition failures, schema rollback and preserved existing data, conflicting TLS flags and actual custom-CA client options.
- The existing suite still covers financial caps, atomic monetary reservations, two paid-call admission, research accounting, administrator lockout, request history, pause/resume/cancel, stale jobs, static checks, source review/release gates and disabled execution routes.
- Local Nitro production build passed (~50.3 MB); no dependency/lockfile change. Diff whitespace checks passed.
- Chromium checks passed at **320×740, 390×844 and 1440×1000**. Plan's unverified status, Continue without a duplicate job, Stop, original brief plus modifications, reload recovery, Changes and a genuine frontend fixture preview passed. No page errors or horizontal overflow were found. Parent DOM/localStorage access was denied with browser web security enabled. One synthetic outbound preview request was intercepted/fulfilled locally, confirming the known permission gap without contacting that destination. Unauthenticated local governance access returned 401. Job/model APIs were mocked/blocked; no paid API test ran.
- Physical Android, distributed production load and real provider operation/cleanup were not tested. PGlite uses serialized local clients for transaction tests; this is not a multi-replica PostgreSQL load test.

## Changed files in this review

- `server/build-execution.js`: strict requirement/check validation.
- `server/execution-attempts.js`: state integrity, project continuity, effective resource accounting, raw log limits, bounded cleanup and safe storage errors.
- `server/postgres-options.js`: conflicting TLS/negotiation handling and unconfigured URL rejection.
- `tests/execution-attempts.test.mjs`, `tests/postgres-options.test.mjs`: new adversarial regressions.
- `tests/fixtures/postgres-test-ca.pem`: synthetic public-only CA fixture.
- `docs/phase2-execution-stage1.md`, this report: final scope, findings and compatibility boundaries.

Original PR workspace cache/version changes, both pool constructor integrations, the preview comment correction and Vercel branch deployment prohibition remain intact. All original changed files were reviewed; unrelated Grandpa AI features were preserved.

## Remaining activation blockers

Real execution remains incomplete and disabled. Before any activation: approve a genuinely isolated provider and actual resource profile; verify entitlement and zero-overage controls; bind admission to the existing cloud job's authorization/current generation; implement trusted provider lifecycle/idempotency/cleanup and shared monetary reservations; constrain dependency acquisition and network/ingress; run real hostile and full-stack fixtures only in that approved environment; and independently test migrations, backend endpoints and authentication/tenant permissions. Declared capabilities and project-supplied test output are not provider attestation or application acceptance evidence.

No production settings/secrets, administrator authentication, $0.50/day platform limit, $0.20/day Coding allowance or two-paid-call concurrency limit were changed. No service purchase, sandbox creation, paid model test, merge or deployment occurred. Keep PR #66 in draft pending owner review.
