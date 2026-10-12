> Current release policy: see [Ritual Coding guardrails](ritual-guardrails.md). Direct GitHub Pages publication described below is disabled; verified staging and gradual rollout are now mandatory. Agent work on serverless hosts is blocked until shared durable governance is implemented.

# Ritual Coding engineering team

A new Build turns one website brief into a shared plan, architecture decisions and complete project files. The Head of Engineering orchestrates assignments and tracks progress. The Architect records decisions, constraints, test plans and deployment requirements before building starts.

Six builders own distinct files: design and assets, frontend pages, interactions, content and materials, backend, and data/cloud. Builders queue within four simultaneous provider calls. Backend and interaction files are generated one at a time; other builders use batches of up to two. An incomplete batch receives one targeted retry for each unfinished file, keeping its completed neighbours. Access, spending, rate and governance denials do not receive this retry. Each generation has a 16,000-token output ceiling, subject to the operator’s existing hard limits. Backend and cloud work may be unnecessary for a static website. These roles use separate provider calls with explicit responsibilities, not just progress labels.

The independent Reviewer does not author the changes it checks. Security has release veto power. QA/DevOps validates files and deployment readiness. The Release Approver only approves when review, security and QA all pass. No builder, orchestrator, user-supplied comment or direct single-file push can override these gates. Provider errors and malformed decisions block approval.

Every completed file is saved immediately on the current device using IndexedDB, with localStorage as a compatibility fallback. Storage errors prevent approval and offer downloads. Stop cancels requests while retaining completed work; Resume skips completed assignments and repeats current checks. Reloaded unfinished projects retain recovery controls. Backups retain plans and architecture notes, but never restore release authority. Download All files for the complete ZIP; the single-page export only contains the home page. Architecture decisions can be downloaded separately as ARCHITECTURE.md.

Each HTML page receives sandbox startup checks at phone and desktop sizes for errors, overflow, resources, metadata, labels and local references. The source reviewer checks the brief and latest change. Up to six repair rounds per run (with an absolute configurable ceiling of eight) return defects to their original owners and repeat checks. The server then performs independent review, security checks, parse-only JavaScript validation, structural QA and a separate approver decision. A signed approval binds the exact complete artifact and expires after fifteen minutes. Any file change requires fresh approval.

The generated source is treated as untrusted data and is never executed on Grandpa AI's server. Static websites can be released only through a configured adapter that verifies staging and gradual rollout. Direct GitHub Pages production publishing is disabled. Backend/API/database/cloud source can be prepared and downloaded, but releases are blocked until real hosting, credentials and runtime tests are available. Generating source does not provision infrastructure or verify external integrations. Startup checks do not prove every button, form or business flow works.

Plans support up to twelve HTML pages, twelve files per builder and seventy-two assigned files overall. Source review, provider, access and rate limits remain explicit. Oversized or incomplete projects remain unapproved. Existing four-builder checkpoints remain compatible.

Planning, architecture, building, checks and publishing show loading states. Failures stop the spinner and retain reachable diagnostics and recovery actions. The original cream, brown, orange and red app palette is unchanged.

Validation includes parallel execution, ownership, save ordering, cancellation, bounded repairs, interrupted runs, backup recovery, false approval rejection, security veto, signed artifact checks and safe deployment rollback. Browser tests use real Express routes and Chromium with mocked provider and GitHub responses; they verify application behavior rather than live model quality.

