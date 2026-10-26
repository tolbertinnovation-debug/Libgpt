# Spending controls

Every feature that calls OpenAI — chat and reasoning, research, documents and business plans, the Library, pictures, speech, transcription, Live Talk and the Build engineering team — reserves its cost in one persistent ledger before the call and settles it afterwards. The ledger is the existing Build governance store: Postgres on Vercel (shared by every serverless instance and every restart), or a local directory on a single server.

## Approved Phase 1 policy

| Limit | Value |
| --- | --- |
| Total daily spending | $0.50 |
| Build (coding agents), inside the total | $0.20 |
| Pictures, inside the total | $0.10 |
| Speech and transcription, inside the total | $0.15 |
| Live Talk, inside the total | $0.10 (and Live Talk is off unless enabled) |
| Model calls at the same time, across all features | 2 |
| Calls per minute, across all features | 20 |

Chat, research, documents and the Library share what remains of the total. Days run on UTC; allowances reset at midnight UTC. Research still running across midnight carries its full reservation into the new day before more work is admitted.

The policy (`BUDGET_POLICY` in `server/agent-costs.js`) is a ceiling. The first time a ledger sees it, stored limits are lowered to it — never raised — and an audit record `budget-policy-applied` is written. Environment variables such as `RITUAL_DAILY_USD` only seed a brand-new ledger and are capped by the policy. Nothing in the app raises a limit by itself.

## How a call is charged

1. **Admission.** The ledger refuses the call if the operator has paused paid features, two calls are already running, 20 calls ran in the last minute, or the reservation would exceed the total or the feature's allowance.
2. **Reservation.** Text calls reserve their input (UTF-8 bytes, at least one token each) plus their maximum output, at the model's verified price. Photos and PDFs are estimated (3,000 tokens per image; a share of a PDF's size) instead of being counted as base64 text. Pictures, speech, transcription and live sessions reserve a fixed upper bound. Research atomically reserves up to two tool calls plus a conservative token bound for the initial model pass and every permitted tool continuation. It uses the documented 128k search context (rounded up to 131,072), additional 8k search-content blocks, and the maximum output tokens, rather than assuming retrieved pages average 8,000 tokens.
3. **Settlement.** When OpenAI reports usage (chat, documents, Library, research, Build), the reservation is replaced by the real cost. Research adds the conservative $0.025 fee for each search in the completed response's authoritative tool list. Missing tool summaries retain all reserved search fees; missing or invalid usage, interrupted streams and network failures retain the entire reservation. A duplicate streamed/final tool event is counted once. A request OpenAI refused outright (400, 401, 403, 404, 409, 413, 415, 422, 429 before any output) is charged $0, because OpenAI does not bill it. An ordinary text stream stopped early is charged an upper bound of what it used; stopped research retains its full reservation. When no usage is available, the reservation is kept.
4. **No automatic paid retries.** Every paid call makes one attempt. Retries happen only for request-format refusals that OpenAI does not bill (an unsupported parameter, a tool name, a model fallback for transcription). Each research format retry refunds the rejected attempt and obtains a new atomic reservation before HTTP. It cannot reuse an old admission if another request spent the balance or the operator paused the app.

Research requests always send `max_tool_calls` (at most two), `parallel_tool_calls: false`, a bounded `max_output_tokens`, and low search context. Format compatibility may change the tool spelling or choice, but never removes those spending bounds. A provider that rejects `max_tool_calls` is refused rather than called without it. Budget-control failures stop gracefully without automatically starting a paid fallback answer. Unexpected provider work beyond these limits is audited and atomically pauses new paid work; real reported costs are never clipped to make the ledger look safe.

A call made outside a governed route is refused (`GOVERNANCE_UNGOVERNED`) before it reaches OpenAI.

## What visitors see

When a limit says no, the feature returns a friendly message instead of a technical error, for example: "Grandpa AI has reached today's spending cap, so features that use the AI service are paused until midnight UTC. Your saved chats, journal and downloads still work." Feature allowances name the feature ("Today's picture spending cap…"). When the ledger itself cannot be reached, paid features pause rather than run unmetered.

## Models

Automatic choices and the model picker offer only approved models with verified prices: `gpt-5.4-mini`, `gpt-5.4-nano`, `gpt-4.1-mini` and `gpt-4o-mini` by default. Build uses the same list. Research uses the strongest approved model on its search-capable list (currently `gpt-4.1-mini`). The operator can change the lists with `APP_MODELS` and `RITUAL_AGENT_MODELS`; a listed model without a verified price in `server/agent-costs.js` is ignored. Stronger models such as `gpt-6.1-sol` ($2/$10 per million tokens) are not used unless the operator adds them.

Pictures default to balanced (medium) quality. A medium picture fits the picture allowance; a high-detail one does not under the current limits.

## Operator controls

All require `RITUAL_ADMIN_TOKEN` (32+ characters) in the `x-ritual-admin` header; the visitor access code never works here.

- `GET /api/admin/budget` — limits, today's spend in total and per feature, active calls.
- `POST /api/admin/budget` with `{"limits":{"capabilityDailyUsd":{"images":0.05}}}` — patch only these limits (audited). Omitted allowances and other limits are preserved. An empty allowance object does nothing; an explicit zero disables spending for that capability. Independent administrator updates are serialized against the latest ledger state.
- `POST /api/build/control` with `{"action":"pause"}` or `{"action":"resume"}` — emergency stop for every paid feature.
- `GET /api/build/audit` — the hash-chained audit trail (metadata only; no prompts or answers).

`RITUAL_BUDGET_POLICY=off` makes a ledger keep its stored limits instead of applying the policy ceiling. It exists for the test suite and for an operator who deliberately manages limits through the admin route.

## Limits of this protection

- **Not a provider billing cap.** The ledger controls what Grandpa AI asks OpenAI to do. It cannot stop spending made with the same API key elsewhere, and it is not a substitute for a usage limit set in the OpenAI dashboard. Setting a monthly budget alert there is recommended.
- **Estimates.** Text, search-fee and image prices are verified from OpenAI's pricing page (26 October 2026). Speech (30 µ$ per character), transcription (the higher published per-minute estimate) and Live Talk (per-minute worst case) are conservative estimates because OpenAI reports no usage for them to this server. Picture costs for the default `gpt-image-2.5-flare` model are reserved at 1.5× the published GPT Image 2 table and are not settled lower.
- **Live Talk** is metered at its worst case when the session starts; its real usage is reported only to the browser, and the session length is enforced by the browser. It is therefore off by default.
- **Ledger outages** pause paid features. On a serverless host without a database, all paid features stay paused.
- **Over-counting is deliberate.** Cached input is charged at the full input rate and expired leases keep their reservation, so the ledger errs towards stopping early.
