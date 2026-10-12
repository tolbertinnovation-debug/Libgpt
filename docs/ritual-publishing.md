# Staged website releases

Every Ritual Coding release must pass independent review, security, QA and approval, then staging and gradual rollout. See [Ritual Coding guardrails](ritual-guardrails.md) for the precise role permissions, operator configuration, API contract, audit behavior, budgets and pause commands.

Direct GitHub Pages publication is disabled because it cannot split production traffic into gradual rollout steps. GitHub repository reading and source downloads remain available. Old deployment status records can be checked for recovery, but cannot authorize a new direct release.

The operator must provide shared persistent governance storage, an approved model/cost policy, a separate administrator credential and a trusted HTTPS deployment adapter. Vercel engineering agents use a connected Upstash Redis store; ordinary Node hosts can use a shared persistent volume. Connect the store to the correct Vercel environment and redeploy before agent work can resume. See the guardrails document for credential and namespace configuration.

In Build, open Agent guardrails to inspect status, budget, rate/concurrency limits and audit metadata, or pause/resume as an authorized operator. Publish website first checks whether the required release infrastructure is configured. Unavailable infrastructure is a blocker, never a model-generated claim of successful deployment.

Configured releases upload the exact approved artifact to isolated staging. The adapter must verify tests and a healthy rollback baseline, then observe each rollout at 5%, 25%, 50% and 100% for at least thirty seconds. Every step must confirm the same artifact and baseline. Failed or uncertain promotion attempts stop further promotion and request restoration of the verified baseline. An unverified restoration requires operator attention.

Automatic approved updates remain opt-in per project. They use the same staging and rollout gates; they cannot reuse approval after file changes or consume a staging result twice. Backend/database/cloud releases remain blocked until their actual execution and hosting environments are verified.

The supplied adapter interface is an integration contract, not a bundled hosting service. It must enforce project isolation, monotonic steps, idempotency and deployment lineage, and continue independent monitoring when the app request ends or crashes. App source checks do not certify every visitor interaction or third-party service.
