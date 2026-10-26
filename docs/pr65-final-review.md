# Draft PR #65 — final review and corrections

Starting reviewed head: `499d8c650a5a35da6686911555d11dd4e7bcff77`. Production base: `3f51752002f66d5b452911c465799e7cc0ae1570` (PR #64). Corrections remain in the existing `codex/phase2-request-history` draft. No production settings/data/secrets, administrator settings, paid services, merge or deployment were changed.

## Recommendation

**Safe to merge as a bounded Phase 2 improvement after the owner approves and final GitHub checks succeed.** This recommendation does not certify complete multi-tenant security or functioning full-stack execution. Keep the PR draft pending owner review.

No unresolved critical/high or merge-blocking medium issue was identified in this scope after corrections. Five medium findings and one low hardening finding were addressed. The original 448 tests passed before corrections; their coverage was insufficient for the races and recovery cases below.

## Findings and fixes

| ID | Severity | Finding | Correction |
| --- | --- | --- | --- |
| R1 | Medium | A stale paused browser could create a replacement job after another browser resumed the original, leaving independent paid work running. Local button guards did not make that cross-request decision atomic. | New instructions and locally edited source revise the existing task identity under its row lock. Revision requires an inactive task and the expected generation. Resume/revise races admit one operation; stale requests return 409. Public Resume also requires a generation; fresh cloud state is read first. Same-screen admission uses a single in-flight guard. |
| R2 | Medium | An uncertain initial creation could be retried with changed source/history, or an incorrect new identity after a missing-row response, while the original POST could still commit. | Persist the original pending payload with its saved task identity. Recheck that identity and retry the same immutable payload/id when necessary. A received status snapshot clears the pending envelope. Committed cloud metadata supplies the current brief; Continue never becomes another requirement because a local phase label was stale. |
| R3 | Medium | The 32-bit display fingerprint was also used to decide source identity and refresh Preview. Different valid HTML sources can share it and suppress a real update. | Exact, order-independent path/body comparison now governs source decisions and preview refresh. A deterministic collision fixture (`751de5f8`) proves distinct source updates are retained. Version the changed helper import so a cached older helper cannot break the new workspace import. The fingerprint remains only a display/cache hint. |
| R4 | Medium | Polling could overwrite unsent local edits. History validation happened after source/revision mutation, and unconfirmed request metadata could appear saved in Plan. | Validate history before applying any checkpoint. Track the last cloud/posted source baseline, preserve divergent local files, show an explicit conflict, compare Changes against cloud source, and invalidate release evidence. History is accepted from confirmed snapshots; edits are locked during admission. Old metadata without a baseline requires an explicit comparison/resumption decision rather than silent replacement. |
| R5 | Medium | A stale client could delete an active task; the device discarded its copy/capability before cloud deletion was confirmed. | Delete checks active status under the same row lock used by Resume. The UI waits for successful cloud deletion (or confirmed absence) before removing its local copy; failures preserve files and the task capability. Concurrent Resume/delete cannot delete active work. |
| R6 | Low | Existing secret inspection did not include checkpoint metadata in these admission/worker paths. Legacy/imported planning metadata could carry a pasted credential into a model prompt. | Include checkpoint metadata in admission and pre-worker secret checks. A fake-credential regression proves the worker pauses without reaching a mocked paid operation or echoing the credential in its visible message. No production credential was retrieved. |

History revisions preserve all previously accepted entries, their order and the starting brief. New entries are descriptive instructions, never approval. The existing 20-entry/6,000-character limits remain, with explicit errors and no silent truncation. A revision retains the previous checkpoint metadata and current source; it clears/revalidates the current planning/review checkpoint as appropriate. It does not reuse old release approval for changed source.

## Verification against the requested checks

| Area | Evidence |
| --- | --- |
| Correct Continue target | Fresh cloud identity/generation is checked. Stale labels cannot record Continue as a change. Approved tasks do not restart. Missing initial creations reuse their saved identity/payload. |
| Original request and modifications | Ordered/schema-bound history; exact compiled brief matching; stored prefix cannot be erased by revision; Plan renders escaped confirmed history. |
| Reload/budget/interruption recovery | Browser reload roundtrip; Postgres-backed budget-pause and uncertain-claim/new-worker regressions retain history and checkpoints. No automatic paid restart. |
| Active/unconfirmed protection | Atomic inactive-task revision; generation comparison; immutable initial pending envelope; active-task delete rejection; local source conflict preservation. |
| Concurrent Resume/spending | Row-lock races cover both Resume-first and revise-first orderings, one scheduled mocked paid step per winner, same-screen single flight and stale-generation rejection. Existing duplicate-claim fences and financial reservations remain. |
| Ownership/authorization | Incorrect project token cannot read/resume/revise/stop/delete/deduplicate a task. Visitor code is insufficient. Correct token from another environment scope is rejected. No capability is discarded on failed deletion. |
| Plan/progress truth | Actual local source remains visible during conflicts; approval is invalidated; displayed source checks/requirements remain separate from execution proof. Malformed history cannot partially advance a checkpoint. |
| PR #64 regression | All prior cases remain in the complete suite, including source review, repair rounds, path ownership, release signing/gates, background fencing, static checks, disabled execution and administrator locks. |
| Financial policy | $0.50/day platform, $0.20/day Coding within it, maximum two paid calls. Existing policy, ledger, reservations, reconciliation and research code remain unchanged. Their regression suite passes. |
| Execution/admin | Execution stays hard-disabled, no provider/runner/enabling route. Existing empty-admin-token HTTP tests reject operator access and confirm execution enablement attempts cannot activate it. |

## Actual validation

- Fresh original-head baseline: **448 passed, 0 failed/skipped**.
- Corrected code: **469 passed, 0 failed/skipped**, all 448 original cases plus 21 new cases. Some existing UI tests now exercise the real admission function through a trusted test harness rather than assuming client-side history mutation is a successful cloud save. Existing feature assertions are retained or strengthened for the corrected behavior.
- `npm run build` passes locally, approximately **50.3 MB** Nitro/Vercel output. `git diff --check` passes. No dependency/lockfile change.
- Chromium/Playwright passes at **320×740**, **390×844**, **1440×1000**: typed Continue, one cloud identity across requested changes, generation-controlled revision, history/requirements/Plan, reload persistence, frontend fixture preview, Changes, pause/Resume/Stop, no automatic restart, no horizontal overflow and zero page errors. An adversarial stale bare-helper response cannot break the versioned workspace import.
- Browser responses and AI operations are mocked; the local server has its API key cleared. SQL tests use local PGlite and serialized test clients. This exercises actual SQL/application transactions but is not a production multi-replica load test or a live Workflow/provider test. Physical Android hardware was not tested.
- New deletion regressions initially exposed a missing server guard during implementation; it was corrected before final validation. No production deletion was performed.
- Final GitHub Node 22/24 checks belong to the corrected draft head and must be green before merge. No live paid-model testing or additional paid infrastructure was used.

## Reviewed file inventory

All 12 originally changed files were reviewed, together with the corrective changes. The resulting PR contains 16 changed files:

- `public/build-requests.js`: bounded, strict descriptive history; no approval/scheduling authority.
- `public/build-workspace.js`: exact source equality alongside the existing observer/display utilities.
- `public/ritual.js`: fresh state, single-flight admission, same-identity revisions, recovery payload, conflict-safe application/preview, truthful Plan and confirmed deletion.
- `server/build-jobs.js`: project capability checks, scope, row locking, generation guards, immutable accepted history, safe revision and inactive deletion.
- `server/app.js`: existing visitor/capability routes, validated source/history/checkpoint data, required control generation; no administrator/financial-policy changes.
- `server/build-worker.js`: stored history and pre-paid metadata secret checks; existing role/fencing/repair/gate flow retained.
- `public/app.js`, `public/index.html`: application cache version.
- `vercel.json`: existing development-branch deployment disablement retained.
- `tests/build-request-history.test.mjs`, `tests/background-build.test.mjs`, `tests/phase2-workspace.test.mjs`: existing cases extended; history, SQL, authorization and UI regressions.
- `tests/pr65-recovery.test.mjs`, `tests/support/build-screen.mjs`: trusted workspace-function harness with mocked transport/persistence; races, collisions, stale snapshots, pending payloads, local edits and deletion coverage.
- `docs/phase2-request-history.md`, `docs/pr65-final-review.md`: implementation history, corrections, results and limitations.

## Remaining limits and release notes

1. **Capability-based ownership:** each project needs its own unguessable token plus visitor access. This prevents someone without that token from controlling the project. A copied/shared token conveys its authority; there is no account-bound ownership/session system or per-user budget isolation. Do not describe this as complete multi-tenant authentication.
2. **Refresh older clients:** public Resume/revise now requires the saved generation. An older cached UI gets a 409 asking it to refresh rather than silently replaying paid work. The updated UI supplies it. Internal trusted store callers retain their existing compatibility.
3. **Explicit source conflicts:** divergent local edits are retained; they may require comparing Changes, stopping an active cloud task and explicitly resuming/reviewing local source. They are not silently merged or treated as approved.
4. **Unknown external outcomes:** cancellation cannot refund incurred charges, and distributed provider billing is not exactly-once. Initial task creation is idempotent by task identity; uncertain paid attempts remain fenced and require explicit resumption. Daily budget reset does not restart them.
5. **Storage/version limits:** persistent outages retain only the last committed checkpoint. History remains bounded; legacy flattened briefs cannot be reconstructed into exact old messages. Browser fallback/manual edits still have their existing separate history rather than a unified signed requirements ledger.
6. **Full-stack execution incomplete:** no approved secure guest execution, generated backend/database/authentication tests, real build logs or execution-driven debugging. Static checks and frontend previews cannot prove these features. Full-stack release remains blocked; resource/network numbers remain future isolation requirements.

No merge, deployment, execution enablement, budget increase, administrator change or paid-service activation is authorized by this report. Obtain explicit owner approval for those actions.
