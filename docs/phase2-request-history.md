> Latest: [final PR #65 review, corrections and 469-test validation](pr65-final-review.md). The original implementation/results below describe the earlier draft increment.

# Phase 2 — request history and economical cloud resumption

Base: production merge `3f51752002f66d5b452911c465799e7cc0ae1570` (PR #64). Development branch: `codex/phase2-request-history`. This is a bounded continuation of Milestones B/E. No merge, deployment, production setting change, administrator setup, paid service or secure-execution enablement is included.

## Problem and resulting behavior

Previously, typing `Continue` into a paused cloud build started another planning job, while the Resume button used the saved checkpoint. A new instruction could also replace the initial request when planning had stopped before any file was created. Repeated changes were represented only inside an increasingly combined brief.

Now:

- Exact, explicit commands such as `Continue`, `Resume`, `Retry` and `Try again` use the saved Resume path for a paused cloud task. They do not append another requirement or request a fresh plan merely because they were typed. A changed local source can still require the existing checkpoint-import/new-task path; previous files/plan remain subject to validation.
- `Continue` on an approved build points the user to Preview or a specific requested change. A Resume command with no saved task cannot start a paid planning job.
- The original brief and ordered requested changes are recorded separately, retained in device project snapshots and the existing cloud job/checkpoint JSON, and shown in Plan. The server validates that the compiled history exactly matches the task brief before creating the task.
- Later requests take precedence over conflicting earlier instructions, while all recorded requests remain present. Chat shows the newly typed instruction rather than repeating the entire combined brief.
- Non-chat cloud entry points also compile a matching history before admission. Existing task creation remains idempotent: retrying the same project identity cannot replace its saved brief/history.
- An unconfirmed cloud creation cannot be replaced with a different request until its existing identity is checked. Observation/reconnection is safe; explicit Resume reuses the existing identity. This avoids abandoning an uncertain job and starting another paid job alongside it.
- History is bounded to **20 entries** and the existing **6,000-character compiled brief**. Overflow stops before a new cloud API request and preserves the previous history/files. Nothing is silently summarized or discarded to make room.

Legacy projects retain their existing saved brief, explicitly labelled as predating request history. Earlier individual requests cannot be reconstructed reliably from a combined legacy brief, so no invented history is created. Corrupt local history does not prevent inspecting source and the existing Plan; starting another task still requires valid history.

## Security and cost controls

Request history is client-supplied descriptive project data. Existing visitor access, per-project capability tokens, generation/work-key fencing and independent release gates continue to supply authorization. The schema rejects approval flags/tokens and arbitrary extra fields; ordered entries, kinds, timestamps, text and size are validated. Plan rendering escapes the recorded text.

The worker derives checkpoint history from the stored job metadata rather than an imported checkpoint claiming approval. The existing secret inspection includes the submitted history. No new route, model call, agent, dependency or database schema is introduced. History uses existing JSON persistence and existing responses, without an extra synchronization request.

**Financial controls remain $0.50/day total, $0.20/day Coding within it, and two concurrent paid calls.** Phase 1 policy, atomic reservations, safe reconciliation, research limits and administrator authentication are unchanged. The full suite includes their regressions and the empty-admin-token HTTP test.

There is no automatic paid resumption at a daily reset. An explicit Resume command/button remains required. Secure execution stays disabled, and full-stack release is still blocked pending implemented and actually executed verification in an approved isolated environment.

Additional paid-model testing: **$0**. Additional paid infrastructure: **$0**. Automatic deployment is disabled for this development branch before publishing it. Merge/deployment require separate owner approval.

## Files changed

| Files | Purpose |
| --- | --- |
| `public/build-requests.js` | Shared pure history normalization, bounded compilation, append behavior and exact Resume-command recognition |
| `public/ritual.js` | Cloud command routing, uncertain-creation guard, request admission, persistence roundtrip and escaped Plan history |
| `server/build-jobs.js` | Validate/match/store history while preserving identity deduplication and row locking |
| `server/build-worker.js` | Carry stored history into durable checkpoints |
| `server/app.js` | Pass validated request data through existing job admission and secret checks |
| `public/app.js`, `public/index.html` | Refresh application cache version |
| `vercel.json` | Disable only the new development branch's automatic deployment |
| `tests/build-request-history.test.mjs` | Twelve behavioral regressions for ordering, bounds, validation, routing, non-chat admission and uncertain task identity |
| `tests/background-build.test.mjs` | Two additional Postgres-backed regressions for history preservation and admission/deduplication |
| `tests/phase2-workspace.test.mjs` | Extend existing Plan checks for escaped history and graceful corrupt-metadata display |
| `docs/phase2-request-history.md` | Implementation, evidence and limitations |

## Actual validation

- **448 automated tests passed, 0 failed, 0 skipped**: all 434 tests from merged PR #64 plus 14 new regressions. Provider operations are mocked. Durable store tests use local PGlite, not a production database.
- `npm run build` passes locally; approximately 50.3 MB Nitro/Vercel output. This is an application build, not generated-project execution or deployment.
- `git diff --check` passes. No dependency or lockfile change.
- Chromium/Playwright passes at **320×740**, **390×844** and **1440×1000** with a database-free local server, cleared API key and mocked job/config responses. Checks cover typed Continue using the existing control endpoint, no extra job creation, an actual new instruction preserving the original brief, history in Plan, persistence after page reload, genuine frontend fixture preview, existing Changes/task controls, no auto-restart, no horizontal overflow and zero page errors.
- One earlier screenshot attempt timed out while heavy local checks ran concurrently. The final serial browser run passed without an application workaround.
- This does not test physical Android hardware, live provider calls, production Workflow integration or generated backend behavior. GitHub CI status belongs to the draft PR and should be checked before any merge.

## Remaining limitations

This history is for cloud build requests. The separate browser fallback engine retains its existing behavior; manual file edits and restored versions use the existing chat/project history and review instructions. There is no claim of a complete signed change/audit ledger, per-requirement test evidence or automatic acceptance verification.

The 20-entry/6,000-character limit intentionally requires a shorter new build brief rather than paid automatic summarization. Legacy flattened history cannot be recovered into exact original messages. Device/cloud storage availability and existing per-project capabilities still govern recovery; there is no new account-based project recovery system.

Source reviews, static checks and frontend previews do not establish backend/database/authentication functionality. Secure isolated execution, actual generated builds/tests, execution-driven debugging and complete full-stack delivery remain incomplete. Cancellation cannot reverse charges already incurred, and an uncertain provider attempt must not be assumed free merely because its response was lost.
