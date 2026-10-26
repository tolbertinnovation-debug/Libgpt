# Phase 1 governance fixes — review report

Base: `e0a9ef2581e6b224b0dcf4c4cdc2ca1d79dc7677` (PR #62).
Development branch: `codex/governance-budget-fixes`.
Scope: the two approved budget issues only. Phase 2 is not started.

## Result

The approved policy is unchanged: **$0.50 per UTC day across the platform, $0.20 for Coding inside that total, and two concurrent paid calls**. No administrator credential, database migration, environment variable, production setting, merge or deployment is part of this work. All provider tests use local mocks and fake credentials; no OpenAI credit is spent.

### 1. Partial budget configuration

`normalizeLimits()` patches capability allowances instead of replacing their map. For example, changing pictures to $0.05 preserves coding at $0.20, voice at $0.15 and Live Talk at $0.10, plus every unrelated limit. Empty objects preserve values; zero explicitly disables an allowance. Invalid entries reject the complete change. Existing transaction and filesystem locks ensure each concurrent administrator reads and patches the latest state, preventing lost updates.

### 2. Research spending

- **Reserve before work:** an atomic ledger admission prefunds every permitted hosted search and a conservative upper token bound. Hosted tool operations execute inside the provider, so they are bounded in the API request itself, not merely counted after billing.
- **Provider limits:** at most two built-in tool calls, no parallel tool calls, bounded output, and low search context. Compatibility handling never removes the search/output limits. Unsupported safety parameters fail closed.
- **Retries:** generic request adaptation is disabled for research. Only definite pre-generation format refusals can select a compatible tool spelling or choice. Every such retry releases the rejected reservation at zero and obtains a fresh reservation before another HTTP request. Network and stream errors are never automatically retried.
- **Parallel work:** reservations and concurrency slots use the same locked ledger as chat, coding, documents, images and voice. Competing requests cannot spend the same remaining balance.
- **Reconciliation:** validated completed usage and the authoritative final tool list free unused capacity. Duplicate events do not double-charge. Unknown usage, interrupted streams or ambiguous network outcomes retain the upper bound; incomplete tool accounting retains all search fees.
- **Midnight:** outstanding research reservations carry into the next UTC day before new spending is admitted.
- **Provider violations:** a third tool event stops the stream. Unexpected work or reported cost beyond the reservation atomically pauses paid work and adds audit metadata. Actual reported costs are recorded honestly, never clipped or erased.
- **Visitor experience:** budget-control denials retain their existing friendly spending-limit messages and do not trigger another paid fallback answer. Non-budget search failures retain the existing fallback behavior.

## Files

| File | Change |
| --- | --- |
| `server/agent-governance.js` | Patch allowances under existing locks; research rollover and atomic overrun quarantine. |
| `server/agent-costs.js` | Conservative bounded research reservation and rejection of negative reported token usage. |
| `server/agent-runtime.js` | Per-attempt admissions, safe refunds/reconciliation and fail-closed search accounting. |
| `server/openai.js` | Enforce provider limits on every research attempt; deduplicate and reconcile search events. |
| `server/app.js` | Stop on governance denial instead of starting another paid fallback. |
| `tests/governance-budget-regressions.test.mjs` | Partial/empty/zero/invalid and concurrent updates; Coding cap preservation; rollover. |
| `tests/research-governance.test.mjs` | Research budget, concurrency, retries, reconciliation, cancellation and provider-limit regressions. |
| `tests/governance-postgres.test.mjs` | Embedded Postgres transaction tests across separate governance instances. |
| `tests/budget-routes.test.mjs` | Actual concurrent HTTP routes against a held mock provider; no paid fallback on denial. |
| `tests/openai-failure.test.mjs` | Resolve the new pricing import in the existing isolated diagnostic fixture. |
| `docs/budget-controls.md` | Updated accounting and administrator patch semantics. |
| `docs/governance-budget-fixes-review.md` | This report. |
| `vercel.json` | Disable automatic deployment for this development branch only. |

## Validation

- `npm test`: **400 passed, 0 failed, 0 skipped**, including all 375 original tests and 25 added tests.
- `npm run build`: Nitro production bundle succeeds locally.
- `git diff --check`: clean.
- Concurrent administrator updates are tested through independent filesystem-backed and Postgres-backed governance objects. Postgres tests use PGlite with the real adapter SQL and serialized transactions; they do not change or load-test the production Neon database.
- Real local Express HTTP requests run concurrently against a held fake research provider. Only two reach it; the next is denied before provider work or an ordinary paid fallback.
- No external paid calls or production-control tests are used.

## Remaining risks and release requirements

1. Reservations are deliberately conservative. Research can stop earlier than actual usage alone would require, particularly with expensive operator-selected models. Successful trustworthy usage frees capacity; uncertain failures do not.
2. Hosted-tool limits, the documented 128k search-context bound and configured prices must remain valid at the provider. No client can undo billing if a provider violates its contract. Such a violation records honest costs and pauses new work; it does not silently increase the $0.50 policy. Maintain prices and limits when provider behavior changes.
3. These controls cover this app's requests, not use of the same provider key elsewhere.
4. The administrator token was absent during the Phase 1 review. This PR does not configure it. Production audit access and recovery from an automatic safety pause require a separately approved administrator setup.
5. The production audit chain and real-provider generation have not been tested in this change. The owner must approve any later deployment and production verification.
6. `git.deploymentEnabled` is false only for `codex/governance-budget-fixes` to prevent an automatic preview during review. Other branches and production settings are not changed. Do not deploy or merge this PR without the owner's approval.

## Provider references checked

- https://developers.openai.com/api/reference/python/resources/responses/methods/create (`max_tool_calls`, `max_output_tokens`).
- https://developers.openai.com/api/docs/guides/tools-web-search (128k Responses web-search context).
- https://developers.openai.com/api/docs/pricing (8,000-token mini-model search-content blocks).
- https://vercel.com/docs/project-configuration/git-configuration (`git.deploymentEnabled`).
