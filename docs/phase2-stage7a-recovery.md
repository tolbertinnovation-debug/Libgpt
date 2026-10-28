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

## Approved corrective implementation — 28 October 2026

Samuel's physical Android evidence established partial 392px baseline coverage and a long-path layout defect. The approved correction separates filename/status from mobile actions using grid rows below 600px, clamps the collapsed path to two lines while retaining its full DOM text/title and Details/Files access, and prevents the file-tree Agent badge from fragmenting. Existing 44px action targets and production task/worker semantics are unchanged. Asset versions load the revised renderer/CSS together.

New tests/support/stage7a-qa-server.mjs, stage7a-qa-client.mjs and stage7a-evidence.mjs are QA-only; production imports none of them. The loopback-only Android harness reserves disclosure space rather than overlaying navigation. It persistently explains that Working, elapsed time and checkpoints are synthetic and saved-source bars are not execution results.

Evidence keeps original scenario plus current transport mode, new run IDs, separate server/client monotonic clocks, starts/headers/body completions/aborts/status/duration, recovery transitions, visibility and repeated actions. Reset clears both timelines; late telemetry/actions from older runs are fenced. Diagnostics allow fixed codes and numeric metadata only, never request excerpts, headers/tokens, raw URLs/error messages or source bodies. Exported state contains synthetic file labels/hashes and history counts. Browser telemetry is explicitly untrusted and never an automatic PASS. Source manifest pinning identifies the packaged final head; a repository worktree without a manifest is labeled un-attested.

Deterministic evidence runs the actual observer with virtual timers and fake transport for both stalled headers and stalled JSON. It verifies default 15,000ms aborts, 10,000/20,000/30,000ms retry waits, same-task source preservation, one accepted recovery and timer cleanup. New regression cases also cover watcher replacement, stale results, default worker-monitor serialization/timeout/late rejection, repeated Resume admission, lost-create acknowledgement, confirmed identity protection and local-edit conflict preservation. No real worker, database, provider or execution environment is started.

Validation: **707 tests passed, zero failed/skipped**, on local Node 24.22.1 (682 prior plus 25 corrective/QA checks). Local production build passed: 50.3 MB / 19.8 MB gzip. An initial build using a symlink to shared dependencies failed in generated workflow transforms; copying the same installed dependencies locally and regenerating local build output resolved it without dependency/source changes. Syntax, diff checks and 320/390/392/1440 fixture generation passed.

Actual corrective browser layouts are **NOT_RUN**. No local Chromium executable is installed, and existing cloud Chrome cannot access this shell's local service. Prior physical 392px screenshots are baseline evidence, not proof of the correction. Fixed-width phone frames are layout emulation, not physical desktop testing. Updated phone instructions and evidence expectations are in docs/stage7a-android-qa.md; a separate Android bundle includes the pinned frontend, manifest and QA-only scripts.

Final-head GitHub Node 22/24 CI is **BLOCKED**, not passed. The standing prohibition on unverified billable Actions usage remains: the private repository's remaining included minutes/spending cap cannot be inspected through the connection, and no authenticated billing browser is available. The corrective commit uses GitHub's documented [skip ci] marker to publish safely without triggering the pull_request workflow. The workflow itself is unchanged. Exact-head CI must still run through an established non-billable route before merge approval; a prior head's green CI cannot satisfy that gate. No required check is removed or bypassed for merging.

Scoped security review: no changes to budget, authorization, administrator, PostgreSQL/TLS, worker dispatch, execution-disablement or deployment configuration modules. QA server rejects non-loopback binding, foreign Host/Origin, unauthorized sessions and path escape; it has bounded sessions/events/body sizes, serves local source only and never imports the app backend or reads environment secrets. Tests verify diagnostic redaction, scenario fencing and refusal of real/unsupported endpoints. Remaining preview navigation/resource-exhaustion/report-trust, browser telemetry authenticity, background throttling and physical-device/accessibility limitations remain. This is a scoped assistant review, not independent certification.

Keep Draft. No merge, deployment, paid AI call, infrastructure creation or production setting change. Final merge approval requires corrected physical/viewport evidence, exact-head automated/CI validation and Samuel's separate approval.
