# Draft PR #64 — final code review

Reviewed starting head: `29c915a153d5b67e836e321e999592f6abffb79b`. Base production branch commit: `58bc6252ab638cbecf063cd05ceb2115da7f08da`. Review and corrections remain on `codex/phase2-audit-tasks` in the existing draft PR. No merge, deployment, production setting/secret/data change, paid infrastructure or live paid-model test was performed.

## Recommendation

After the corrections below and successful validation, **safe to merge as a bounded Phase 2 improvement**, subject to the owner's explicit approval and final CI checks. This is a code-review recommendation, not a production security certification or authorization to deploy. Keep secure generated-project execution disabled and retain the full-stack release block.

No unresolved critical or high-severity issue was identified in the reviewed PR scope. Three medium findings and one low finding were corrected. Remaining functional and operational limits are recorded below.

## Findings and corrections

| ID | Severity | Reproduced behavior before correction | Correction and evidence |
| --- | --- | --- | --- |
| R1 | Medium | A file named `app.mjs` containing `export` passed QA even when HTML loaded it as a classic script. Attribute regexes could also mistake `data-type` or text inside a quoted attribute for an actual script mode. | Inspect real attribute names, quoted/unquoted values and first duplicate values. HTML loading mode takes priority over suffix; a source used in multiple modes must parse in each. Inline checks share the same scanner. Embedded JSON accepts actual unquoted type attributes; unclosed script elements fail QA. Regressions cover suffix overrides, mixed modes, data attributes, quoted lookalikes, duplicate attributes, embedded JSON and missing closing scripts. |
| R2 | Medium | Ownership validation rejected conflicting planned paths, but imported/unplanned source could contain `data.json` and `DATA.json`, or a file named `assets` alongside `assets/app.js`. A new plan could also alias an existing imported path. Checks/hashing could accept the ambiguous artifact. | Share the collision predicate across browser/server planning, actual file validation, background admission/work, release hashing and disabled execution manifests. Reject conflicts before edits or further paid work; preserve existing files and explain that filenames need resolution. Tests cover actual imports, planned/imported aliases, browser preflight, release rejection and source preservation after Resume. |
| R3 | Medium | If storage monitoring aborted a worker while a mocked provider returned, the worker returned `stopped` without clearing the durable work key or updating the saved active status. The interface could appear to keep working until later recovery. | Preserve a safe interruption reason and use the existing generation/key-fenced pause save. When storage is available again, returned progress is saved, processing clears and Resume continues from the saved phase without another planning call. A stop or newer generation still rejects stale writes. A regression simulates a transient private driver error, verifies redaction/pause/progress and proves no automatic replay. |
| R4 | Low | The disabled execution manifest used a different canonical source representation from release approvals, so identical files produced different artifact hashes. It could not activate execution, but would complicate future evidence integration. | Reuse the existing release artifact hash. Tests verify equal hashes for identical/reordered files and invalidation after a source change. Execution still returns `executed:false`, no provider and `not_run` checks. |

The original 424-test suite passed before changes, demonstrating that those tests did not cover these edge cases. Ten new tests now cover the review corrections and missing-administrator HTTP protections; existing tests and assertions remain.

## Complete changed-file review inventory

All 26 originally changed files were reviewed. Their baseline blob hashes matched the actual connected PR head. With two new test files and this report, the PR has 29 changed files.

| Files | Review conclusion |
| --- | --- |
| `docs/phase2-audit-and-design.md`, `docs/phase2-first-increment.md`, `docs/phase2-continuation-review.md`, `docs/phase2-final-review.md` | Scope, historical counts, costs and execution limitations are explicit. Earlier counts are historical and link to this final review. |
| `public/app.js`, `public/index.html`, `vercel.json` | Cache version refreshed. Existing iframe sandbox attributes remain; no same-origin access is added. Deployment stays disabled for the development branch. No production branch deployment rule is disabled or changed. |
| `public/build-static.js`, `public/build.js` | Pure lexical/config/JSON checks feed existing project faults. Shared attribute scanner does not evaluate generated source. SQL findings are warnings; no dialect or migration success is claimed. |
| `public/build-task-state.js`, `public/ritual.js`, `public/styles.css` | Escaped Plan content; actual source counts; manual Resume messaging; no timers that restart paused work. Long paths wrap. Requirements and intended tests are not presented as test results. |
| `public/build-team.js`, `server/build-team.js` | Existing roles, exclusive ownership, bounded planning correction and owner repairs retained. Actual/imported file conflicts now fail closed in both engines. |
| `server/build.js`, `server/app.js` | Complete edit-target context retained or rejected before a provider call; omitted files disclosed. Visitor-only execution route reports disabled readiness. Background source admission rejects conflicting paths. Administrator middleware is unchanged. |
| `server/build-jobs.js`, `server/build-worker.js` | Row locks, generation/work-key fencing, checkpoints, idempotent controls, explicit Resume and no auto-replay retained. Storage-interruption cleanup corrected. No automatic midnight restart is introduced. |
| `server/build-execution.js`, `server/release-gate.js` | Execution remains hard-disabled with no provider or enabling route. Source identity is shared with release approvals. Existing independent gates/signatures/full-stack block remain; HTML/JavaScript QA is strengthened. |
| `tests/background-build.test.mjs`, `tests/build-execution-interface.test.mjs`, `tests/build-model-policy.test.mjs` | Mocked cancellation, recovery, duplicate claims/resumes, complete target source, disabled execution and visitor access coverage reviewed; added transient-storage and alias-preservation tests. |
| `tests/phase2-static.test.mjs`, `tests/phase2-task-state.test.mjs`, `tests/phase2-workspace.test.mjs`, `tests/team-planning-recovery.test.mjs` | Static limitations, ownership, bounded correction, escaped UI and actual source counts covered. Prior planning fixture retains the new mandatory acceptance criterion; no old assertion removed. |
| `tests/phase2-final-review.test.mjs`, `tests/phase2-admin-lock.test.mjs` | Seven source/ownership/hash regressions and one HTTP authorization/budget-policy regression added. Alongside two worker regressions, ten new tests. |

## Actual validation

- Original head: **424 tests passed, zero failures/skips** on a fresh local run.
- Corrected code: **434 tests passed, zero failures/skips** using `npm test` (Node 24). All original 424 remain, plus ten new tests.
- Production build: `npm run build` passed locally; approximately 50.3 MB Nitro/Vercel output. This does not deploy the application or execute generated project build commands.
- `git diff --check` passed. No dependency or lockfile changes.
- Chromium/Playwright passed at **320×740**, **390×844** and **1440×1000**: compact agent bar, Plan requirements/source counts/ownership, long paths, static fault reporting, Changes, a genuine hand-authored frontend fixture preview, structured budget pause, no automatic restart, explicit Resume/Stop, no horizontal overflow and zero page errors. The small-phone Plan can scroll to its final verification disclosure.
- Browser jobs/config responses are mocked and the local server has its API key cleared and no database connection. No physical Android device, real generated backend, production worker flow or live provider was tested.
- HTTP regression uses an empty administrator token and a mock-only/no-external-network environment: all administrator routes reject empty, visitor and forged admin tokens with 403. Readiness requires visitor access; enabling flags in its query are ignored; POST/PUT/PATCH/DELETE on the execution route return 404. No external request occurs.

## Financial and administrator verification

No changes to `server/agent-costs.js`, `server/agent-governance.js`, `server/governance-postgres.js`, `server/agent-runtime.js` or the Phase 1 research reservation/reconciliation code. The approved policy remains **$0.50 per UTC day for the platform, $0.20 for Coding inside that amount and two concurrent paid calls**.

The new HTTP test enables the actual approved policy (not the roomy policy-off helper used by some whole-app tests). Even with larger test environment defaults, returned limits are $0.50/$0.20/two. Unconfigured administrator routes cannot change them. Existing automated financial tests also cover shared concurrent reservations, coding/platform exhaustion, two-call capacity, partial/concurrent allowance updates, research retries/search bounds, UTC rollover, overrun recording and fail-closed storage.

Postgres tests use PGlite and serialized test pool connections. They exercise actual SQL and application transactions, but are not a real production multi-replica load test. No production ledger, secret or administrator credential was read or changed as part of this final review. This is source/local regression verification, not a fresh production configuration attestation.

Workflow paid steps retain `maxRetries=0`. Paused jobs cannot restart merely because the daily budget resets; duplicate/uncertain claims are fenced, and explicit Resume is required. Existing source-review/debugging roles and bounded repair rounds remain.

`RITUAL_ADMIN_TOKEN` is not configured by this PR. The existing minimum-length and constant-time administrator comparison remains unchanged. The visitor code cannot substitute for it.

Additional paid-model spending: **$0**. Additional paid infrastructure: **$0**. No app dependency, secret, service or execution provider was introduced.

## Remaining functional and operational limitations

- **Execution disabled:** no secure guest runtime, actual generated-project server build/test logs or execution-driven debugging. Resource/network limits in the manifest remain future provider requirements, not enforced isolation supplied by this app. An approved isolated provider and cost decision are prerequisites.
- **Full-stack work is source preparation:** generated backend/database/authentication/API code is not proven functional. Full-stack release remains blocked. A frontend preview or passing source review is insufficient evidence.
- **Static checks are incomplete:** HTML scanning, CSS lexical checks, package shape and SQL warnings do not validate full grammar, SQL dialect/constraints/migrations, dependency safety, business behavior, accessibility, performance or authorization. TypeScript and other backend-language compilation are not provided here.
- **Cancellation is not a refund:** an operation already sent to a provider may incur charges. A stop can race the final status check; monitoring/fencing prevents stale writes but cannot guarantee exactly-once external provider billing. Unknown attempts must remain subject to conservative governance and explicit resumption. Provider violations cannot be undone by application limits.
- **Storage outages:** the transient-monitor regression is corrected. If storage remains unavailable for the pause/save itself, the last committed checkpoint remains authoritative; workflow interruption recovery and explicit owner Resume are still needed. Uncommitted provider output cannot be promised durable.
- **Existing architecture:** browser/background engines remain separate. Source context limits and leading-dot path restrictions remain. Shared visitor access plus per-project capability tokens is not a full multi-tenant account/permission system.
- **Testing scope:** responsive emulation is not physical Android testing; no paid provider integration or production load test was authorized. A code review and passing tests do not establish that no unknown defect exists.

No known unresolved critical/high or merge-blocking medium defect remains within this bounded PR scope. Production merge/deployment, paid infrastructure and enabling untrusted execution still require explicit owner approval.
