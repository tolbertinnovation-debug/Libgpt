# Phase 2 first increment — implementation report

Branch: `codex/phase2-audit-tasks`. Base production commit: `58bc6252ab638cbecf063cd05ceb2115da7f08da`.

This is a bounded first increment, not completion of the entire autonomous full-stack objective. See [Milestone A audit and technical design](phase2-audit-and-design.md).

## Implemented

- **Milestone A complete:** audited actual production source, existing roles, context packing, durable job/fencing, governance, source-only verification and workspace. Confirmed Phase 1 live limits remain $0.50 platform / $0.20 Coding / two paid calls. No new agents or framework migration.
- **Milestone B partial:** background generation pins the complete existing edit target in context, or returns a clear size limit before any provider call. Unrelated omitted paths are disclosed. Durable checkpoints record budget/rate/concurrency/operator/storage/context/review/verification/interruption blockers. Resume clears the blocker only on explicit owner action; completed files and the current phase survive. Duplicate uncertain work remains fenced instead of being replayed/billed again.
- **Milestone C interface only:** validated source/check manifests and an artifact hash; a read-only visitor-protected readiness route. Execution is hard-disabled. Shell commands, injected environment values, traversal, duplicate files, links and credentials are rejected. The module creates no runtime, sends no request to a provider and never invokes a process. Every check reports `not_run`, with no fabricated logs or passes.
- **Milestone E partial:** a Plan sheet shows the original request, acceptance requirements, actual files present, active file owners and the shared implementation contract. Budget pauses have their own compact label and explicitly explain that the task will not restart automatically. The sheet states that source reviews/frontend previews do not prove a backend/database/login works.

## Validation

- `npm test`: **414 passed, 0 failed, 0 skipped** (all 402 original tests plus 12 new regressions).
- `npm run build`: local Nitro production bundle passes.
- `git diff --check`: clean.
- Local Chromium/Playwright checks pass at **390×844** and **1440×1000**, with no page errors or horizontal overflow. Verified compact progress, Plan requirements/ownership/source counts, disabled-execution disclosure, a genuine frontend fixture preview, budget-paused labels, no automatic restart, and explicit Resume/Stop. These are browser viewport checks, not testing on physical Android hardware.
- All AI calls and background-job responses used in these tests are mocked. No generated server code is executed. Temporary browser tooling is kept outside the repository; no app dependency is added.

Added regression coverage includes:

- Target file prioritized ahead of smaller unrelated files; complete source preserved without mutation; oversized target rejected before provider billing.
- A full durable build pauses after a completed file, survives another worker instance, refuses to auto-run, and resumes only the unfinished files after explicit control.
- Duplicate claims fence old writes and record an interruption blocker.
- Execution stays disabled despite environment flags. A malicious code string cannot create a marker file. Unsafe manifests, secrets, commands, environment injection and links are rejected.
- Execution readiness uses the existing visitor gate, has no enabling POST route, and changes no administrator authentication.
- Workspace rendering escapes project text, counts source rather than claimed approval, and requires manual resume.
- All existing Phase 1 budget, concurrency, research-reservation and reconciliation tests remain in the full suite.

## Costs and incomplete work

Additional paid-service cost: **$0**. Paid-model testing: **$0**. No dependency or provider is added to the app. Existing database JSON checkpoints gain descriptive metadata; no schema migration or production data change is performed.

The browser fallback still has its separate engine and does not yet use the server's pinned-target context contract. Engine unification, structured requirement/change tracking, an approved isolation adapter, actual generated-project lint/build/tests, execution-driven debugging, authenticated backend previews, per-file review approvals and project delivery remain future increments. Full-stack release remains blocked by the existing gates. Administrator setup and production audit access remain deferred.

The execution resource numbers are a proposed contract only. They are not proof of enforced isolation. No environment switch or model instruction can turn execution on. Future provider/cost/enablement, merging and production deployment require explicit owner approval.
