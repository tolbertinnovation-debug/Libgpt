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
- pictures, photo and PDF reading, Live Talk, OpenAI dictation, web research,
  documents, Library stories and Build are paused.

## Modes (`LLAMA_MODE`)
- **`all`** (the default, owner's choice, to save OpenAI credit). Every text
  chat turn goes to Llama, including hard questions, stories and questions that
  would have been researched. Web research is an OpenAI tool, so it isn't used;
  Grandpa answers from what he knows. Chat titles and long-chat summaries also
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
