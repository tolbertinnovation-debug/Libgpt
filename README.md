# Grandpa AI

**African-centred conversational AI — powered by Tolbert Innovation Hub, Monrovia, Liberia.**

> *"Empowering Africa's Future — One Conversation at a Time"*

A chat application in the shape of the Grandpa AI platform described in the project
dossier: a village-elder assistant that answers in Liberian English, by typing or by
voice, and works on a 2G connection. The model behind it is OpenAI's ChatGPT API.

---

## What it does

| Feature | How it works here |
| --- | --- |
| **Multilingual chatbot** | Liberian English vernacular by default, standard English alongside it. Kpelle, Vai and Bassa appear in the picker as roadmap languages — the assistant says plainly that they are still being built rather than faking them. |
| **Voice in / voice out** | Speak your question with the microphone button (Web Speech API); press **Listen** on any answer to hear it read back, at a slower rate and lower pitch. |
| **Homework Helper** | Teaches the method and shows the working, then offers a practice question — it does not just hand over answers. |
| **Business Advisor** | Pricing, bookkeeping you can keep in a paper exercise book, and loan readiness. Shows the arithmetic so you can redo it with your own numbers. |
| **Farming Assistant** | Crop problems, planting seasons, storage. Says honestly that it has no live weather or market-price feed, and points to the extension officer. |
| **Cultural storytelling** | Proverbs, folktales and oral history — careful with sacred matters, and never inventing an attribution. |
| **Low-data mode** | A real switch, not a label: answers are capped at 120 words and 300 tokens, with no headings or tables. The whole front end is dependency-free, so nothing is pulled from a CDN. |
| **Conversation history** | Kept in the browser's `localStorage`, grouped by date, searchable, and never sent anywhere but to the model. |

The assistant is told, in every conversation, not to invent local prices, school rules
or clinic hours, and not to give a diagnosis, a legal ruling or a financial guarantee —
it points to a teacher, nurse, extension officer or ministry instead.

---

## Running it

You need **Node.js 18.17 or newer** and an OpenAI API key.

```bash
npm install
cp .env.example .env      # then put your key in .env
npm start
```

Open <http://localhost:3000>.

Without a key the app still loads and explains what is missing — it just cannot answer.

### Configuration

All of it is in `.env` (see `.env.example`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | — | Required. Your key from <https://platform.openai.com/api-keys>. |
| `OPENAI_MODEL` | `gpt-4o-mini` | Model used for replies. |
| `OPENAI_TITLE_MODEL` | `gpt-4o-mini` | Cheaper model used only to name conversations. |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Point at a compatible gateway if you use one. |
| `PORT` | `3000` | Port to listen on. |
| `RATE_LIMIT_PER_MINUTE` | `30` | Requests allowed per IP per minute. `0` disables the limit. |

The model picker in the header offers GPT-4o mini, GPT-4o, GPT-4.1 mini and GPT-4.1.
Your account still needs access to whichever one you pick; if it does not, the app
says so in plain words rather than failing silently.

---

## How it is put together

```
server/
  index.js      Express app — static files, SSE chat endpoint, rate limit, validation
  openai.js     OpenAI client: streaming parser, one-shot completions, error translation
  personas.js   The system prompts — persona x language x low-data
  config.js     Environment and the model allowlist
public/
  index.html    One page
  styles.css    Brand palette, light and dark, mobile-first breakpoints
  app.js        State, streaming, voice, history
  markdown.js   Small Markdown renderer (escapes first, then adds markup)
  storage.js    localStorage for conversations and preferences
```

**The API key never reaches the browser.** The page talks only to this server, which
holds the key and streams the reply back over Server-Sent Events.

**The browser cannot change the persona prompt.** `/api/chat` accepts only `user` and
`assistant` turns and drops anything else, so a crafted request cannot install its own
system prompt. The persona, language and low-data dials are ids that select a prompt
written on the server.

**Markdown is escaped before any markup is produced**, so model output cannot inject
HTML — which is also why there is no `marked` + `DOMPurify` on a CDN to download.

**Stopping actually stops.** Pressing Stop aborts the browser's request, and the server
aborts its upstream OpenAI call on disconnect, so you are not billed for tokens nobody
will read.

---

## Testing

The behaviour was checked against a mock OpenAI endpoint and in a real browser:

- **Markdown renderer** — 10 assertions covering XSS escaping (`<script>`, `onerror`,
  `javascript:` links), emphasis, code spans, tables, lists, and half-streamed fences.
- **Server** — streaming, upstream 404 and missing-key errors surfacing as readable
  messages, empty-message rejection, system-role stripping, and the title endpoint.
- **Browser (Playwright)** — 34 checks: streaming display, Stop/Send swapping,
  regenerate, code copy, conversation naming, history, search, delete, dark mode,
  reload persistence, and mobile layout with no horizontal overflow.

---

## Not built yet

Named honestly, because the dossier lists them and this app does not do them:

- **SMS / USSD fallback** for feature phones — needs a telecom aggregator.
- **Offline caching** of recent answers — history persists, but answering needs network.
- **The community knowledge feed** — crowd-sourced local knowledge with moderators.
- **Trained indigenous-language models** — Kpelle, Vai and Bassa are declared as
  roadmap in the UI rather than approximated.
- **Accounts and server-side history** — conversations live in the browser only.

---

Tolbert Innovation Hub · Monrovia, Liberia · [tolbertinnovationhub.org](https://tolbertinnovationhub.org)
