# Phase 2 Stage 3 — disabled execution readiness

27 October 2026. Baseline: PR #67, `a52d85556994aa27f90778ad4e2aecd69e049476`. Branch: `codex/phase2-stage3-readiness`.

**Recommendation: human review for bounded, disabled preparation. NO-GO for live execution.** No provider was activated, Sandbox created, container launched, generated backend executed, production database contacted, secret configured, service purchased or production setting changed. This branch disables its own automatic Vercel deployment before its first push. Merge/deployment require separate owner approval.

## Architecture audit before implementation

Reviewed the existing `build-execution.js`, `execution-attempts.js`, governance ledger and PostgreSQL storage, `agent-costs.js`, build-job generation/ownership fences, shared TLS helper, operator routes and frontend preview/check pipeline.

| Existing capability | Gap and Stage 3 treatment |
| --- | --- |
| Hard-disabled execution adapter | Preserved; no enable switch, provider SDK or new execution route. |
| Mock execution attempt state machine | Preserved. Its synthetic CPU/run counters are not infrastructure dollar reservations. |
| Atomic AI reservations and shared platform/Coding caps | Preserved unchanged. Infrastructure admission is a separate, unmounted simulator, not silently folded into the live AI ledger. |
| Durable build jobs with capability ownership and generation fencing | Preserved. New mock infrastructure admissions require a trusted job-binding callback rather than accepting an arbitrary owner flag. |
| Opaque-origin iframe preview and bounded hidden diagnostics | Extended with opt-in resource policy, stricter message checks, bounded visible UI work and explicit unload. No full network/resource isolation claim. |
| Shared PostgreSQL TLS configuration for both pools | Preserved, including full certificate/hostname verification and conflicting-option rejection. No schema or pool changes. |
| Operator authentication | Preserved: missing/short `RITUAL_ADMIN_TOKEN` denies operator functions. New mock approvals have no HTTP/admin route and default to denial. |

## Frontend changes and security findings

`public/preview-policy.js` creates a CSP prefix before all submitted markup, including scripts placed before a head element. Restricted mode permits embedded inline/data/blob project assets but denies external resource destinations, connections, forms, objects, frames and workers through named CSP directives. A no-referrer policy is included. This is a resource policy, not sanitization; project JavaScript is deliberately still allowed.

The optional **Restrict external resources** control applies the wrapper to both visible and hidden previews. It removes form/modal/popup iframe privileges, retains script permission without same-origin/top-navigation/popup-escape privileges, and disables sensitive device capabilities on the visible frame. Standard mode remains the default for compatibility with existing CDN assets and forms. Restricted mode can intentionally break external dependencies and produce frontend diagnostics; those are not evidence that generated backend code is faulty or functional.

The visible message receiver now checks the exact WindowProxy, opaque origin, packet types, bounded text/path/hash fields and at most 20 accepted UI operations per second. Hidden diagnostics reject a non-opaque origin in addition to existing source/nonce checks. Nonces correlate messages but cannot make reports from code in the same frame trustworthy.

The unload control clears the frame and keeps it unloaded across subsequent renders until Refresh is selected. It is a best-effort user control, not a preemptive CPU kill switch. Ordinary source refresh still uses exact file comparison, so display-fingerprint collisions cannot hide changes. The existing PR #65 regression was updated for the added preview mode state and DOM attributes.

Medium issues reduced: unrestricted subresource/contact paths in the opt-in mode; visible-frame message amplification and insufficient origin checks. No same-origin or top-level navigation permissions were introduced. Standard-mode network access remains an existing compatibility limitation.

**Unresolved medium limitations:** a page can navigate its own frame, bypassing the initial document's CSP; inline code can consume renderer CPU/memory and flood deserialization before receivers reject messages; same-frame code can forge/suppress frontend reports. These are not fixed by CSP or message counters. The UI warns about self-navigation and lack of CPU/memory limits. A dedicated credential-free response origin, enforced navigation/egress policy and an approved isolated browser runtime remain future work. None is claimed here.

## Infrastructure cost simulator

`server/infrastructure-quota.js` is provider-neutral **offline simulation only**, unimported by production routes. Readiness always returns `enabled:false`, zero live allowance, no provider and `sharedBudgetBridge:false`. It cannot execute anything or accept a real provider approval.

- Default administrator, project-binding, quote and settlement verifiers deny. Tests explicitly supply trusted fake verifiers. A visitor-supplied `approved:true`, price or usage object is insufficient.
- Explicit administrator-authorized synthetic policies have unique identities, expirations and bounded dollar/attempt ceilings. Revocation blocks admissions and claims without refunding active liabilities. No automatic increases or restarts exist.
- Every operation requires caller-supplied atomic, rollback-capable storage; there is no production pool or implicit in-memory fallback. Two simulator instances share the same test transaction boundary. Tests recreate controllers over retained state to exercise recovery. This is not a production distributed-database load test.
- Admission binds project, owner-token hash, current generation, complete source hash, named checks and immutable quote. Every cost dimension must be a known integer microdollar amount: CPU, memory, creation, networking, storage, recovery and controller overhead. Unknown entitlement/quota/price or an expired quote denies admission.
- Pending reservations and reconciled costs are derived from bounded retained attempt records. Reservation totals must match persisted cost components and quote hashes. There is at most one pending infrastructure liability; fresh IDs cannot evade it or daily usage. No source bodies or credentials enter the audit log.
- Atomic claims issue private worker fences. Cancellation invalidates the fence; an unstarted attempt can release its known unused reservation, whereas started/ambiguous work stays held. Expired workers become unknown, including across midnight. No provider create is retried automatically.
- Cleanup can proceed under expired/revoked approval or exhausted daily allowance using previously reserved exposure. It is capped at three claims; unknown confirmation keeps the liability held. This simulates cleanup accounting, not actual provider termination.
- Trusted synthetic settlement must match source/generation and confirm cleanup. Forged or unconfirmed evidence becomes unknown. Actual overruns are recorded honestly and pause future admission; detection cannot undo a charge. Asynchronous verifier callbacks receive copies so mutable caller evidence cannot change the accepted cost after verification. A lease that expires during verification fences the worker and leaves usage unknown. Synchronous storage failures and upstream errors with forged internal error codes are sanitized.
- Audit records cover approvals, reservations, claims, cancellation, unknown outcomes, cleanup and settlement/overrun. Failed transactions roll back; denied-operation telemetry would need integration with the existing production audit system before activation. Audit history is bounded and fails closed for maintenance rather than silently evicting liabilities.

Simulation policy ceilings do **not** authorize infrastructure spending. The live $0.50/day platform AI limit, $0.20/day Coding sublimit and two-paid-call semaphore are unchanged. Infrastructure and AI accounting are separate. Before a live controller is possible, an approved cost policy must specify the aggregate authorization and reserve infrastructure liabilities together with all relevant shared caps in one durable transaction. Two separately committed ledgers are not an atomic combined budget. Current mocks do not provide that bridge, a production storage adapter or a provider billing guarantee.

## Full-stack verification contracts

`server/fullstack-verification.js` defines six mock observation types: API status/body hash; schema/rollback hashes with non-destructive migration expectations; unauthenticated/authenticated behavior; cross-owner authorization; owner/source/generation integrity; and duplicate-call/checkpoint/cleanup recovery.

Contracts bind immutable source, project, owner hash, generation, short-lived nonce and expected observations. Canonical serialization is depth/node/size bounded. Domain-separated HMAC verification requires a trusted controller key; guest stdout, unsigned reports, changed source/nonce/generation and `executed:true` reports are rejected. No key is generated/configured for production. Fixture keys are synthetic test data.

An optional atomic-storage verifier consumes challenges idempotently across recreated mock controllers and rejects a different report for a consumed nonce. The storage interface requires transactional rollback; no database is opened by importing or constructing it. Signed observations can still report mock failures for each of the six behaviors. Outcomes remain `mock_passed`/`mock_failed`, `simulation:true`, `executed:false`; backend, database and authentication remain **not_verified**.

The host must own the expectations and signing key. Giving the submitted application either would destroy the trust boundary. Mock HMAC validation is not provider attestation and does not prove an application works. Production job authorization, real external acceptance checks, ephemeral test databases, migration safety/rollback tests and actual authentication/tenant tests remain unimplemented.

## Provider comparison — official documentation checked on review date

No account or resource was created for an alternative provider. Published capabilities are not account-specific entitlements or tested enforcement.

| Provider | Isolation/resources/network | Billing/hard stops | Eligibility and decision |
| --- | --- | --- | --- |
| Vercel Sandbox | Firecracker; minimum 1 vCPU/2 GB, SDK3 disk 64 GB; documented deny-all including DNS. This does not meet the unchanged 256 MiB/64 MiB/16-process/1-second-total-CPU contract. | Hobby quotas stop creation without overage; paid usage includes CPU, memory, creation, transfer and storage. Spend Management has delayed checks, not a precise per-attempt ceiling. | Connected team read still omits plan/entitlement. Hobby is personal/non-commercial; organizational/commercial eligibility remains unconfirmed. NO-GO. |
| E2B | One microVM per sandbox; outbound access can be disabled. Pricing lists default 2 vCPU/4 GiB; 1-vCPU/1-GiB configurations are listed, but availability for a particular Hobby account/template is unverified. Hobby disk is 10 GiB. Fine-grained allowlists can open resolver traffic; do not substitute them for deny-all. | $100 one-time starter credit; Hobby base $0 plus usage, Pro $150/month plus usage. Default CPU+memory rates imply about $0.00138 for 30 seconds before other costs. No account-specific hard out-of-pocket cap was verified. | Terms accommodate company users; this does not confirm TIH's account, credit eligibility, embedded public coding use or no-charge enforcement. NO-GO pending written/account evidence and resource-contract review. |
| Modal | Documented VM and gVisor runtimes, full outbound block, configurable memory/CPU limits. Defaults are requests (0.125 physical core/128 MiB), not ceilings; bursting is billed. VM root disk is fixed 512 GiB; required filesystem/process/total-CPU limits are not established. | Starter publishes $30 monthly credit plus usage. Sandbox rates differ from Function rates. Workspace usage budgets and separate net spend limits are documented; reaching a spend limit stops workloads that would add out-of-pocket charges. Account availability, configured amounts and operational behavior remain unverified. | Terms restrict use to the customer's internal business and prohibit certain third-party/direct/resale access; no-fee use can have additional terms. Obtain written confirmation for Grandpa AI's public-user model. NO-GO. |

Vercel integrates with the current hosting identity; alternatives could be controlled remotely from Vercel using reviewed server-side APIs, but would add separate account credentials, lifecycle reconciliation and billable infrastructure exposure. There is no installed SDK, account linkage, entitlement check implementation or approved integration for any of them. No provider is confirmed as a free, commercially eligible match for the present isolation contract.

Sources:

- Vercel [pricing/resources](https://vercel.com/docs/sandbox/pricing), [firewall](https://vercel.com/docs/sandbox/concepts/firewall), [commercial-use rules](https://vercel.com/docs/limits/fair-use-guidelines), [spend controls](https://vercel.com/docs/spend-management).
- E2B [pricing](https://e2b.dev/pricing), [billing/limits](https://docs.e2b.dev/billing), [security](https://e2b.dev/security), [network controls](https://docs.e2b.dev/network/internet-access), [terms](https://e2b.dev/terms).
- Modal [Sandbox networking](https://modal.com/docs/guide/sandbox-networking), [Sandbox resources](https://modal.com/docs/guide/sandbox-resources), [resource requests/limits](https://modal.com/docs/guide/resources), [pricing](https://modal.com/pricing), [budgets/spend limits](https://modal.com/docs/guide/budgets), [terms](https://modal.com/legal/terms).

## Validation and delivery scope

Complete suite: **588 passed, zero failed/skipped** (30 more than PR #67). Local production build: PASS, 50.3 MB output. Initial local runs caught a versioned import unsupported by the server bundler and a DOM test stub missing new attributes; these were corrected before final checks. The shared build/storage module keeps its original module identity, preserving the durable save queue used by backups and the workspace.

Chromium at 320, 390 and 1440 px: workspace and local frontend fixture render without horizontal overflow/page errors. Tests verify standard-mode compatibility, restricted fetch/beacon/script/image/CSS/frame/object/form behavior, CSP before early project markup, opaque-origin parent and top-navigation denial, bounded diagnostic flood, and unload. Every external probe is intercepted locally, configuration mocked and backend routes blocked. A deliberately intercepted self-navigation succeeds, proving the documented limitation instead of claiming isolation. No model/provider call occurs. These are emulated Chromium checks, not physical Android, Firefox/WebKit, a container or generated backend execution.

No unresolved critical/high finding or merge-blocking medium finding is identified for this disabled, opt-in preparation scope. Remaining medium limitations are the frontend navigation/resource/report trust gaps above. Live execution additionally remains blocked by commercial/account eligibility, precise resource enforcement, provider reconciliation, production atomic storage and a shared monetary-admission bridge. These must not be waived because mock tests pass.

Important files: new `public/preview-policy.js`, `server/infrastructure-quota.js`, `server/fullstack-verification.js` and their three test files; workspace integration in `public/ritual.js`, `public/build-preview.js`, `public/index.html`, `public/styles.css`; cache version in `public/app.js`; updated existing check/source-collision fixtures in `tests/build-quality.test.mjs`, `tests/pr65-recovery.test.mjs`; branch deployment exclusion in `vercel.json`; this report. No dependency, production schema, AI budget, administrator or PostgreSQL TLS file is changed.

GitHub CI must pass on the published draft head. Do not merge or deploy without explicit owner approval. Live Sandbox activation needs a separate approval after all activation blockers are resolved.
