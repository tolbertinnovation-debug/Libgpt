# Grandpa AI Phase 2 — Milestone A audit and technical design

Audit date: 26 October 2026. Production source: `58bc6252ab638cbecf063cd05ceb2115da7f08da` (merged PR #63). Relevant server and workspace files were compared by Git blob hash against the connected repository before editing. No `AGENTS.md` was present in the repository tree.

This is a code-and-test audit, not a claim that generated applications have been exercised with real AI output. No paid-model request was used. Read-only production health and governance checks confirmed the ledger is available and unpaused, with **$0.50/day total, $0.20 Coding within it, and two concurrent paid calls**. Administrator-token setup remains deferred. Production secrets and data are not changed.

## Existing capability inventory

| Area | Verified implementation | Limits and missing evidence |
| --- | --- | --- |
| Engineering team | Twelve existing roles: supervisor, architect, six builders, reviewer, security, QA/DevOps and approver (`public/build-team.js`, `server/agent-charters.js`). File ownership is exclusive and normalized. | No new agents are needed. Review/architecture gates still add calls even for small tasks. The planner already permits unnecessary builders to own zero files. |
| Natural-language planning | `generateTeamPlan`, validated requirements, runtime, stack, pages, instructions and owned paths; one bounded JSON repair. `generateArchitecture` records constraints/test plans before source generation. | These are proposed decisions, not operational proof. Plans still require `index.html`; path rules reject leading-dot files, limiting some CI/config scaffolding. |
| Full-stack source | Backend and cloud builders can write language-specific server source, authentication/authorization code, schema/migrations, manifests and tests. Prompts disclose environment placeholders and separate hosting. | No backend, database, authentication, role boundary, migration or approved API integration is proven operational merely by generated source. No production service is provisioned. |
| File generation | Complete fenced files are parsed; the background worker writes one assigned file per step and saves checkpoints. Invalid/incomplete output has a bounded retry. | The 90k-character context packer previously favored small unrelated files over a large file being edited. Fixing this is the first Milestone B increment. |
| Durable tasks | Workflow orchestrates up to 180 steps; Postgres stores job, files, plan, architecture, events, work key, revision and generation. Project tokens are hashed. Stops/resumes fence late writes. | An uncertain claimed attempt pauses instead of silently being billed twice. Storage is scoped by environment, not user accounts; shared visitor access is not tenant authentication. |
| Recovery and budgets | Budget denials stop work. User-triggered Resume is required; there is no midnight auto-restart. Workflow paid steps have `maxRetries=0`. Phase 1 atomic reservations/reconciliation remain intact. | Generic `needs_attention` hid the difference between budget, rate, permissions and interrupted work. Add descriptive blockers without creating an automatic scheduler. |
| Independent review/debugging | Owner-specific review repair assignments, at most six automatic repair rounds, fresh final review/security/QA/approval gates. | These repairs are driven by source/model findings, not executed project build/test logs. Unavailable infrastructure must not trigger endless paid repair loops. |
| Verification | `qaFaults` checks structure/references/JSON and parses JavaScript with `node --check`. The browser iframe checks frontend startup, overflow and selected accessibility/metadata issues. | `node --check` does not execute the source and is not a secure sandbox. Background approval can precede an owner's frontend browser check. No generated project lint/test/browser-interaction suite is executed server-side. |
| Release | Source-bound signed approval, independent vetoes, staged rollout policy and external deployment adapter. `qaFaults` explicitly blocks full-stack release without executed backend/infrastructure evidence. | The external deployment adapter is not configured in the reviewed production status. Full-stack release remains blocked. No automatic GitHub project delivery exists. |
| Workspace | Compact task bar; Chat, Files, Changes and genuine sandboxed frontend Preview; activity, architecture, code editing, history/backups, Stop/Resume, live file/section focus and polling. | Requirements and ownership were not available in a dedicated Plan view. There are no genuine server build/test logs to display yet. Preview remains frontend-only. |
| Orchestration reuse | Server `createBuildWorker` and browser `runTeam` both use existing roles/contracts and governance. | Two engines still exist and can drift. Unify incrementally after recovery contracts are covered; do not replace the production engine in one change. |

## Security boundary and approved infrastructure

Currently approved infrastructure is the existing Vercel/Nitro application, Workflow, Postgres ledger/jobs, and the browser preview. None is an approved arbitrary server-code execution environment. Workflow's deterministic orchestration sandbox is not a guest runtime for generated projects. A child process, temporary directory, `node:vm`, ordinary container, or the existing parsing checks cannot be presented as a secure execution sandbox.

Therefore no untrusted code execution is enabled. The initial Milestone C interface is deliberately incapable of enabling a provider or running a command. Its limits are **requirements to be enforced by a future isolation provider**, not protection implemented by the application process.

Before any future execution adapter is implemented/enabled, the owner must approve:

1. A reviewed isolation boundary (e.g. a hardened microVM or equivalent), provider/hosting choice and a separate infrastructure cost allowance. Existing API allowances must not be increased or treated as free compute credit.
2. External enforcement of CPU, memory, wall-time, disk, process-count and output limits. No host mounts, production secrets, production database access, persistent guest state, privileged processes or public ports.
3. Deny-all network and DNS by default, including metadata/private endpoints. Dependencies should come from a reviewed prebuilt image; runtime package-install scripts and general internet access need separate review.
4. An ephemeral workspace receiving only validated project files. No parent-process environment inheritance, project access token, API key or production connection string enters the guest.
5. Cancellation and cleanup on success, failure, timeout and control-plane loss; orphan cleanup and bounded reservations before an infrastructure-billed operation.
6. Provider-signed or authenticated execution evidence bound to the exact source hash, check definitions, toolchain image, limits and timestamps. Client/model claims cannot mint a passing execution result.

No provider has been selected, purchased or enabled. Vercel Sandbox or another isolated worker may be evaluated later; approval, resource controls and costs must be reviewed first.

## Target architecture and small milestones

Reuse the current supervisor/architect/owner/reviewer roles, saved tasks and ledger. The sequence remains: request → validated plan → architecture → exclusively owned files → isolated verification (when approved) → targeted repairs → fresh independent gates → owner review. Deployment stays separately approved.

| Milestone | Scope and evidence required | Current increment |
| --- | --- | --- |
| A — Audit/design | Source inventory, trust boundaries, cost controls, capability gaps and rollout plan. | Complete in this document. |
| B — Persistent development | Preserve the complete file being edited; distinguish blockers; preserve checkpoints; user-approved resume only. Later: unify browser/server orchestration and add a bounded persisted requirements/change ledger. | First increment implemented and tested; orchestration unification remains incomplete. |
| C — Secure execution | Validated manifest, explicit limits, artifact-bound results; approved isolation adapter and independent enforcement. | Tested disabled interface only. Real execution and infrastructure remain blocked. |
| D — Verification/debugging | Executed build/test evidence, bounded owner-targeted fixes, fresh verification after every source change, unresolved-error reporting. | Existing source-review repair loop retained. Execution-driven debugging is not implemented until C is approved. |
| E — Workspace/regression | Requirements/plan, real file changes, logs/test results, task controls and Android usability. | Plan view and pause labels added. Server logs/tests cannot be shown as run while execution is disabled. Full integration remains incomplete. |

### Future verification/repair contract

Commands proposed by a model are untrusted data, never host shell instructions. A trusted adapter selects named checks using a reviewed runtime profile. Each result must identify the artifact hash, actual command/check, exit status, timestamps, bounded output, resource failures and cleanup result. Changing source invalidates previous execution evidence. A failed check may request repairs only from the existing owner of the affected files. Retry counts persist in the job, budget denials pause once, and any new paid work still passes the shared ledger. Unknown outcomes must not replay automatically.

For the school-management example, acceptance tests must cover registration validation, unauthorized role access, administrator approval, lecturer/course boundaries and database migrations using disposable data. Static pages with pretend logins are never sufficient evidence.

## Deployment and approval

All work stays on `codex/phase2-audit-tasks`. Automatic Vercel deployment is disabled for that branch only. No merge, production deployment, secret change, paid provider, production migration, untrusted execution or paid-model test is authorized by this increment. The existing 32-character administrator credential requirement is unchanged; missing `RITUAL_ADMIN_TOKEN` keeps administrator controls locked.
