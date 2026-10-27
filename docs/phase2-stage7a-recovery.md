# Phase 2 Stage 7A: reliable observation and conservative cloud recovery

Baseline: PR #70 / `aeecab8ae06d13d9caf19a396f78ef009517235a`.
Branch: `codex/phase2-stage7a-recovery`. Draft only; no merge or deployment authorized.

## Changes

- `public/build-workspace.js`: progress GETs have a 15-second deadline covering headers and JSON, one in-flight observation, bounded 10/20/30-second error backoff, normal five-second cadence after success, abort and serial fencing on project switch/stop, and task-ID validation. Observation never dispatches a task command.
- `public/ritual.js`: connection health is distinct from saved task state. Failed reads or control responses preserve identity, history, source, checkpoints and last confirmed status. Previously marked `unavailable` tasks are checked rather than silently replaced. Confirmed tasks returning 404 cannot create a replacement. Only an explicit retry of an unconfirmed submission with its original pending payload may repeat creation, under the same server-idempotent identity. Concurrent UI actions retain the existing single-action lock.
- `server/build-worker.js`: monitor reads run sequentially after each previous read completes. A storage failure or ten-second monitoring deadline aborts work conservatively and schedules no more monitor reads. Late reads after cleanup cannot affect the worker. Existing immediate pre-call ownership checks, operation receipts and stale-generation fencing remain in place. The final dispatch check also rejects a monitor abort that occurs during operation admission.
- `server/app.js`: three search diagnostic paths log fixed event codes, without a user-request excerpt or raw upstream error text.
- `public/index.html`, `public/styles.css`: accessible connection status, explicit Reconnect / Retry saved submission controls, last-confirmed time, unconfirmed-status disclosure, wrapping recovery text and paths, and 44px recovery/disclosure targets. `public/app.js` and asset version strings load the revised workspace consistently.
- `vercel.json`: Git deployments explicitly disabled for this development branch, following the existing branch opt-out pattern. No production project setting is modified.
- Tests: deterministic transport/timer cases and real workspace function extraction extend existing mocked UI and database regression coverage. A reproducible offline responsive fixture uses the actual renderers and CSS at 320px, 390px and 1440px.

## Security findings addressed

Medium: ambiguous 403/404 or transport errors could mark a task unavailable and permit implicit replacement. Recovery now fails closed for confirmed identities, including legacy `unavailable` status. Read failures do not erase task status or accepted history. Unknown paid-operation receipts still require existing explicit confirmation before a paid retry.

Medium: hung observation could silently prevent future progress reads. Bounded requests recover without restarting tasks; stale responses cannot cross project selection.

Medium: interval monitoring could overlap slow database reads. Sequential monitoring bounds this queue and fails closed on uncertainty.

Medium privacy: search diagnostics included user prompt excerpts and raw provider error messages. Fixed event codes remove these values from the three affected log paths. This is not a claim that all application logs have undergone a complete privacy audit.

No budget, authorization, execution, database schema or TLS modules are changed. No new critical/high vulnerability was established within this scope; independent review is still recommended.

## Validation and restrictions

All automated tests use mocked model operations and offline/throwaway database fixtures; no production database is accessed. Local runs explicitly blank model, database and administrator environment variables. The existing GitHub test matrix runs Node 22 and 24 without provider credentials.

Final local full suite: **682 passed, 0 failed, 0 skipped** (667 existing tests plus 15 Stage 7A regressions).

The local production build completes successfully. It produces local Vercel build artifacts, not a deployment.

Responsive browser verification is **incomplete**: the cloud browser rejected opening the local fixture because its URL policy permits only HTTP/HTTPS. No workaround or remote deployment was attempted. Fixture generation succeeds, and automated tests verify actual status-renderer text, recovery visibility, original payload preservation and task controls. These checks do not establish real layout, keyboard, screen-reader or Android device behavior. Before merge, a reviewer should open the fixture in an authorized local Chromium environment and inspect all three viewport frames, long file paths, Details, Plan, mocked Pause/Resume/Cancel, offline/missing states and reconnect. The fixture is explicitly simulated and runs no generated application.

Generate the fixture from the repository root:

```sh
node tests/support/stage7a-browser-fixture.mjs /absolute/path/stage7a-offline.html
```

The fixture denies network resources through CSP and uses only the trusted repository renderers with mocked controls. It is a scoped UI test, not an end-to-end production application test.

## Remaining limitations

- Browser-only preview CSP/navigation, renderer CPU/memory exhaustion and same-frame report trust are not solved in Stage 7A. Existing preview restrictions and source-only verification disclosures remain unchanged.
- GET polling still transfers full snapshots; revision-aware responses remain a separate proposed milestone.
- An abort cannot guarantee cancellation of an already billable AI call. Uncertain outcomes retain the existing conservative reconciliation and explicit-retry requirements.
- A database driver that ignores cancellation may retain one slow monitor query until its existing connection/query timeout. No repeated monitor reads are queued. Immediate pre-paid-call checks and final saves can still wait on storage; wider database timeout work is outside this scope.
- A definitively lost confirmed cloud task needs explicit future recovery or a deliberate separate project. The client does not infer disappearance from a privacy-preserving 404 and silently duplicate work.
- Connection health and last-confirmed observation time are browser-session information. Reload rechecks the durable task; it never automatically repeats a pending submission or an uncertain paid call.
- The existing AI ledger does not govern Vercel infrastructure billing. This branch provisions nothing and does not mount infrastructure governance.

Protected defaults remain $0.50/day platform AI, $0.20/day Coding Agent within that total, two concurrent paid calls, zero infrastructure allowance, unmounted infrastructure persistence and completely disabled real execution. Administrator authentication and PostgreSQL certificate/hostname verification remain unchanged. No paid services, provider activation, secret updates, live paid-model calls or production settings changes are authorized.
