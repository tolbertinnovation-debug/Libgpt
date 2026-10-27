# Phase 2: execution investigation and proposed implementation

Date: 26 October 2026. Production baseline: `e449076a2c249a30c8fa00f94a14a4634723926f` (PR #65).
Status: recommendation only. No runner enabled, service purchased, paid model request made, production setting changed, merge, deployment, or remote branch push.

## Recommendation

Prepare a disabled Vercel Sandbox adapter with mocked tests. Consider a small, explicitly approved pilot only after confirming account entitlement, acceptable use, resource guarantees, and zero-overage behavior. Do not call the provider even to run a hello-world until that approval. If those conditions cannot be established, retain static verification and frontend previews; there is no verified unrestricted, permanent, free full-stack runner in the existing app.

Vercel currently documents recurring free Sandbox quotas on Hobby and a creation pause rather than overage billing. This is materially different from a one-time promotional credit. However, the connected team metadata did not expose a billing plan or remaining entitlement. Previous screenshots showed Hobby, which is not proof of current eligibility. Hobby documentation restricts it to personal, non-commercial use; Grandpa AI's organizational/customer use needs eligibility confirmation. Do not upgrade, open another account to evade terms, or assume a free public pilot qualifies.

## Existing implementation inspected

- `server/build-execution.js`: hard-disabled provider-neutral manifest. No provider, subprocess, execution client, or environment enable switch. Source hash, safe paths, file/byte bounds, no arbitrary command/environment input, and secret inspection are reusable.
- Its 1,000ms CPU, 256MiB RAM, 30s wall time, 64MiB filesystem, 16-process and 64,000-byte output figures are requested future requirements, not implemented enforcement. A provider adapter must reject unsupported guarantees rather than silently relax them. These limits are also too small for many framework builds.
- `server/build-jobs.js`, `server/build-worker.js`: reuse task identity, generations, row locks, checkpoints, bounded repair rounds, cancellation, ownership capabilities and fenced stale writes. Avoid another parallel job system.
- Existing static checks and release gates remain necessary, but do not prove runtime correctness.
- `public/build.js`, `public/ritual.js`, `public/index.html`: actual frontend code can run in opaque-origin sandboxed iframes. No same-origin permission is granted, but preview permits forms, scripts, modals and (visible preview) popups. No deny-all CSP was found in the inspected preview generator. Same-origin isolation does not itself block outbound traffic or CPU exhaustion. This is not an acceptable general backend execution boundary; restrict/review preview networking separately before stronger safety claims.
- Existing GitHub Actions tests exercise trusted repository code with mocked AI, not arbitrary generated customer projects. PGlite is already a dev dependency and useful for tests, but is neither a sandbox nor proof of full PostgreSQL compatibility.

## Options and costs

| Option | Isolation and compatibility | Resource limits / financial exposure | Decision |
| --- | --- | --- | --- |
| Existing Vercel Function/process/temp directory | Contains app credentials; no separate generated-workload boundary. Hosting isolation between customers does not isolate generated code from this app. | Shares function resource limits and hosting quotas. | Never run generated backend code here. |
| Existing browser preview | Browser origin boundary; static HTML/CSS/JS only. No native server, real PostgreSQL or production auth verification. Device resources vary, especially Android. | No new server execution provider; existing bandwidth/hosting still consume quotas. | Keep, label frontend-only; audit egress/popups. |
| Vercel Sandbox | Separate Firecracker microVM; provider firewall can deny all egress including DNS. SDK control from Vercel via OIDC. Linux supports real Node builds/tests and isolated database tooling. | Hobby includes 5 active CPU hours/month, 420 GB-hours RAM/month, 5,000 creations/month, 20GB transfer/month; pauses at quota. Hobby max 4 vCPU/8GB, 64GB disk, 45-minute sessions, 10 concurrent. Pro is metered, not free merely because it has credits. | Best conditional fit; not yet approved or account-verified. |
| E2B | Remote isolated sandbox, JS API usable from Vercel; internet defaults on but can be disabled. | Hobby: $100 one-time credits, 1-hour sessions, 20 concurrent, default 2 vCPU/4GiB, 10GiB storage. Published CPU+RAM rates imply ~$0.00276 for 60s at default size, excluding other possible charges. Credit is finite, not recurring free compute. | Backup evaluation only; would add provider/account/credential. |
| GitHub Actions | Disposable hosted VM useful for reviewed CI. Existing workflow has repository access, broad network and runner authority; unsafe as-is for hostile generated code. | GitHub Free private repos include 2,000 minutes/month/500MB artifacts, shared account usage; Linux 2-core overage $0.006/min. Actual plan, quota and billing block unverified. | Retain for trusted regression tests. Not the public execution service. |
| WebContainers | Node-compatible browser runtime, requires cross-origin isolation; not arbitrary native Linux/PostgreSQL. Low-memory Android needs real-device validation. | Production commercial API use requires license; prototype exemption is not permission for customer production. | Not a confirmed free production solution. |
| Self-hosted Firecracker/gVisor | Stronger isolation can be engineered on a separate maintained Linux host, with firewall, cgroups, seccomp, disposable disks and no host credentials. | Open-source software is free; compute, storage, power, patching and operational work are not. No approved suitable host identified. | Do not add hosting now. Basic Docker alone is insufficient. |

Sources and rates are current public documentation checked on the report date. No provider entitlement or live sandbox was tested. Vercel rates vary by region. On paid Vercel plans, published `iad1` rates are $0.128/active CPU-hour plus $0.0212/GB-hour memory plus creation/transfer/storage as applicable. One minute at 1 fully active vCPU and 2GB memory is approximately $0.00284 before those other items, not a quote or spending authorization. Keep sessions short and never leave a server alive merely to keep a preview URL.

## Security and cost acceptance gates

1. Preserve $0.50 daily platform, $0.20 Coding inside it and two paid AI calls. Existing AI ledger does not automatically account for sandbox CPU, memory, transfer, snapshots or provider billing. Execution monetary allowance starts at zero. Any future paid execution must reserve its worst-case cost atomically against the same total/Coding limits before creation, including retries and orphan lifetime; it must never have a separate allowance outside those ceilings.
2. Track free resources separately using atomic quota reservations, a provider-plan check and a safety margin below shared provider quotas. Fail closed when entitlement/usage is unknown. No automatic upgrade or paid fallback. Provider quotas may also be used outside Grandpa AI.
3. Initially allow one execution job at a time, independently of the unchanged two-paid-AI-call limit. Accept existing project capability and generation; recheck source hash and release state. Existing capability ownership is not account-bound identity. Do not expose a public provider-control or admin-enabling route.
4. One fresh VM per project attempt; deny-all networking at creation; no persistent disk, shared mounts, snapshots, public ingress, production URLs, production data, API keys, OIDC token, database URLs or GitHub credentials inside. Keep SDK credentials in the trusted controller only. Use synthetic accounts/data.
5. Build tools and dependency lifecycle scripts are also untrusted. Begin with a narrow pinned framework/dependency set in a reviewed image. Prefer offline dependencies. Never run an arbitrary `npm install` with unrestricted networking. A future allowlisted download phase must disable scripts, validate integrity/lockfiles, and lock network before any project-controlled build/test script. Additional tooling/image/storage costs must be assessed first.
6. Confirm actual outer CPU/RAM/disk/time guarantees and guest privilege model. Vercel's larger VM profile does not enforce the current 256MiB/64MiB/16-PID contract automatically; root-capable guest code can defeat guest-only controls. Either establish enforcement outside guest control or seek explicit approval of an accurately documented replacement resource profile. Never advertise proposed cgroups/ulimits as tested isolation.
7. Persist attempt identity before provider creation; use provider idempotency if supported and verify its actual semantics. Record provider ID immediately. On ambiguous create/timeouts, reconcile via safe metadata and pause, never blindly recreate. Fence stale workers, stop on cancellation, stop in `finally`, and use provider wall timeout as orphan backstop. Cancellation and quota exhaustion never authorize auto-resume.
8. Stream bounded, escaped/redacted logs; store exit code, duration, runner/image/check version, source hash, attempt/generation and cleanup outcome. Missing cleanup or unknown execution state blocks approval. Bound logs at source/transport, not just after downloading unlimited output.
9. Treat project-supplied tests/logs/results as untrusted. A malicious app can print “passed.” Run trusted external acceptance checks and label which project tests versus independent checks ran. No result may authorize deployment automatically.

## Incremental development plan

### 1. Zero-service development, execution still hard-disabled

- On a separate development branch, add a provider interface and capability/resource compatibility validator; no production client invocation or enable flag.
- Add execution-attempt records to the existing persistence design with generation/source fencing, quota reservation, cancellation and explicit approval states. Audit schema migration and compatibility before proposing it.
- Mock create/run/status/stop/cleanup; test unknown create responses, stale callbacks, simultaneous starts/resumes, exhausted quota, plan change, retry bounds, cancellation, orphan recovery, forged reports, excessive logs and escaped UI rendering.
- Add verification categories: static checked; frontend observed; build passed; backend tested; database tested; blocked/not run. Existing statuses must never imply all categories passed.
- Audit preview CSP/network/popups separately without breaking legitimate images/navigation. Do not label it a hardened backend sandbox.

### 2. Approval checkpoint, no automatic activation

Present exact provider/account entitlement, acceptable-use confirmation, supported resource profile, dependency image/digest, no-overage controls and pilot run cap. Keep administrator functions locked while `RITUAL_ADMIN_TOKEN` is absent. User approval alone does not justify weakening that authentication. No paid infrastructure or execution until explicitly approved.

### 3. Approved isolated pilot

Run bounded synthetic fixtures, then hostile fixtures only in the approved VM: secret/network/metadata access attempts, symlink/archive traversal, fork/memory/disk floods, hanging processes, output floods, cancellation and cleanup. Verify no cross-project access and actual limits. These are necessary acceptance tests, not a claim that microVMs eliminate all vulnerabilities.

### 4. Full-stack verification, one supported stack first

- Start with pinned Node.js plus browser assets and synthetic authentication. Build, boot and HTTP-test the app entirely inside the VM; mock approved external APIs.
- Run migrations against a disposable PostgreSQL instance inside that isolated environment where the approved profile supports it. PGlite can supply a faster compatibility subset but must be labeled separately; it cannot validate every extension, RLS/deployment role or service behavior.
- Trusted tests cover student registration, lecturer/student/admin permissions, unauthorized direct API access, validation, migrations/rollback and tenant isolation. Real external identity/email/payment integrations remain mocked and explicitly unverified.
- Run browser checks inside the same isolated environment without public preview exposure. Real live preview URLs require separate authenticated ingress review, cost cap and TTL. Record a screenshot/report bound to the source hash.
- Repair only a bounded number of failures with existing agents and governed calls; no redundant success-review model calls. On budget exhaustion save results and require explicit Resume.
- Complete regression suite, production build, mobile workspace QA and security review in a draft PR. Merge/deploy require further explicit approval.

## PostgreSQL SSL warning

Both pools (`server/governance-postgres.js` and `server/build-jobs.js`) consume the same connection selection: `RITUAL_DATABASE_URL`, then `DATABASE_URL`, then `POSTGRES_URL`. They do not set a TLS verification bypass. The inspected installed versions are pg 8.23.1 and pg-connection-string 2.14.1.

The parser currently treats `prefer`, `require` and `verify-ca` as `verify-full`, emitting a warning that a future major release changes those aliases. Local fake-URL parsing reproduced one warning for `sslmode=require` and zero for `verify-full`; both kept TLS verification defaults and no hostname-check override. A local hostname-mismatch check returned a rejection. This is configuration/parser evidence, not a real database TLS handshake test. Production URL values were not retrieved, so the exact alias used there is not confirmed.

Recommended correction: after a reviewed development change or separately approved configuration change, use explicit `sslmode=verify-full` for every applicable cloud connection, preserving host, credentials, CA/channel-binding and unrelated parameters. Prefer a shared, narrowly scoped connection-policy helper for both pools if integration-managed URLs cannot be edited safely. Do not change intentional localhost test connections implicitly. Validate conflicting/duplicate TLS flags and fail safely; do not blindly rewrite arbitrary URLs.

Do not use `rejectUnauthorized:false`, `sslmode=no-verify`, `sslmode=disable`, `NODE_TLS_REJECT_UNAUTHORIZED=0`, warning suppression, or `uselibpqcompat=true&sslmode=require` as a fix. node-postgres warns that URL SSL parameters can replace an explicit `ssl` object; avoid accidentally losing a configured CA. Add offline parser/connection-option tests and mock pool construction for both call sites, then verify a real certificate/hostname-validated connection only in an approved environment. A production SSL update still requires owner approval.

## Evidence and limitations

- Read relevant files at production commit through GitHub and inspected local implementation/dependencies.
- Ran fake connection-string parser comparison and Node hostname-mismatch rejection without opening a socket.
- No generated backend code executed, no sandbox created, no new dependencies installed, no secrets fetched.
- Existing 469-test release remains the prior full-suite result, not a newly rerun full suite for this documentation investigation. Targeted administrator/execution regression tests: 8 passed, 0 failed/skipped (`tests/phase2-admin-lock.test.mjs`, `tests/phase2-final-review.test.mjs`).
- Account billing plan, remaining Sandbox quota, commercial eligibility, provider idempotency and resource-limit enforcement remain approval blockers, not assumed facts.

## Primary references

- https://vercel.com/docs/sandbox
- https://vercel.com/docs/sandbox/pricing
- https://vercel.com/docs/sandbox/concepts/firewall
- https://vercel.com/docs/sandbox/concepts/authentication
- https://vercel.com/docs/sandbox/working-with-sandbox
- https://vercel.com/docs/plans/hobby
- https://e2b.dev/pricing
- https://docs.e2b.dev/network/internet-access
- https://github.com/e2b-dev/runtime
- https://docs.github.com/en/billing/concepts/product-billing/github-actions
- https://docs.github.com/en/actions/reference/security/secure-use
- https://webcontainers.io/enterprise
- https://webcontainers.io/guides/browser-support
- https://gvisor.dev/docs/
- https://firecracker-microvm.github.io/
- https://node-postgres.com/features/ssl
