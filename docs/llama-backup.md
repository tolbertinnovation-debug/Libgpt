# Meta Model API (Muse) as Grandpa's brain

Grandpa talks to Meta's Model API at `https://api.meta.ai/v1`, using the same
chat-completions format as OpenAI. Details were checked on 2026-10-31 at
dev.meta.ai/docs.
- **Everyday chat:** `muse-spark-1.3`, at $1.25 per million tokens in and
  $4.25 out.
- **Questions that need careful thinking:** `muse-wonder-1.0`, at $4 in and
  $20 out.
- **Key:** `META_API_KEY`, `MODEL_API_KEY` or the older `LLAMA_API_KEY`.
- **Optional overrides:** `META_BASE_URL`, `META_MODEL` and `META_DEEP_MODEL`.
- **Request settings:** requests send `max_completion_tokens` and no
  temperature, because Spark does best at its default.
- **Costs:** the ledger charges $1.50/$5 for Spark and $5/$25 for Wonder and
  any unknown model, above Meta's own prices.

# Meta Llama: all text chat (for now), everyday chat, or backup

## Pictures, photos and voice typing on Meta
While OpenAI isn't available (`metaMedia()` in `server/app.js`), these three
run on Meta. Formats were verified at dev.meta.ai/docs.
- **Pictures:** `muse-image-1.0` through `POST /v1/images/generations`, which
  returns `b64_json` as a JPEG data URL. Each picture reserves $0.012 from the
  Pictures limit (Meta charges $0.01).
- **Photos:** Muse Spark reads photos sent in chat as `image_url` parts. PDF
  pages are still not sent.
- **Voice typing:** `muse-voice-transcribe-1.0` through
  `POST /v1/asr/transcribe`, multipart with a `request` JSON part and an
  `audio` WAV part.
  - It needs mono 16-bit PCM WAV, so `public/wav.js` converts the phone's
    recording to 16 kHz first. The site asks for this with
    `dictationFormat: 'wav'`.
  - Liberian place and food names are sent as keywords.
  - It reserves $0.216 an hour from the Voice limit (Meta charges $0.18).

## Everything on Meta while OpenAI is off

`server/openai.js` hands its work to Meta whenever OpenAI is switched off and a Meta key is set
(`metaBridge()` / `forMeta()`). That covers every feature that used OpenAI's chat format: Build and
its engineering team, documents, Library stories and wisdom, plans, reviews, titles and summaries.
Models: Muse Spark, or Muse Wonder when the request asks for careful thinking (`reasoning_effort`).
`max_tokens` becomes `max_completion_tokens`, and PDF page parts are left out. Pictures from
`/api/picture` and `/api/album` use Muse Image.

In chat, Grandpa's tools (draw a picture, write a document, offer a memory, think carefully) are
offered to Muse Spark in the same format. If Meta turns the tools down, he answers without them.

Each feature keeps its own owner-set limit (Build, Documents, Library, Pictures, ...). Chat stays
on the Meta Llama limit.

Grandpa's voice stays on OpenAI (owner's choice): reading aloud, the advanced voice, Live Talk and
listening (voice typing) use `config.voiceKey`, which is the OpenAI key even while OpenAI is off.
Nothing else can use it. `OPENAI_VOICE=off` turns the voice off too, and then listening goes to
Meta's Muse Voice Transcribe and the phone's own voice reads aloud.

Live research runs on Meta too, with Grandpa's own free research (`server/research.js`, below).

## Research on Meta (free sources, no key)

OpenAI's web tool is not available on Meta, so the server does the looking up itself and hands Meta
numbered notes:

- **When:** the question plainly needs fresh facts (`needsLookingUp` in `server/search.js`: news, "today",
  prices, rates, laws, a date this year…), the person asked for research, or Meta asks for it by calling
  `search_web` while answering.
- **Sources** (no key, no account, no cost): the news feeds of FrontPage Africa and The New Dawn (Liberian
  papers first), BBC News Africa, GDELT's worldwide news search, Wikipedia, and ExchangeRate-API for today's
  dollar rates. The best 3 matching stories (5 for thorough answers) are read in full; a link the person
  pasted is read first.
- **Questions with parts** ("rice prices in Monrovia and how to store rice") are split by `subQuestions()` and each
  part is searched on its own, at the same time; a short follow-on part ("What are the costs?") keeps the topic.
  Each story is listed once, under the part it matches best. Large questions (and "thorough") read more: up to 6
  stories in full.
- **Dated and checked:** every note says how old it is ("today", "5 days old", "3 months old"; Wikipedia is marked
  as a reference article). Meta is told to answer every part, say where sources agree, give both sides where they
  differ (never averaging numbers), prefer the newest, and end a big answer with what is still not clear.
- **Speed:** about 4–6 seconds. Every source has its own time limit and anything slow or busy is left out.
  Feeds and pages are kept for 10 minutes, so the next question does not fetch them again.
- **Safety:** only public `https` addresses are read (no raw IPs, local names, odd ports, or hosts that
  resolve to private or cloud-metadata addresses). Pages are cut to plain text and size-capped, and the notes
  tell Meta they are data, never instructions.
- **The answer** cites the notes as [1], [2]… with the paper and date, says where sources disagree, and says
  plainly when the search found nothing. The sources appear under the answer ("Where this was read").

## Pacing: quick answers, a proper think on large tasks

Muse models always reason before answering, so `metaPlan()` in `server/llama.js` decides how long:

Each request is sized from its words by `taskSize()`: **small** (one short, simple ask), **large** (over 320
characters, four or more lines, three or more questions or list items, or big work by name: "business plan",
"complete", "step by step", "compare", "report"…) or **normal**.

| The question | Model | Thinking |
| --- | --- | --- |
| A greeting, a small simple question ("What do goats eat?"), anything spoken | Muse Spark | minimal |
| An ordinary question | Muse Spark | low |
| One that needs reasoning (money, sums, a choice), or a short ask with a big word ("tell me a story") | Muse Spark | medium |
| A large task (a long request, a plan, a report, "thorough") | Muse Spark | high |
| The person tapped **Think** | Muse Wonder | medium |
| A new Build, a Build stage, or a big change (a new page, a login, a redesign) | Muse Spark | high |
| A normal change to an existing Build | Muse Spark | medium |
| A small change to an existing Build ("make the header green") | Muse Spark | low |

Whenever the thinking is medium or more, the chat shows "Thinking it through…" until the first words arrive.

## OpenAI switched off (for now)
At the owner's request, OpenAI is off on the live host. `config.openaiOff`
defaults to on wherever `VERCEL` is set, and `OPENAI_OFF=false` switches
OpenAI back on. While it is off:
- the server holds no OpenAI key, so every OpenAI feature turns itself off;
- any request to OpenAI is refused before it is sent;
- chat, chat titles and long-chat summaries run on Meta Llama only, with no
  OpenAI fallback. If Llama fails, the chat says "Grandpa could not answer just
  now. Please try again in a moment.";
- reading aloud uses the phone's own free voice;
- PDF page reading, Live Talk, documents, Library stories and Build are paused
  (web research runs on Grandpa's own free research instead, above). Pictures, photos and voice typing run on Meta (above).

## Modes (`LLAMA_MODE`)
- **`all`** (the default, owner's choice, to save OpenAI credit). Every text
  chat turn goes to Llama, including hard questions, stories and questions that
  would have been researched. OpenAI's web tool isn't used; questions that need
  fresh facts are looked up with Grandpa's own free research instead (above). Chat titles and long-chat summaries also
  go to Llama. When Llama answers, Grandpa points people to "Create an image
  of…" rather than a picture tool.
- **`everyday`.** OpenAI keeps its tools (pictures, documents, memory),
  research, careful thinking and stories.
- **`backup`** (or `LLAMA_FIRST=false`). Llama only stands in when OpenAI
  cannot answer.

**What always stays with OpenAI:** photos and PDF pages (Llama reads text
only), making pictures, spoken voice, turning speech into text, documents,
Library stories and Build.

**When OpenAI answers instead:** whenever Llama fails, or the owner's Meta
Llama amount is used up.

## Everyday chat first (to save OpenAI credit)
The owner's OpenAI credit was running low, so everyday chat now goes to Llama
first (`everydayForLlama` in `server/llama.js`).

**What stays with OpenAI:**
- anything that mentions pictures, documents, letters, CVs, memory, news or
  searching;
- photos and PDFs;
- web research;
- careful thinking;
- the long creative pieces;
- "continue";
- Build.

**When OpenAI answers instead:** if Llama can't answer, for example because
it isn't set up, its allowance is used up, or it returns an error.

**Turning it off:** `LLAMA_FIRST=false` turns this off, and so does a $0
amount for Meta Llama on Owner Controls.

The same change turns two voice features off by default for everyone, once:
reading answers aloud and the advanced voice. Both are still one tap away in
Settings, and switching them back on sticks.

# Meta Llama as Grandpa's backup

OpenAI stays Grandpa's main model. When it cannot answer a chat message, Meta's
Llama answers that message instead, so Grandpa never just stops. That covers:
- an outage or server error;
- running out of quota, or a refused key;
- the network failing;
- today's **Chat** limit being reached.

The chat shows a short note: "OpenAI could not answer just now, so Meta's Llama
is answering this one."

## What it never does
- **Retries a request OpenAI rejected as malformed** (400, 404 or 413). Sending
  the same faulty request elsewhere wouldn't help.
- **Answers after the overall daily limit or the owner's Pause.** Those stop
  everything, the backup included.
- **Handles pictures, PDF pages, voice, documents, research or Build.** Those
  stay with OpenAI, and Llama receives only the words of the conversation.

## Setup (owner)
1. In Vercel, under Project → Settings → Environment Variables, add
   `LLAMA_API_KEY` with your Llama API key for Production, then redeploy. Never
   paste the key into a chat.
2. On Owner Controls, set **Backup (Meta Llama)** to a daily amount. It starts
   at $0, which keeps the backup off.

`LLAMA_BASE_URL` (default `https://api.llama.com/compat/v1`) and `LLAMA_MODEL`
(default `Llama-4-Maverick-17B-128E-Instruct-FP8`) can be changed if Meta
changes them.

## Cost
- The backup has its own daily allowance, `backup`, in the spending ledger.
  That spending also counts toward the overall daily limit.
- Each answer is charged from the words actually sent and received, at
  $1 per million tokens in and $3 per million tokens out. These rates are
  deliberately above Meta's published Maverick prices (about $0.22 in and
  $0.85 out, not yet confirmed on Meta's own pages), so the ledger can only
  over-count. Tokens are estimated at four characters each.

## Code and tests
- **Code:** `server/llama.js`, which covers settings, failure classification,
  text-only messages and streaming. It is called from `tryBackup` in the
  `/api/chat` route.
- **Tests:** `tests/llama-backup.test.mjs` checks the real route against a fake
  OpenAI and a fake Llama:
  - at $0 nothing happens;
  - with an amount set, Llama answers and the backup allowance is charged;
  - a malformed request is not retried;
  - a healthy OpenAI keeps the backup out of it.
