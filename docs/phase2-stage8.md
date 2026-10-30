# Phase 2 Stage 8 — lighter progress checks and a saved requirements list

## 8A — lighter progress checks

While a cloud build runs, the open page checks its progress every 5–30 seconds. Before this change every check returned the complete saved task: every source file, the request history and the checkpoint, up to about 1.8 MB, even when nothing had changed.

### Change

- The browser sends the revision it already holds in `x-build-known-revision` (`public/build-workspace.js`, supplied by `public/ritual.js` from the saved task).
- `GET /api/build/jobs/:id` first runs `buildJobStore.peek`, which reads only id, generation, revision, status, update time and processing flag. If the revision matches exactly and the task is not a silent active task (no update for 90 s), the reply is `{job:{…brief, unchanged:true}}` — about 150 bytes.
- Any other case returns the full snapshot exactly as before, including the existing interrupted-worker check. Requests without the header (first observation, explicit Reconnect/Resume reads) are unchanged.
- The browser rejects an `unchanged` reply whose revision differs from the one it sent, or whose status differs from its saved copy. After any error or rejected reply the next check omits the header and fetches the full task. An accepted reply still confirms the connection and, for a finished task, stops polling; the existing rule that a same-or-older revision never changes local files applies.

### Cost and safety

No AI calls, models, budgets, admin controls, database schema or deployment settings change. The check reads less from PostgreSQL and transfers far less data per poll, which also helps phones on mobile data. Asset versions moved to `phase2-stage8-r2` so browsers load the matching files together.

### Verification

- `tests/stage8-polling.test.mjs`: `peek` returns no files/history and enforces the task token; the unchanged decision requires an exact, fresh match; the observer sends the header only after a confirmed revision and refuses mismatched unchanged replies.
- Local Chromium runs of the Stage 7A QA harness at 320/390/392/1440 px: same results as the merged PR #71 (no regressions). A separate Chromium run intercepted progress checks: the real page sent `x-build-known-revision`, kept its files and "Cloud task running" state on matching unchanged replies (133 bytes instead of ~1.5 KB for the small fixture, up to ~1.8 MB for real projects), and recovered with one full fetch after a mismatched revision or status.

## 8B — saved requirements list

Before: a requested change ("make it red") clears the plan and the Orchestrator replans from the combined request text. Earlier acceptance requirements survived only if the new plan happened to repeat them.

### Change

- `server/build-requirements.js` keeps a bounded ledger in the task state: `{version:1, active:[≤40 requirements], retired:[≤20 {requirement, reason, at}]}`.
- On `revise`, the store carries the ledger forward; tasks saved before this change seed it from their current (or previous) plan.
- The replan prompt lists the active requirements and asks for each to be copied verbatim or retired with the change that replaced it. Plans may contain a bounded `retired` list.
- If the plan drops one silently, the existing single repair attempt names the missing items. If the repair still drops them, they are appended to the plan automatically (no third call), so a requirement is never lost; only an explicit, reasoned retirement removes one.
- After a plan is accepted, its requirements become the active list and reasoned retirements are recorded. The Reviewer and Approver already check `plan.requirements`, so carried requirements are reviewed and gated.
- The Project plan sheet shows "Requirements replaced by your later changes" with the reasons (escaped text).

### Cost and safety

The ledger adds a few hundred input tokens to a replan only when the project already has requirements. A silently dropped requirement can cost one repair plan call, bounded by the existing two-attempt limit and the $0.20/day coding cap. No budgets, models, admin controls, database schema or deployment settings change. First builds without saved requirements send exactly the same planning request as before.

### Verification

- `tests/stage8-requirements.test.mjs` (10 tests): ledger validation/limits/de-duplication, legacy seeding, tolerant matching, retired list validation, unchanged first-build request, one repair then keep/retire, automatic carry after a failed repair, and full build → change → replan through the real worker and PGlite store (ledger passed to the planner, retirement recorded) plus legacy seeding on revise.
- Chromium: the Project plan sheet lists replaced requirements with reasons; an injected `<script>` in a requirement rendered as text.

## Browser and server orchestration

Production already routes every build, resume and change through the server worker: `/api/config` on libgrandpaai.com reports `backgroundBuilds: true`, and `public/ritual.js` sends all build paths to `startBackgroundBuild` when that flag is set. The browser runner remains only as the fallback for deployments without background storage (for example local development). Removing it would delete a working feature without changing production behaviour, so it is kept; new planning and requirement features live in the server worker.

## Overall verification

- Full suite: 723 passed, 0 failed (708 before Stage 8 + 15 new).
- Stage 7A QA harness in Chromium at 320/390/392/1440 px: same results as the merged PR #71, including its one known observation (Chromium resends a request whose connection drops before any response; the duplicated Stop is harmless because Stop is idempotent).
- No paid or live-model calls were made.
