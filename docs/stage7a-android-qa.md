# Stage 7A corrective Android retest

Baseline reviewed source: `f98666ec15bb252b3bd64ff273f676323538da1b`. Use the NEW corrective package/head for retesting; the previous physical 392px results do not certify the correction.

## Scope and evidence labels

Production changes are limited to the mobile progress/file-badge layout, a full-path title, and asset cache versions. Filename/status and actions use separate grid rows below 600px. The collapsed path is at most two visual lines; its complete text remains in the DOM/title and Details/Files. Existing action touch targets stay at least 44px. Task, worker, budget, administrator, database TLS and execution behavior are unchanged.

The QA server/client/evidence modules under tests/support are never imported by production. They bind only 127.0.0.1 and reject LAN/host flags. The harness disclosure occupies real layout space above the app and is always visible: simulated Working/elapsed/checkpoints are not real AI/worker activity; bars count saved synthetic source. Reserved disclosure space reduces the app's available height and must be distinguished from production layout.

Three different evidence classes must remain distinct:

- Automated Node tests: deterministic regression checks and local HTTP fixture tests.
- SIMULATED_VIRTUAL_CLOCK_NOT_BROWSER: actual observer code with synthetic transport and a virtual clock. Not Android timing or layout evidence.
- Browser telemetry/screenshots: collected in a physical browser when a person actually runs it. Telemetry alone is not an automatic PASS, and a fixed-width iframe is layout emulation, not a physical desktop test.

## Android-only setup

Use your existing Termux and Chrome. If Termux is absent, use its official F-Droid source https://f-droid.org/en/packages/com.termux/ . No plugins/root/SSH/tunnel/hosting are needed. Install the free official packages, then copy the NEW ZIP to Downloads:

```sh
pkg update
pkg upgrade
pkg install nodejs-lts unzip
termux-setup-storage
mkdir -p "$HOME/grandpa-stage7a-corrective"
unzip "$HOME/storage/downloads/Grandpa_AI_Stage7A_Android_QA_Corrective.zip" -d "$HOME/grandpa-stage7a-corrective"
cd "$HOME/grandpa-stage7a-corrective/android-qa"
node verify-source.mjs
node --test tests/stage7a-qa.test.mjs
node tests/support/stage7a-qa-server.mjs .
```

Grant the requested storage permission so Termux can read Downloads. Rename the ZIP exactly as shown if Android appends a suffix. Use a new extraction folder; do not mix old/new scripts. Node 22/24 is expected. No npm install, API key, .env, production access code, GitHub login or database is needed; the package includes the exact frontend and manifest. The source verifier must print the NEW commit and pass every included public-file hash. The phone-compatible HTTP tests should report 15 passed; these are not browser tests or worker tests.

Keep Termux running. Copy its complete printed URL into Chrome ON THIS PHONE:

`http://127.0.0.1:4171/?key=PRINTED_RANDOM_LOCAL_KEY`

No --lan. The local key is disposable, not a production credential. Other devices cannot connect through Wi-Fi/mobile interfaces. Other apps on the same phone can reach loopback, which is why the key/cookie is required. Close previous local Workspace tabs before retesting. After opening, you may turn network connectivity off; all QA APIs/resources remain local. Do not enter real personal requests or credentials.

Expected: a reserved simulation disclosure ABOVE navigation, with no overlap, a 392px (or actual-width) dimension label, and synthetic school source. If QA error appears or boot fails, record BLOCKED and save evidence; do not disable security checks or switch to production.

## Manual cases

Use Controls/evidence in the reserved disclosure. Before changing scenarios, export evidence and close the previous Workspace tab. Selecting a scenario resets only its synthetic fixture and starts a new run ID with fresh server/browser timelines. For recovery, keep the original Workspace open, use Restore successful observation in Controls, then return; do NOT reset. Refresh the SAME URL for device-save tests.

1. **Layout:** active, paused and uncertain states with the long path at native phone width, keyboard open/closed and orientation changes. Filename must be readable in at most two collapsed lines, with full text in Details/Files; Plan/Details/Pause/Cancel/Resume must remain reachable with usable touch targets. The Agent badge must not break into tiny word fragments. Inspect Files/Preview/Changes/Plan and the composer. Save screenshots.
2. **Stalled headers and body, separately:** select hang_headers or hang_body. Keep the browser foregrounded and do not switch tabs for at least 16 seconds. Observe uncertainty/recovery messaging. Let several retries occur before restoring success. Export evidence before resetting. Browser request_abort elapsedMs should be about 15000ms; retry waits are 10000/20000/30000ms after failures, while server request-start intervals include the timeout itself. Background throttling/restarts must be recorded, not misreported as exact timing.
3. **Recovery identity:** restore success without resetting the scenario. The original scenario name/run ID must remain, transportMode changes to active, and transition is recorded. The same task/source hashes/history count must survive; observation must not POST create/control.
4. **Repeated actions:** delayed_control holds its response six seconds. Tap Resume rapidly several times; browser action events may record taps, but only one control request should be dispatched by the app while busy. Repeat Pause/Resume/Cancel and confirm the pending indication settles. This measures UI actions/HTTP, not worker checks.
5. **Uncertain identity:** uncertain_create must not automatically create work; explicit Retry saved submission uses the original fake identity/payload. uncertain_operation must ask for confirmation; declining produces no control POST, approving sends one. For http403/http404/wrong_task/malformed, observe failures and recover without replacing the task or losing files.
6. **Lost response and persistence:** lost_control applies Stop then loses its acknowledgement; UI must warn honestly and re-observe. Edit a synthetic file, wait for save and refresh the SAME Workspace URL: source survives or conflict is disclosed. budget_pause does not automatically resume. approved + Continue does not create another task.

## Timing evidence and privacy

Controls offers View/download evidence at /__qa/evidence.json and /__qa/download-evidence. New exports contain baseline/new source label, runId, original scenario, current transportMode, synthetic task state, source hashes, request maxima and two bounded timelines:

- serverEvents: monotonic receivedMs, request_start/end/abort, status, elapsedMs and recovery transitions. requestId is server-local; clientSequence correlates the browser request header where present.
- browserEvents: clientSequence, atMs relative to client boot, headers/body_complete/request_abort/error, viewport, visibility, actions, pagehide and boot. Client/server clocks have different origins; do not subtract across them. Look within one clock and request ID. Browser telemetry is untrusted test data and may be lost during navigation.

No user-request excerpts, file bodies/custom paths, headers, auth tokens, raw URLs or raw error messages are exported. Diagnostics use allowed event/action codes; only synthetic known file labels, content hashes and history counts appear in the state summary. Keep the locally printed test key out of shared screenshots. Each timeline retains at most 500 events; droppedEvents reports eviction. If it is nonzero, save what remains and rerun a shorter case before claiming complete timing coverage.

The /__qa/deterministic endpoint runs actual observation code with a VIRTUAL clock. For both headers/body it should report request starts [0,25000,60000,105000], three abort durations [15000,15000,15000], retry waits [10000,20000,30000], one accepted recovery, preserved synthetic source and zero pending timers. It explicitly does not claim browser or worker execution.

Server-side worker serialization is covered by deterministic tests in tests/stage7a-corrective.test.mjs and existing recovery tests in the full repository, not by this phone launcher. The Android package deliberately omits backend/database dependencies. HTTP maxObservationReads is not a worker-monitor measurement.

## Viewports and actual observations

Controls has one-at-a-time fixed-width frames at 320, 390, 392 and 1440px. Close other Workspace tabs before opening one. Record the INNER dimension label and screenshot; horizontal panning on the phone may be needed for 1440. These are Chrome-on-phone CSS layout emulation, not physical desktop or independent engine tests. Native Android width must be recorded exactly; 392 is not 390. Actual browser checks remain NOT_RUN until performed. Do not carry old screenshots forward as proof of this correction.

## Recording and stopping

For every case save before/failure/recovery screenshots, download its JSON BEFORE resetting, and record PASS/FAIL/BLOCKED/NOT_RUN, dimensions, keyboard/orientation, Chrome/Android version, expected/observed result and filenames in Notes or evidence.csv. Capture a short screen recording for timing where practical. No production page or paid AI call is a substitute.

Ctrl+C in Termux stops the local listener. A killed Termux process causes connection-refused; restart, open its new keyed URL and choose a new scenario. Do not root the phone, weaken TLS/Chrome protection or enable debugging to recover. Source mismatch means re-extract, never bypass verification.

## Merge gate

Keep PR #71 Draft. Review the new exact commit, automated results, required viewport/physical-phone evidence and controlled recovery/repeated-action cases. Final CI on Node 22/24 must be green on the new head using verified non-billable usage, and Samuel must separately approve merge. No merge/deployment/provider activation is authorized by this procedure.
