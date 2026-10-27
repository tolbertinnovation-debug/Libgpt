# Phase 2 Stage 2: Sandbox eligibility, cost and security review

Date: 27 October 2026. Production baseline: `b306eb47ba84e6d665c799bce1d158f06381cc44` (PR #66).

**Decision: NO-GO for real execution or a live pilot. GO for offline preparation only.** This report does not authorize activation, a plan upgrade, purchases, deployment, secret changes or larger limits. No sandbox was created and no generated backend was executed.

## Account evidence and outstanding eligibility

Read-only connected Vercel inspection confirmed project `libgpt`, ID `prj_eEOUgqj8QpTiWXDm6iSaDVYvbmYL`, belongs to Tolbert Innovation Hub, team `team_3WdvhkT8hGQq3supDIodl13S`, slug `tolbert-innovation-hub`. Its latest production deployment remains `dpl_2kdNJBVQhatKXAPRHqAwmLHzFZgk`, READY. GitHub's deployed branch remains at the baseline commit.

Both connected team reads returned identity fields without a billing plan, trial status, entitlement or allowance balance. The scoped billing-charges request for 1–27 October returned `404 costs_not_found`. This is missing evidence, **not proof of no charges, Hobby membership, or unused allowances**. Named-sandbox and session list requests both returned empty results with no next page. Listing access is confirmed; creation entitlement and remaining account-wide quota are not.

The older screenshot showed Hobby, but it is not current account confirmation. The present plan, Sandbox creation permission, remaining free quota, payment/overage configuration and spend-control configuration remain UNKNOWN. The connector exposes no suitable read-only budget/entitlement endpoint in this connection. No credentials were extracted or browser session probed to fill this gap.

Evidence needed before any activation:

1. An owner checks this exact team's Settings → Billing and confirms current plan, any trial/credits and renewal/overage terms. A redacted screenshot or explicit Vercel confirmation is sufficient for the next review; never send payment details or tokens.
2. Check team Usage and project Sandboxes/Observability, covering all team projects, current balances and reset dates. Treat quotas and credits as shared team resources; do not multiply them by project count. The exact live quota pool and other-project consumption are not visible in the connected responses.
3. Obtain a written Vercel eligibility answer describing TIH's organizational, public AI coding and potential commercial use. Hobby is restricted to personal non-commercial use; free quotas do not waive this restriction. Donations alone are treated differently, but an organization or free pilot is not automatically eligible. Pro/Enterprise or an explicit applicable concession is required if Vercel classifies this use as commercial. No support message was sent on the owner's behalf.
4. Confirm whether any pause/limit stops new Sandbox creation, existing sessions and retained storage separately. Do not infer that pausing production deployments stops every infrastructure charge.

Sources: [Hobby plan](https://vercel.com/docs/plans/hobby), [fair-use commercial rules](https://vercel.com/docs/limits/fair-use-guidelines), [Sandbox overview](https://vercel.com/docs/sandbox).

## Published costs; not an account quote

[Published Sandbox pricing](https://vercel.com/docs/sandbox/pricing), checked on the review date:

| Meter | Hobby included quota | Published paid rate, iad1 |
| --- | --- | --- |
| Active CPU | 5 hours/month | $0.128/hour |
| Provisioned memory | 420 GB-hours/month | $0.0212/GB-hour; one-minute minimum |
| Creations | 5,000/month | $0.60/million |
| Transfer | 20 GB/month | Pro: Flat Rate CDN; Enterprise: $0.15/GB |
| Snapshot storage | 15 GB lifetime | $0.08/GB-month |
| Drive storage | 15 GB lifetime | $0.05/GB-month |
| Drive reads/writes | 30 GB/month each | $0.0015/$0.004 per GB |

Hobby pauses creation at exhaustion without overage charges. Pro draws from its shared $20 monthly usage credit, then bills overages. These are conditional plan terms, not confirmed entitlement here. Downloads are free; outbound data and exposed-port traffic are metered. Rates vary by region.

Our conservative calculation for one 30-second, fully busy 1-vCPU/2-GB attempt: CPU $0.0010667 + memory $0.0007067 + creation $0.0000006 ≈ **$0.001774**, before other charges/taxes. Ten such runs ≈ $0.01774. A full 60-second billable CPU envelope yields ≈ $0.002841 per attempt. These are estimates, not guaranteed upper bounds. Lifecycle overhead, rounding, failed creations, recovery and delayed termination must be priced and bounded before admission.

Retries are new attempts, each separately reserved. Cleanup is not assumed to be a separately priced API action, but continued VM time and retained data can keep costing money until termination/deletion is confirmed. Ephemeral disks have no separate listed GB-month meter; do not confuse this with snapshots/drives. Controller Functions, Workflow, database, registry images and logs may have separate usage; they are not proven free by a small VM estimate.

The SDK defaults are unsafe for this proposed use: allow-all networking, persistent filesystem snapshots and a longer session. A future adapter must explicitly request deny-all, no persistence, no drives, no exposed ports and a short immutable timeout. Avoid convenience getters that can resume a stopped session.

Sources: [lifecycle](https://vercel.com/docs/sandbox/working-with-sandbox), [Pro plan](https://vercel.com/docs/plans/pro-plan).

## Financial admission design — not implemented or enabled

Production's current AI ledger is not a Vercel billing control. The mock execution coordinator counts synthetic runs/CPU and cannot reserve real dollars. Keep it unmounted.

Proposed additional execution policy defaults: `enabled:false`, daily execution dollars **0**, daily attempts **0**, approved provider **none**, verified entitlement **none**. Even a nominally free run requires an explicit positive run authorization plus confirmed commercial eligibility and a fresh quota snapshot. Missing or unknown fields deny admission, never default to free.

For a future approved pilot:

- Use integer microdollars and an immutable, versioned, region-specific price envelope. Include CPU, memory rounding and lifecycle margin, creation, bounded transfer/storage, retries, controller overhead and recovery exposure. Reject any dimension without an enforceable upper bound or a confirmed no-charge hard stop. A forecast or delayed dashboard balance is insufficient.
- In **one database transaction**, authenticate the existing cloud-job capability and current generation; verify the complete source hash and trusted check plan; acquire the same shared governance locks; reserve execution-specific dollars AND the same dollars inside the existing Coding $0.20/day and platform $0.50/day totals. Separate allowance means a sublimit, not extra money. An independent second ledger transaction would permit races and is prohibited.
- Preserve the two-paid-AI-call semaphore. An infrastructure attempt uses its own stricter one-at-a-time slot and is not a reason to expand AI concurrency. Provider attempts never carry model credentials.
- Persist intent and provider idempotency identity before the create operation. Admit only one claimant; fence stale workers with generations/leases and compare-and-swap updates. Unknown create outcomes hold all reservations. Never retry a timed-out create as a new identity until provider reconciliation proves what happened.
- Track team/project/attempt/provider-session IDs, source hash, authorized owner hash, quota/price snapshot version and age, reserved versus actual meter quantities, started/stopped timestamps and cleanup evidence. Exclude credentials and source bodies from cost logs. Monitor shared usage from other projects; stale/unavailable quota information blocks new work. Local reservations cannot lock consumption by unrelated Vercel projects.
- Charge/reconcile conservatively; keep unknown liabilities held across midnight and worker restarts. Do not refund from guest claims, absence of logs or an expired local lease. Verified actual overrun is recorded honestly and pauses admissions; this detection cannot undo provider charges. Fail closed before starting if a genuinely bounded charge cannot be established.
- Stop/cancel never releases a live provider liability by itself. A separate bounded recovery path must terminate and confirm the session, including when the normal budget is exhausted. Reserve recovery exposure up front. Three bounded recovery attempts followed by operator reconciliation is a proposed policy, not proof of cleanup.
- No automatic paid restart at budget reset. Resume remains an explicit user decision with fresh admission checks.

[Spend Management](https://vercel.com/docs/spend-management) offers team-wide alerts/webhooks and production pausing on applicable Pro/Enterprise plans. Checks can lag several minutes; it is not a precise per-attempt or $0.50/day hard cap. It excludes certain fixed charges. Pausing all projects also creates an availability risk for TIH's other sites. Existing settings were neither visible nor changed. Provider quotas, an application reservation and a provider kill switch are separate controls; none alone proves a complete no-overrun guarantee.

## Security compatibility against PR #66

| Requirement | Evidence / gap | Activation condition |
| --- | --- | --- |
| Separate VM | Provider documents Firecracker isolation; no local live test | Approved provider and actual isolation acceptance tests |
| Deny-all egress, including DNS | Documented firewall supports it; allow-all is default | Explicit policy at creation; no allowlist/subnet/broker exceptions; adversarial tests later |
| No production credentials or DB access | Not automatic if controller passes env/source secrets or grants private networking | Empty allowlisted guest environment; no OIDC/API/DB tokens, private network, drives or credential brokers; validated source |
| 256 MiB memory / 64 MiB filesystem / 16 processes / 1-second CPU | Current contract; provider allocates at least 2 GB RAM, SDK3 disk 64 GB and does not promise those per-process bounds | NOT compatible as-is. A reviewed non-bypassable inner enforcement boundary or separately approved contract revision is required |
| 30-second wall deadline | Documented session timeout, unlike per-process CPU quota | Fixed timeout, no extension/resume authority; verify provider termination later |
| Fresh attempts | Default persistence could reuse filesystem | Explicit nonpersistent creation, no drives/snapshot reuse; unique attempt identity |
| Cancellation / cleanup | PR #66 tests state transitions, not provider deletion | Trusted termination reconciliation, bounded cleanup and unknown holds |
| Duplicate prevention | Atomic mock claims and fencing exist | Bind to production job ownership and provider create idempotency/reconciliation |
| Source and owner integrity | Artifact hashing and capability continuity exist in mock state | Authenticate against actual job row/current generation before creating or accepting results |
| Logs and results | Raw/retained byte bounds and synthetic-report validation exist | Bound streaming before buffering; HTML-escape UI logs; never trust guest-emitted success JSON as attestation |

No provider capability declaration proves it is enforced. The current validator should reject a direct Vercel resource profile; do not change constants merely to make it pass. An ordinary shell `ulimit`, timeout wrapper or temporary directory is not sufficient enforcement for hostile code with elevated VM privileges.

Trusted verification must be orchestrated outside the submitted program: provider-confirmed lifecycle and exit information, externally controlled acceptance checks tied to the exact immutable source, bounded artifact collection and a result schema the guest cannot mint. Even a successful process exit is not proof that a school application's authentication, tenant isolation or database permissions work.

Sources: [Sandbox firewall](https://vercel.com/docs/sandbox/concepts/firewall), [official Sandbox skill/resource limitations](https://github.com/vercel/vercel-plugin/blob/main/skills/vercel-sandbox/SKILL.md), [provider overview](https://vercel.com/sandbox).

## Frontend preview review

`public/index.html` gives the visible preview `allow-scripts allow-forms allow-modals allow-popups`; the hidden check frame omits popups but retains scripts/forms/modals. Neither includes `allow-same-origin`, `allow-top-navigation` or `allow-popups-to-escape-sandbox`. Parent DOM/storage access and unsandboxed popup escape are constrained. These flags do not block external requests or a frame navigating itself.

`public/build.js` inlines project assets and injects error/navigation helpers; it does not enforce a restrictive CSP. External scripts, images, CSS, fetch/beacons and forms can contact other hosts. CORS is not an egress firewall. A popup retains sandbox restrictions but can still confuse users or cause nuisance. Modals and tight loops/large DOM or canvas allocations can impair the browser. Parent-side timeouts cannot reliably interrupt a renderer stuck in an infinite loop.

`public/ritual.js` checks postMessage frame identity and a per-check ID for hidden checks. Those are useful cross-frame protections, but generated code in the same iframe can inspect or imitate the helper's messages, omit failures or claim completion. These remain frontend diagnostics, not trusted secure execution reports. Frequent fault/navigation messages can also cause UI work; a bounded receiver is a useful future improvement. No new parent-origin escape was established by this source review.

Recommended separate hardening increment:

1. Inventory CDN scripts/styles/fonts, images, forms, downloads and links in legitimate previews. Add an explicitly selected restricted mode first; do not silently break existing previews with a blanket policy.
2. Prefer a dedicated credential-free preview origin, with no application cookies, tokens, admin headers or authenticated proxy. Maintain opaque-origin sandboxing. A parent header policy/isolated response is stronger than an injected meta tag alone.
3. Apply CSP before any project markup: restrictive connect/form/object/base/frame/worker directives and reviewed asset sources. Restrict navigations separately: CSP network directives do not guarantee all self-navigation is blocked. Test redirects, meta refresh, script navigation and new windows. Do not advertise deny-all until those paths are proven blocked.
4. Default popup/modal/form permissions off in restricted mode; make exceptions explicit. Add no-referrer and restrictive Permissions Policy for camera/microphone/location/payment/clipboard where supported. Do not add same-origin or top-navigation privileges.
5. Bound raw source, report frequency, message sizes and navigation frequency. Provide a user-accessible unload/Stop and lazy previews, but label these best-effort UI controls, not hard CPU/memory limits. Strict hostile-code resource containment requires an approved isolated browser/runner.
6. Compatibility and adversarial browser fixtures must check local assets, multi-page links, legitimate external assets, forms/downloads, 320/390-pixel layouts, parent storage isolation, unexpected destinations and forged messages, with all external attempts intercepted locally.

No preview permissions were changed in this investigation. Broad egress is a known medium-severity limitation of the existing frontend-only preview; it is not an approved backend sandbox. The misleading legacy comment claiming postMessage is the only way information leaves the frame should be corrected in the eventual preview-hardening change.

## Administrator prerequisites

`requireAgentAdmin` in `server/app.js` requires a dedicated `RITUAL_ADMIN_TOKEN` of at least 32 bytes and a timing-safe match with `x-ritual-admin`. Missing/short tokens deny every request, including a visitor access code or forged header. Protected functions:

- `GET /api/admin/budget`: read operator budget state.
- `POST /api/admin/budget`: audited allowance updates.
- `POST /api/build/control`: global agent pause/resume.
- `GET /api/build/audit`: read operator ledger events.

`POST /api/build/audit` is a separate visitor-authorized event-recording path; it does not unlock audit reading or budget updates. User task pause/resume is capability-authorized and distinct from global operator control. Staging/rollout have their own signed release and adapter gates; configuring the operator token does not configure deployment infrastructure or enable execution.

Future owner setup, only after separate approval: generate a high-entropy token privately in a password manager (e.g. 32 random bytes encoded as 64 hex characters); store it in the exact Vercel project's server-only production environment; never use a public/browser-prefixed variable or paste it into chat, GitHub, screenshots or generated project files. Limit dashboard access, approve a redeployment, then verify denial without the token and authorized read-only access with it. Use the operator credential field only over HTTPS, keep the token out of persistent browser storage and rotate after exposure. Do not test by raising budgets or pausing unrelated users. No token was generated, revealed or set here.

## Recommended eventual pilot profile — NOT authorized

Current Stage 2 limits: **zero real attempts, zero execution dollars**. Preserve the production contract unchanged.

If eligibility and security gaps are later resolved, propose an administrator-only synthetic fixture pilot: one concurrent infrastructure attempt, at most one initial attempt per day, no automatic retry, no real user data, no external APIs or model calls, no public ports, no drives/snapshots, deny-all networking, immutable approved image and a 30-second nonextendable session. Provider minimum is 1 vCPU/2 GB, not the current 256 MiB cap; this larger allocation requires separate explicit resource-contract approval or enforceable inner limits first. Retain the existing 64,000-byte output ceiling and 200-file/1.5-MB input ceiling. This small profile is a verification experiment, not sufficient capacity for arbitrary full-stack builds.

An initial monetary sublimit could only be proposed after a defensible all-in upper-bound quote. Any approved amount must be carved from both the existing $0.20 Coding and $0.50 platform budgets, with no automatic increase. No positive allowance is proposed as already authorized.

## Validation, changes and next gate

- Fresh complete offline/mocked regression run: **550 passed, 0 failed, 0 skipped**, Node 24.22.1. No paid-model calls or Sandbox SDK invocation. Existing tests cover mock claims, stale fencing, quota exhaustion, forged reports, interrupted cleanup/retries, logs, TLS, administrator lock and disabled execution.
- Read-only production health: 200/ok. Governance: 200/available, daily $0.50, Coding $0.20, concurrency 2. Execution: 200, disabled, provider null, executed false, backend/database/authentication not verified. Operator budget and audit GETs: 403 without an operator token. No production job, budget, audit-event or control writes were made.
- Every present baseline file matched the remote merged tree by Git blob hash. The local checkout lacks two tracked PNG icons; remote-tree-based documentation publishing preserves them. Tests do not establish live provider resource, cleanup or invoice behavior.
- Changes are this report and a development-branch-only automatic-deployment exclusion in `vercel.json`. No runtime, dependencies, schema, TLS, administrator authentication, preview permissions or production settings changed. The branch is `codex/phase2-stage2-eligibility`; no merge or deployment is authorized.
- No new browser run or production build was necessary for documentation-only changes; existing preview unit/regression tests ran. PR #66's earlier browser/build results are not represented as new Stage 2 validation. A future preview code change needs fresh responsive browser acceptance tests.

Next gate: confirm current plan/permission and commercial terms, obtain enforceable resource/cost bounds, implement and review the shared monetary reservation bridge and provider reconciliation with mocks, then obtain separate owner approval before any actual creation. Until then, continue only offline preparation. Full-stack execution and verification remain incomplete.
