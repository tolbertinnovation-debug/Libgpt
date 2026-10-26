> Final review: [findings, corrections and 434-test validation](phase2-final-review.md). Counts below describe the earlier increment.

# Phase 2 continuation — Draft PR #64

This increment continues the existing established architecture on `codex/phase2-audit-tasks`. It does not merge, deploy, enable execution, provision services, change production settings or complete all of Phase 2.

## Completed improvements

### Planning and coordination

Newly generated plans must contain at least one nonempty acceptance requirement. The existing one-correction limit remains; repeated invalid output pauses rather than creating an open-ended paid planning loop. Legacy saved plans still load through the existing normalizer without a forced paid replan.

Both server and browser reject case-conflicting file ownership and file/directory collisions (for example `assets` alongside `assets/app.js`). Future execution manifests apply the same collision protection. Existing exclusive builder ownership, complete target context, six-role compatibility, source reviews and bounded owner-assigned repairs remain.

### Static verification

`public/build-static.js` is a shared pure source inspector. It never evaluates JavaScript, imports generated dependencies, runs commands or connects to a database. It checks:

- CSS delimiter, quote and comment closure, including escaped selectors and quoted delimiters. This is a lexical check, not full CSS grammar or layout validation.
- JSON syntax, including embedded HTML `application/json` and `application/ld+json` scripts.
- Basic `package.json` configuration shape: object, supported `type`, string-valued scripts and dependency maps. It does not install dependencies or validate package provenance.
- SQL lexical structure, including comments and PostgreSQL dollar-quoted bodies. Findings are explicitly warnings, not dialect-aware validation or proof that migrations run. No previous SQL release gate is removed; full-stack release remains blocked.

CSS/JSON faults feed the existing project/review/QA fault path. HTML completeness, references, security checks and JavaScript parse-only checks remain. Release QA now also parses `.cjs` and unreferenced ESM source. An explicitly classic HTML script cannot pass simply because its body contains module syntax. No source command is executed by these checks; the existing Node `--check` path remains parse-only, not a sandbox.

### Persistent tasks and spending

Immediately before each worker service step, re-read persisted generation and active status. A stop recorded after the task announcement but before this check prevents entering the mocked paid service. Existing provider abort monitoring and generation fencing still discard stale writes.

Simultaneous Resume requests serialize under the existing row lock and schedule once. Repeated Stop is idempotent. Approved tasks cannot be changed to stopped or resumed into another paid release pass. Editing/rebuilding remains a separate existing workflow.

Existing budget pauses, checkpoints, saved source, explicit resume, uncertain-claim fencing and atomic financial reservations are retained. No scheduler or automatic daily-reset restart is added.

Cancellation cannot undo provider charges already incurred. A stop racing after the last status read may reach an already-starting request before the abort monitor observes it (approximately 1.2 seconds). This increment narrows that window; it does not promise distributed exactly-once provider billing. Unknown attempts remain conservatively reserved and require explicit user resumption.

### Workspace

Plan view now shows each owned file as source present or not saved, the recorded architecture test plan as intentions rather than results, and current CSS/SQL/JSON source findings recomputed from the displayed project files. It explicitly distinguishes these local checks from HTML/JavaScript release QA and unexecuted build/test commands. Requirements remain requirements to verify, not fabricated pass marks.

Long ownership paths wrap inside the mobile sheet. Existing compact agent progress, actual file differences, frontend preview, pause details and explicit Resume/Stop controls remain.

### Secure execution preparation

The disabled manifest interface now rejects file/directory and case collisions in addition to existing unsafe paths, links, credentials, environment injection and arbitrary commands. No runner/provider/SDK was installed. No environment variable can enable execution. A properly isolated provider, resource/network enforcement, cleanup and actual build/test evidence remain future approved work.

## Important files

| Files | Purpose |
| --- | --- |
| `public/build-static.js`, `public/build.js` | Shared static source checks and existing project issue integration |
| `server/release-gate.js` | ESM/CommonJS parse-only checks with explicit HTML script modes |
| `server/build-team.js`, `public/build-team.js` | Acceptance criteria and consistent ownership conflict rejection |
| `server/build-worker.js`, `server/build-jobs.js` | Pre-step cancellation/fencing checks and idempotent controls |
| `server/build-execution.js` | Collision-safe manifest; execution still disabled |
| `public/ritual.js`, `public/styles.css` | Plan evidence, per-file progress and mobile wrapping |
| `public/app.js`, `public/index.html` | Updated application cache version |
| `tests/phase2-static.test.mjs` | Eight new static/planning/ownership/release regressions |
| `tests/background-build.test.mjs` | Two new cancellation/concurrent-Resume regressions |
| `tests/phase2-workspace.test.mjs` | Existing escaped Plan view checks extended to shared report dependency |
| `tests/team-planning-recovery.test.mjs` | Existing planning fixture now contains the required acceptance criterion; all prior assertions retained |

## Actual validation

- **424 automated tests passed, 0 failed, 0 skipped**: 414 tests from the previous PR increment plus 10 new tests. All provider operations are mocked. The pre-existing planning recovery fixture was updated for the new acceptance criterion; no test or assertion was deleted.
- `npm run build` passed locally with the Nitro/Vercel production output (approximately 50.3 MB). Building locally is not deployment.
- `git diff --check` passed.
- Chromium/Playwright at **390×844** and **1440×1000** passed: compact task strip; requirements and source counts; long ownership paths; recorded test intentions; current static fault reporting; Changes view; actual HTML fixture preview; budget pause without automatic restart; explicit Resume and Stop; no document or Plan-sheet horizontal overflow; zero page errors.
- Browser tests use mocked job/config responses, a local database-free server with the API key cleared, and a hand-authored frontend fixture. They do not prove production worker integration, generated backend behavior or real database/authentication flows. No physical Android device was tested.
- Phase 1 financial policy, ledger, reservation/reconciliation implementation and administrator authentication files are unchanged. Policy remains **$0.50/day total, $0.20/day Coding inside it, two paid calls**. Existing governance concurrency/budget/research tests are included in the passing suite.
- **No live paid-model tests, no provider credit spent, no new app dependency, no additional paid infrastructure.** Administrator setup and production secrets remain untouched. Automatic deployment remains disabled for this development branch.

## Remaining limitations and recommendation

Ready for human code review as a bounded continuation of PR #64; keep the PR draft until its remaining scope and CI are reviewed. This is not approval to merge or deploy.

Static checks are conservative and incomplete. CSS findings may require human inspection; SQL dialect, database constraints/migrations, dependency correctness, backend behavior, authentication/roles, performance and end-to-end security require approved execution and actual tests. The browser fallback and background worker still have separate engines; this change aligns ownership checks but does not unify them. Administrator controls must remain locked while `RITUAL_ADMIN_TOKEN` is absent.

The full-stack release block and independent review/security/QA/approver gates remain. Secure execution and execution-driven debugging remain disabled/pending approval. The principal cost risks remain existing provider-contract violations and uncertain in-flight charges, handled through the unchanged conservative governance system; budgets are not raised or automatically reset by task control.
