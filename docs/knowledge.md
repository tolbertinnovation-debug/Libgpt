# Knowledge and generation

Grandpa AI can help with subjects from around the world, including education,
science, technology, history, business, writing and coding. Its Liberian voice
and identity do not restrict which subjects it can explain. No model has
unlimited knowledge: the app distinguishes existing knowledge from live research
and acknowledges uncertainty.

## Settings

- **Answer depth:** Match my question, Detailed, or Thorough. Thorough requests
  more explanation and selects a deeper model when the account supports one.
- **Web research:** When needed, Research factual questions, or Off. Automatic
  research covers current information, referenced URLs, applications, technical
  documentation and other facts that need verification. Explicitly tapping the
  search button overrides Off for that turn.
- Creative stories and proverbs are generated without automatic web search so
  repeated requests can produce fresh work. Explicit requests to search still
  take priority.

Research uses OpenAI's Responses API and the account's available search-capable
models. `ENABLE_LIVE_NEWS=true` enables it; `OPENAI_SEARCH_MODEL` optionally pins a
model. There is no extra search provider or key. Search can accompany a photo or
a build. Source links appear below the answer. If research fails or the account
has no supported model, a notice explains that current details were not checked.

## Longer work

- Conversation input retains up to 160 complete messages within a 120,000-character
  window. Old turns are removed whole, with a notice, rather than cutting the
  latest question. Questions over 64,000 characters are explicitly refused with
  instructions to split them into parts.
- Attached document excerpts can contain up to 50,000 characters. The attachment
  UI explains when an excerpt is shortened.
- Written answers have up to 8,192 output tokens per part; Thorough answers and
  builds have up to 12,000. Spoken parts have up to 1,600. Older chat models receive
  smaller budgets. These are ceilings, not required answer lengths.
- Incomplete answers automatically continue within a bounded request. If they
  still need more room or the stream fails after text arrives, the partial answer
  is saved with **Continue unfinished answer**, including after reopening a chat.
  Automatic continuations reuse the research already collected.
- Story generation and continuation have 4,000 output tokens; names 2,000;
  recipes 3,000; quizzes 1,500. Existing validation and fresh-story checks remain.
- Vercel's function duration is configured to 300 seconds. The app stops a chat
  request at 270 seconds and sends a clear ending first. `TURN_DEADLINE_MS` can
  lower that deadline for another host. Heartbeats keep active streams responsive.

Provider context limits, account permissions, API credits, rate limits and hosting
limits still apply. Longer answers and web research can use more API credits.

## Verification

`npm test` includes mocked-provider integration coverage for long questions,
photo research, build research, source preservation, search preferences, graceful
fallback, continuation and timeout handling. Tests do not call paid services.
