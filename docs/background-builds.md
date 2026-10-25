# Background Build workspace

Build uses a server-owned Workflow 5 run on Vercel and dedicated Postgres checkpoints. The browser starts a task and observes it. Closing the page, switching projects or switching to Ask cancels only observation. Reopening a saved project reconnects with its existing task capability; it does not start another paid build.

The UI has Chat, a filtered file explorer and editable source with line numbers, a sandboxed phone/desktop preview, Changes against the start-of-task snapshot, a compact task card, actual activity events and a searchable command menu. Ctrl/Cmd+K opens commands and Ctrl/Cmd+S saves. General Ask chips are hidden in Build. Completed cloud files are also saved through the existing durable device storage and version history.

## Execution and persistence

`workflows/build.js` orchestrates bounded steps. `server/build-worker.js` advances planning, architecture, one owned file at a time, independent review, bounded repairs and the existing release gates. The queue checkpoints each step and the application saves each completed file transactionally. Current phase messages are persisted before paid work begins. Generated source is never executed by the server worker.

`server/build-jobs.js` creates the additive `grandpa_ai_build_jobs` table under a schema lock. Production and previews use the same isolated scopes as governance. A random UUID plus a 256-bit, per-project capability protects reads and controls in addition to the visitor access code. Only the capability hash is stored on the server. The plaintext capability remains in the owner's device project, including owner-created project backups. No public job listing or cross-user source endpoint exists. Clearing all device storage without a backup loses the capability; a shared visitor access code cannot recover another person's files.

Source checkpoints are limited to 1.8 MB, initial project source to 1.5 MB and 200 files, prompts to 6,000 characters and admission to 200 new jobs per scope per day. Input is validated before creation. Device storage failures are reported honestly and the cloud checkpoint can still be reconnected using the already-saved capability. Deleting a stopped project requests deletion of its cloud checkpoint too.

## Stop, retry and failure safety

Each step claims a database work key. Stop increments the job generation and clears that key, immediately fencing every old result. In-flight workers observe cancellation; late model results cannot overwrite the stopped or resumed task. Resume starts a fresh workflow generation using completed files. Concurrent or uncertain attempts are paused instead of silently duplicating paid calls. Workflow steps explicitly disable automatic retries around paid actions. A missing/incomplete file has one bounded corrective attempt; policy, quota, permission and cost denials never trigger additional paid attempts.

Up to six automatic review/repair rounds and 180 steps are allowed per workflow. Reaching a bound pauses with saved progress for explicit continuation. If a workflow dies unexpectedly, the observer detects failed or cancelled execution and offers Resume. All provider requests retain the existing global daily budget, usage settlement, concurrency, rate, role and kill-switch enforcement. A background build does not automatically publish a website or obtain production credentials.

A source-complete result is not a proven backend integration or a successful browser runtime test. The UI asks the owner to open Preview; the existing manual website checker runs the sandboxed browser checks. Release still requires the independent signed approval and existing staged rollout checks. Fullstack infrastructure remains subject to the existing fail-closed policy.

## Deployment

`workflow/nitro` compiles workflow and step directives, creates the platform-only queue consumer and routes the existing Express API. `scripts/build-workspace.mjs` runs Nitro, includes the dynamically resolved PDF font/data assets in API and workflow bundles, and keeps function durations at 300 seconds. Public assets are emitted separately. The shared app still runs with `npm start`; durable Vercel background availability is advertised separately from foreground local builds.

Vercel must expose system environment variables, including `VERCEL_DEPLOYMENT_ID`; no local filesystem is used as a fallback for cloud task storage. Database connection strings stay server-only. The no-provider `backgroundBuildCheck` workflow is available through an access-checked, empty-source connection-check request for deployment verification; it exercises the real queue and Postgres checkpoint without a model charge and cannot issue release approval.
