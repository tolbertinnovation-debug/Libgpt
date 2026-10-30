# Chat Phase 2: thinking, long-chat summaries and the quality set

## 1. Real thinking for hard questions
- `thinkingFor()` (`server/models.js`) chooses how hard the model thinks before
  answering, using the API's `reasoning_effort` setting.
  - **medium** when the person taps Think.
  - **low** when the question needs working out: money, loans, profit, maths,
    planning, comparing, "how many … do I need".
  - **Nothing extra** for greetings, stories, proverbs, translation, photos and
    voice. These are not improved by thinking.
- The word list that picks a thinking level is separate from the one that picks
  the model. A story still gets the deep model, but no thinking it does not need.
- Anything the words miss, Grandpa can decide himself. A new `think_carefully`
  tool lets him ask to think first, and the turn then runs again at medium
  effort with no tools.
- While he thinks, the chat shows "Thinking it through…".
- Temperature is never sent alongside thinking, because reasoning models refuse
  the two together.
- **Cost:** thinking is billed as written words, about 1–2 cents for a hard
  question. It counts against the Chat limit set on Owner Controls.

## 2. Long chats that never forget
- What is sent with each question holds the newest messages and a few recalled
  older ones (`conversationWindow`).
- When a chat grows past that, the browser asks `/api/summary` for a short
  running summary of the older part. The small nano model writes it.
- The summary is kept with the chat and sent as background with each question,
  below the instructions. The newest messages and corrections take precedence.
- It is refreshed after every 20 more messages.
- The first summary always includes the very start of the chat, where names and
  facts usually are. Messages are shortened rather than dropped.
- A chat that still fits is never summarised, so it costs nothing extra.
- **Cost:** about 0.1–0.2 cents each time it summarises, counted against the
  Chat limit.

## 3. The quality test set
- `tests/quality/scenarios.json` holds 60 fixed questions in the ways people
  really ask them. They cover:
  - Liberian English greetings, school, farming and money;
  - pictures and documents;
  - web research and memory;
  - culture, language, unclear requests, health and voice.
- `tests/quality.test.mjs` runs them on every update, with a fake OpenAI so it
  is free. It checks:
  - **Before any paid call:** whether each question becomes a picture, a
    document or chat, and the picture's conversation context.
  - **The model choice:** the model tier and the thinking level.
  - **Through the real `/api/chat` route:** web research, the tools offered,
    `reasoning_effort` and no temperature with it, the instruction rules
    (picture tool, language, clarifying question), and follow-up questions on
    written replies only.
- `scripts/quality-live.mjs` runs the chat questions against the real model. It
  costs about $0.15 per run and refuses to run without `--confirm-spend`. Run it
  only when the owner approves.
