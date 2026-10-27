# Phase 2 Stage 6 — Coding Agent reliability and efficiency

Development baseline: PR #69 merge `182b3a475a9c9aca972517ff42eafdaddb51095d`.
Branch: `codex/phase2-stage6-reliability-efficiency`. Draft only; no merge/deployment authorized.

## Implementation

### Generation context

`server/build-context.js` selects complete edit targets, directly related consumers, transitive literal HTML/CSS/JS dependencies, named contract/task dependencies and root package/compiler/schema configuration. Unsupported backend languages and dynamic imports use a complete-source fallback; required files that exceed the context budget fail before a model call. Unrelated bodies are omitted with their filenames explicitly retained. No file is truncated.

The background worker records character-based context estimates; `server/app.js` applies the selector to the actual generation request. Original requests, acceptance requirements, architecture and ownership instructions remain intact. Single-file worker instructions no longer also ask for every owned file. Foreground/legacy paths remain compatible. The selector is a conservative lexical analysis, not a complete language-service dependency graph. Unknown frameworks/aliases and future syntax need independent review; final source review still requires the complete project and is never pruned.

No planner, security, reviewer or approver role was removed. Mandatory source/release gates and model pricing policies are unchanged. This increment does not reuse release approval tokens or remove the second source review.

### Durable response receipts and recovery

Background jobs now persist a server-owned operation identity before a paid service step. It is bound to the job's stored request, exact source, plan/architecture, operation kind/file and repair counters using canonical SHA-256. Current generation and private claim key are checked under the existing row lock. Receipt results have a digest and a 600,000-byte ceiling; corrupt/conflicting receipts fail closed. Client snapshots expose only operation ID/kind/file/status, never the cached raw result, binding, worker key or result digest. Imported checkpoints cannot supply an operation result.

A confirmed response is stored before processing it into a file/checkpoint. If the response receipt committed but its acknowledgement was lost, a resumed worker can reuse it for the same input instead of billing again. The checkpoint and retirement of that raw cached response commit together. This bounds retention: only the latest operation receipt is kept, not a new unbounded source/result history. Original request history remains separate and preserved.

A healthy duplicate claim does not invalidate the active worker. Claims older than five minutes pause and fence the old generation; no replacement model call is started automatically. A started/uncertain receipt blocks Resume unless the owner explicitly confirms that a retry may already have been charged. That confirmation carries the current generation and cannot start two concurrent resumes for the same generation. A normally denied budget/rate/concurrency/permission admission remains resumable without an uncertainty prompt. Unknown transport or settlement failures are conservative.

Explicit Pause/Cancel/legacy Stop fence old writers and preserve files/history. Cancel stops work without deleting the project; the owner may later choose Resume. No task restarts when a daily budget resets. Manual Resume preserves cumulative file-attempt/review-round counters; revising the task can establish new work. Final release evaluation is always fresh rather than replaying a time-limited approval.

Foreground file generation previously could retry a thrown network/stream error. It now pauses for uncertain errors. Only an incomplete response with a trusted stream completion marker can receive the existing bounded missing-file retry. Saved completed files stay intact.

This is not provider exactly-once delivery. A request can be charged immediately before a process crash or cancellation. If no response receipt was durably confirmed, it remains uncertain and requires explicit retry approval. The existing AI ledger remains authoritative for money; the job receipt is not a second spending ledger and is not yet linked to a provider-side idempotency key. Compound release evaluation can include multiple governed calls and is not a resumable per-model-call journal. Foreground work has no durable server response cache in this increment.

### Database transactions

`server/postgres-transaction.js` is shared by the two existing production pool adapters. It bounds lock, statement and idle-in-transaction time, rolls back business failures and supports the governance ledger's existing audited-denial commit behavior. A failed COMMIT acknowledgement destroys the client even if a later ROLLBACK responds successfully. A failed ROLLBACK or failed BEGIN also destroys the client. There is no transparent transaction retry.

Build create/resume IDs, generation checks, row locks and existing admission serialization remain in place. Tests exercise actual trusted SQL against local PGlite, including concurrency, committed reservations/creates with lost acknowledgements and conservative state preservation. PGlite serializes its single connection in these fixtures; this is offline regression evidence, not a multi-host PostgreSQL failover certification.

No schema migration, production database connection, new database or production setting change was performed. The new job field is in existing JSON state. Both pools retain the exact existing `postgresPoolOptions` TLS policy. No certificate or hostname verification was disabled.

### Mobile workspace

The compact task strip provides visible Plan, Pause and Cancel actions and keeps Resume for paused work. Control submissions are guarded against double actions; confirmation failures leave the task's true state uncertain instead of declaring success. Busy state clears after acknowledged Pause/Cancel. The file disclosure shows actual saved source and the generating file, always labelled runtime-unverified. Saved-file counts use present source rather than an incomplete imported `savedPaths` list. Controls have 44px touch targets and wrap at narrow widths.

The workspace retains the separate Generated/Simulated/Executed/Independently verified disclosure. No imported success flag or iframe diagnostic can grant execution or independent verification. Existing source checks, Plan, previews, Changes, activity, original requests and later modifications remain available.

## Offline cost measurement

Method: deterministic fixture with four linked frontend files and twelve unrelated archive pages. Compare the old `fitProject(files,90000,{requiredPaths:['index.html']})` source context against dependency selection, including each omission notice. Common system/task prompts are excluded from both sides. Estimate tokens as `ceil(characters / 4)`; no tokenizer/model/API billing was invoked.

| Source-context component | Before | After |
|---|---:|---:|
| Included file bodies | 8 | 4 |
| Characters including omitted-path notice | 76,837 | 673 |
| Estimated tokens at 4 characters/token | 19,210 | 169 |
| Fixture reduction | | 99.12% |

This intentionally demonstrates unrelated-content pruning. It is not a promised whole-request or production saving. Shared prompts remain; small tightly linked projects may save little or nothing, and unsupported/dynamic projects use full context or pause if it does not fit. Receipt recovery tests additionally demonstrate one mocked plan call across a lost acknowledgement and Resume rather than two calls. No real-model quality or cost benchmark was run.

## Security review findings within this change

- **Medium, corrected:** production pool clients could be returned after uncertain commit/rollback failures. Shared failure handling now discards them; reservations remain durable/held where a commit may have succeeded.
- **Medium, corrected:** a paid response could be lost between model completion and checkpoint processing. Server-owned, digest-checked receipts allow bounded recovery without trusting imported client state.
- **Medium, corrected:** foreground thrown transport errors could cause another automatic file call. Uncertain outcomes now pause rather than retry automatically.
- **Low, corrected:** duplicate delivery could fence an otherwise healthy background worker. Live claims now coalesce; expired claims still fence and pause.
- **Low, corrected:** task controls could leave the composer busy after acknowledged cancellation, and imported saved-path lists could undercount present files. Browser checks cover the corrected states.

No critical or high issue was identified in this implementation pass; this is not an independent external audit. The draft is intended for a separate security review, not automatic merge approval.

## Preserved protections

Platform AI $0.50/day; Coding AI $0.20/day within it; at most two concurrent paid AI calls. Budget policy/defaults and the administrator guard are byte-for-byte unchanged. TLS helper, execution adapter, infrastructure simulator/storage and trusted mock-evidence modules are unchanged. Real infrastructure allowance stays zero, persistent infrastructure governance stays unmounted, and real execution stays disabled. No provider SDK or dependency was added, administrator token configured, secret read/changed, or sandbox created.

The branch is listed as deployment-disabled in `vercel.json` from its first published commit. No production rollout, billing change or new paid service is part of this PR.

## Validation

Local full regression: **658 tests passed, 0 failed, 0 skipped** (29 additional regression cases over the 629-test baseline). Local clean production build passed: **50.3 MB / 19.8 MB gzip**. GitHub CI on Node 22/24 is required on the exact published head; see the Draft PR checks for its final status.

Chromium at **320×900, 390×900 and 1440×900** passed both suites: (1) Plan and verification disclosure, forged imported success flags, no document overflow, standard/restricted resource probes, bounded diagnostics and unloading; (2) mocked active background Pause, Resume, Cancel, file status, direct Plan access, saved source count and cleared composer busy state. No page errors, actual model calls, provider calls or unexpected backend requests occurred. The diagnostic flood retained 30 combined UI items and unloaded its hidden frame. The known self-navigation limitation was reproduced with a locally intercepted URL and is not claimed fixed. All test model/provider operations are mocked; SQL tests use offline PGlite. Browser routes use local static files and mocked configuration/job transport; no actual job or paid-model request is sent.

## Remaining limitations and rollout notes

- Source generation and source checks do not establish working backend, database or authentication behavior. Real full-stack verification remains incomplete.
- Existing preview self-navigation/CSP bypass, renderer CPU/memory exhaustion, and forgeable same-frame reports remain. Restricted mode is not complete network isolation.
- Receipt hashes detect accidental corruption, not a malicious database administrator or a fully consistent old database snapshot. External anti-rollback authority remains unimplemented.
- Source selection is lexical. Full final review is preserved; broader framework dependency tooling is deferred.
- Task cancellation cannot reverse a provider charge or eliminate every last-moment dispatch race. No automatic retry occurs for an uncertain response; explicit retries may incur another charge under the same budget.
- Response receipts add database reads/writes on the existing infrastructure. No additional service is introduced, but the AI ledger does not cap database, Workflow or hosting invoices.
- A lost queue/Resume acknowledgement can require reconnecting and explicit recovery; this increment does not implement a transactional Workflow outbox.
- Retained state remains subject to the existing 1.8 MB job ceiling. Large receipts can pause safely for recovery rather than exceed storage bounds.
- Physical Android devices and real production database/network failure scenarios were not tested. Chromium responsive emulation is not physical-device certification.
- Before a future rollout/rollback, pause in-flight coding jobs and review receipt compatibility. Legacy jobs without receipts remain supported. Downgrading removes the new recovery protections; no downgrade/migration was performed here.

Recommendation: ready for independent security review once exact-head CI, full tests, production build and responsive checks pass. Do not merge or deploy without separate owner approval.

## Focused security/reliability review follow-up

The follow-up review of the initial Draft PR head found and corrected two additional issues:

- **Medium — context completeness:** extensionless JSX/directory imports, module aliases/workspace packages and unresolved literal references could omit required source. JSX/TSX entrypoints are now resolved, responsive-image/poster dependencies retained, and uncertain module resolution uses full-source fallback or fails before a paid call if complete source does not fit. This deliberately favors correctness over estimated savings for unsupported resolution.
- **Low — receipt determinism:** locale-sensitive filename sorting could change an operation binding between environments. Receipt source ordering now uses a binary comparison. A mocked locale-change regression proves the saved response is reused without depending on `localeCompare`.

Five regression cases were added. Final local full suite: 658 passed, zero failed/skipped. Clean production build remains 50.3 MB / 19.8 MB gzip. Both responsive Chromium suites passed again at 320, 390 and 1440 pixels, with mocked job transport and zero model/provider calls. GitHub CI must pass on the correction head; refer to the Draft PR checks for its final result. The original fixture's 99.12% source-context estimate is unchanged and remains a fixture-only estimate.

No critical/high or additional merge-blocking medium finding was identified in this bounded pass. Existing preview isolation/report-trust, provider exactly-once, full-stack execution, physical-device testing and database anti-rollback limitations remain. This follow-up is an assistant review, not an external independent audit or merge authorization.
