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
| **Voice out** | Press **Listen** on any answer, or turn on auto-read. Long answers are split into sentence-sized chunks, which is what stops browsers cutting them off part-way. Pause, continue and stop from a bar above the composer. |
| **Voice in** | Hold a conversation with the microphone: continuous dictation with the words appearing as you speak, so a pause for breath does not end it. Pick the accent closest to your own; if a device cannot do it, it falls back rather than failing. |
| **Grandpa's voice** | Choose from the voices your device has. The default is the closest to Liberia the device offers — West African first, then British, then whatever exists. Speed and depth are adjustable, with a test button. |
| **Share an answer** | Sends it through the phone's own share sheet — WhatsApp and the rest — or copies it where that is unavailable. |
| **Works offline-aware** | A clear banner when the network drops, your history still readable, and a **Try again** button on any message that failed. |
| **Rename conversations** | Rename in place from the sidebar, so *Planting Rice Season* can become *My rice notes*. |
| **Homework Helper** | Teaches the method and shows the working, then offers a practice question — it does not just hand over answers. |
| **Business Advisor** | Pricing, bookkeeping you can keep in a paper exercise book, and loan readiness. Shows the arithmetic so you can redo it with your own numbers. |
| **Farming Assistant** | Crop problems, planting seasons, storage. Says honestly that it has no live weather or market-price feed, and points to the extension officer. |
| **Cultural storytelling** | Proverbs, folktales and oral history — careful with sacred matters, and never inventing an attribution. |
| **Low-data mode** | A real switch, not a label: answers are capped at 120 words and 300 tokens, with no headings or tables. The whole front end is dependency-free, so nothing is pulled from a CDN. |
| **Conversation history** | Kept in the browser's `localStorage`, grouped by date, searchable, and never sent anywhere but to the model. |
| **Settings panel** | Language, model, low-data, text size, appearance, voice and your saved data, in one place behind the gear. |
| **Bigger text** | Three sizes. It moves the root font size, so the whole layout scales like browser zoom rather than only the letters — for older eyes and small phones. |
| **Answers read aloud** | Turn on *Read answers aloud* and every reply is spoken, at a speed you choose, for anyone who reads slowly. |
| **Download your conversations** | One button saves everything as a Markdown file — a student keeps their homework help, a farmer keeps the planting advice. |
| **Delete everything** | Two taps clears all history. Grandpa AI is meant to run on shared phones, so leaving is as easy as arriving. |

The assistant is told, in every conversation, not to invent local prices, school rules
or clinic hours, and not to give a diagnosis, a legal ruling or a financial guarantee —
it points to a teacher, nurse, extension officer or ministry instead.

---

## Running it

You need **Node.js 18.17 or newer** and an OpenAI API key.

```bash
npm install
npm run setup     # asks for your key and writes .env for you
npm start
```

Open <http://localhost:3000>.

`npm run setup` prompts for the key and saves it to `.env` — you never have to open
a hidden file in an editor. **Nothing appears on screen while you paste the key**;
that is deliberate, so it does not end up in your terminal scrollback. Press Enter
when you have pasted it, and the script confirms with a masked version
(`sk-proj************4f2a`). It writes the file as owner-read-only, and `.env` is
already in `.gitignore`, so the key is not committed.

Run it again any time to replace the key — your other settings are kept.

<details>
<summary>Prefer to do it by hand?</summary>

```bash
cp .env.example .env
```

Then open `.env` in any text editor and replace `sk-your-key-here` on the
`OPENAI_API_KEY=` line with your key. The line should end up looking like
`OPENAI_API_KEY=sk-proj-abc123...` — no quotes, no spaces around the `=`.

</details>

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
| `ACCESS_CODE` | *(blank)* | When set, visitors must enter this code before they can chat. Leave blank locally; set it on any public address. |

The model picker in the header offers GPT-4o mini, GPT-4o, GPT-4.1 mini and GPT-4.1.
Your account still needs access to whichever one you pick; if it does not, the app
says so in plain words rather than failing silently.

---

## Putting it online

The app reads its key from the environment, so it deploys without a code change.
A [Render](https://render.com) blueprint is included — connect the repo and Render
fills in the build and start commands from `render.yaml`, then asks you for the two
secrets.

1. **New** → **Web Service**, connect this repository
2. Render reads `render.yaml`; confirm the free plan
3. It prompts for `OPENAI_API_KEY` — paste your key
4. It prompts for `ACCESS_CODE` — choose a word to share with your users
5. Deploy. You get a public `…onrender.com` address

Railway and Fly.io work the same way: build with `npm install`, start with
`npm start`, and set the same environment variables in their dashboard.

### Set ACCESS_CODE on anything public

A public URL spends real money — every message is billed to the key you configured,
and the per-IP rate limit only slows a stranger down, it does not stop them. With
`ACCESS_CODE` set, visitors see a code prompt before they can chat; the code is
compared in constant time and never sent to the browser.

It is a spending gate, not a login: everyone shares one code, and there are no
accounts. Also set a monthly spend limit in the OpenAI dashboard as a backstop.

The free Render tier sleeps when idle, so the first visit after a quiet spell takes
about a minute to wake.

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
  app.js        State, streaming, history, settings, sharing
  speech.js     Text-to-speech chunking, voice ranking, dictation locales
  markdown.js   Small Markdown renderer (escapes first, then adds markup)
  storage.js    localStorage for conversations and preferences
render.yaml     Deploy blueprint — secrets are prompted for, never committed
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
- **Speech (unit)** — 26 assertions: markdown stripped before speaking, long answers
  chunked under the cutoff limit, over-long single sentences broken at commas,
  nothing lost or emptied, and voice ranking (accent first, quality as a tiebreaker,
  non-English excluded, sane fallbacks).
- **Voice and sharing (Playwright)** — 37 checks against a stubbed speech engine:
  the voice picker built from the device's real voices, the West African default,
  a long answer queued as several chunks and read to its final sentence, pause /
  continue / stop, a new question silencing the old answer, auto-read, Web Share
  with a copy fallback, the offline banner, and rename with Escape to cancel.
- **Settings (Playwright)** — 33 checks: opening and closing three ways, text size
  moving the root size and surviving reload, the three-way theme, low-data staying
  in step between the pill and the switch, language syncing both ways, the spoken
  speed label, conversation counts, the download's name and contents, two-tap
  delete, and the mobile sheet without horizontal overflow.
- **Access gate** — 17 checks: requests refused with no code, a wrong code and a
  wrong code of the same length; accepted with the right one; `/api/title` gated
  too; the code absent from `/api/config`; and the browser flow through prompt,
  rejection, entry and reload.

---

## Not built yet

Named honestly, because the dossier lists them and this app does not do them:

- **SMS / USSD fallback** for feature phones — needs a telecom aggregator.
- **Offline caching** of recent answers — history persists and the app tells you it is
  offline, but answering still needs a network.
- **The community knowledge feed** — crowd-sourced local knowledge with moderators.
- **Trained indigenous-language models** — Kpelle, Vai and Bassa are declared as
  roadmap in the UI rather than approximated.
- **Accounts and server-side history** — conversations live in the browser only.

---

Tolbert Innovation Hub · Monrovia, Liberia · [tolbertinnovationhub.org](https://tolbertinnovationhub.org)
