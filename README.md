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
| **Interactive Storyteller** | A folktale or a true historical anecdote, on a theme you pick — Wisdom, Bravery, Community, Cleverness, Tradition. It stops at a decision, you choose what happens next, and the ending carries a moral and a proverb. |
| **Ancestral names** | Suggestions by people, day of birth, birth order and child, each with its meaning — and a standing instruction to give two names it is sure of rather than five it is not, plus advice to ask an elder of the family before settling. |
| **Recipes** | Palava sauce, dumboy, pepper soup and the rest: ingredients from a Liberian market, steps you can follow, the story behind the dish, and a grandmother's tip. |
| **Proverb quiz** | One question at a time on proverbs, history and culture, with a streak that survives a reload. |
| **Cultural Album** | Painted scenes of Liberian life — a village, the coast, market day, a palaver hut. **Off by default**, because a picture costs cents where an answer costs a fraction of a penny. Every picture is labelled on screen as a drawing, never a photograph. |
| **Read the Library aloud** | Every result has a Listen control — a story (at the fork as well as at the end, with the choices read out, since a listener cannot see the buttons), the names, a recipe read as numbered steps for someone whose hands are in the pot, the quiz question with its options, and the picture's note. In Grandpa's own voice, like everything else. |
| **Journal** | Keep any story, name list, recipe or picture; read it back later. Stored in the browser. |
| **The hearth** | A welcome screen in the Liberian register: the elder's portrait, a greeting by name, a proverb that holds for the whole day, and four topic cards — The Family Hearth, The Hustle, Ancestral Soil, Deep Paths. |
| **Who is talking** | Five elders — Grandpa, Grandma, Northern Elder, Market Auntie, Coastal Sage — and four tones: Classic Warmth, Playful, Solemn, Strict Proverbial. |
| **What he can do** | The line under the composer shows one thing he is actually for — a folktale you choose the ending of, homework with the working shown, the answer read aloud in an elder's voice — and moves on to another every few seconds. It holds still while you type, while he answers, and while you are talking to him. A line that needs something this deployment has not switched on is simply never shown. |
| **Glossary** | Liberian terms in an answer (*small-small*, *palava hut*, *susu*, *dumboy*) are underlined; tapping one explains it, so a reader from outside can follow without the vernacular being translated away. |
| **Daylight & Twilight** | Daylight is linen `#FAF3E0`, terracotta `#C62828`, palm gold `#FF8F00`, wood brown `#4E342E`. Twilight is deep mahogany `#140C0B` with warm amber, for evening storytelling. |
| **Interface sounds** | Taps, sends and chimes synthesised with Web Audio oscillators — no audio files to download on a metered connection. |
| **Multilingual chatbot** | Liberian English vernacular by default, standard English alongside it. Kpelle, Vai and Bassa appear in the picker as roadmap languages — the assistant says plainly that they are still being built rather than faking them. |
| **Talking with Grandpa** | A hands-free spoken conversation: talk, stop talking, and he answers out loud — then listens again by himself, with nothing to press. **Talk over him and he stops**, the way a person does. He waits when you pause on "and" or "because" instead of cutting you off. Each sentence is spoken as it arrives, and the exchange is left behind as an ordinary conversation you can read. See below. |
| **Live news** | Ask what happened today and he goes and reads it, then says which paper carried it and when — Liberian papers first. Only questions that are actually about *now* are looked up; everything else is answered from what he knows, and still refused honestly when he does not know it. See below. |
| **Whole answers** | A reply that runs out of room is picked up and carried on — twice if it needs it — and the halves are joined with no seam. An answer that stops mid-sentence is not an answer. See below. |
| **How Grandpa talks** | Not an accent filter over standard English. A register with its own sound, grammar, vocabulary and way of arranging a thought — three registers, in fact, from broadcast-standard to family talk to ceremonial. See below. |
| **How loud he talks** | Louder than a phone can go on its own. `audio.volume` stops at 1 and is already there, so the voice is run through a compressor and a makeup gain instead — the loud syllables held back so the quiet trailing ones can come up with them, which is what actually makes a voice carry over a generator. Three steps, **Loud by default**, and turning it up lands on the words being spoken right now. See below. |
| **Where he is sitting** | The spoken voice can be put in a room: a palaver hut, an evening fire, or a county shortwave set. Built with Web Audio filters on the device — no audio files to download. |
| **The accent** | There is no Liberian voice in any speech service. So the text going to the voice is not the text on the screen: the page stays easy to read, while the speaker is handed the spoken spelling — *"I tink dat ting will be betta afta de wata."* See below. |
| **Grandpa's own voice** | Not the phone's robot: a real voice, one per elder, told how an old man on his porch talks. The phone's own voice stays underneath and takes over when the network is gone or on a metered connection. See below. |
| **Voice out** | Press **Listen** on any answer, or turn on auto-read. Long answers are split into sentence-sized chunks, which is what stops browsers cutting them off part-way. Pause, continue and stop from a bar above the composer. |
| **Voice in** | Hold a conversation with the microphone: continuous dictation with the words appearing as you speak, so a pause for breath does not end it. Pick the accent closest to your own; if a device cannot do it, it falls back rather than failing. |
| **Grandpa's voice** | Choose from the voices your device has. The default is the closest to Liberia the device offers — West African first, then British, then whatever exists. Speed and depth are adjustable, with a test button. |
| **Share an answer** | Sends it through the phone's own share sheet — WhatsApp and the rest — or copies it where that is unavailable. |
| **Works offline-aware** | A clear banner when the network drops, your history still readable, and a **Try again** button on any message that failed. |
| **Rename conversations** | Rename in place from the sidebar, so *Planting Rice Season* can become *My rice notes*. |
| **Homework Helper** | Teaches the method and shows the working, then offers a practice question — it does not just hand over answers. |
| **Business Advisor** | Pricing, bookkeeping you can keep in a paper exercise book, and loan readiness. Shows the arithmetic so you can redo it with your own numbers. |
| **Farming Assistant** | Crop problems, planting seasons, storage. A market price or a forecast is looked up where live news is switched on, with the source named; where it is not, he says plainly that he has no feed rather than guessing, and points to the extension officer. |
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
it points to a teacher, nurse, extension officer or ministry instead. That is where the
caution belongs: in what he says, every time, rather than in a warning printed under
the box you type into, which told a reader nothing except to be careful, forever.

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
| `OPENAI_MODEL` | `gpt-4o-mini` | Last-resort model, used only when the account's model list cannot be read. Normally the server chooses per task — see below. |
| `OPENAI_TITLE_MODEL` | `gpt-4o-mini` | Same, for naming conversations. |
| `MODEL_FAST` | *(automatic)* | Pin the model used for short, high-volume work: naming a conversation, a quiz question, low-data mode. |
| `MODEL_BALANCED` | *(automatic)* | Pin the model used for ordinary conversation, recipes and names. |
| `MODEL_DEEP` | *(automatic)* | Pin the model used for folktales and the storytelling persona. |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Point at a compatible gateway if you use one. |
| `PORT` | `3000` | Port to listen on. |
| `RATE_LIMIT_PER_MINUTE` | `30` | Requests allowed per IP per minute. `0` disables the limit. |
| `ACCESS_CODE` | *(blank)* | When set, visitors must enter this code before they can chat. Leave blank locally; set it on any public address. |
| `ENABLE_REAL_VOICE` | `true` | Grandpa's own voice instead of the phone's robot. See below. |
| `OPENAI_VOICE_MODEL` | `gpt-4o-mini-tts` | The only family that takes an instruction about *how* to say it. |
| `VOICE_CHARS_PER_HOUR` | `60000` | A ceiling across the whole deployment — roughly 150 spoken answers an hour. |
| `ENABLE_LIVE_NEWS` | `true` | Lets him read the web for questions that are about now. Switches itself off if the account has no search-capable model. See below. |
| `OPENAI_SEARCH_MODEL` | *(automatic)* | Pin which model does the reading. Left empty, the best one the account has is used. |
| `ENABLE_IMAGES` | `false` | Turns the Cultural Album on. Off by default — see below. |
| `OPENAI_IMAGE_MODEL` | `dall-e-3` | `dall-e-3` works on any account; `gpt-image-1` is newer but some accounts must verify with OpenAI first. |
| `IMAGES_PER_HOUR` | `20` | A ceiling across the whole deployment, not per visitor. |

The model picker is filled by asking OpenAI which models your key can actually use
(`GET /v1/models`, filtered to chat models and cached for ten minutes). A hardcoded
list would either hide models you are paying for or offer models your key cannot
touch — and, worse, would look like your account's limit when it was really ours.

Until a key is configured, or if that listing fails, a small fallback list is shown
and the picker says so. If a model is refused anyway, the error names it and quotes
OpenAI's own wording rather than replacing it.

### A model for each job

The picker's default is **Automatic**, and it is the right answer for almost
everybody: the server picks a model per task from that same account list.

| Work | Tier | Why |
| --- | --- | --- |
| Naming a conversation, a quiz question, anything in low-data mode | fast | Three words in a sidebar is never worth a large model. |
| Ordinary conversation, recipes, naming traditions | balanced | A current `mini` — the flagship is more than a conversation needs, `nano` is less. |
| Folktales, branching stories, the storytelling persona | deep | The best model on the account. This is the work the platform is judged on. |

`server/models.js` ranks the account's models by what their names imply — family,
generation, `mini`/`nano` — rather than holding a list of its own, because model
names change and a list would quietly go stale. Reasoning models (`o1`, `o3`, `o4`…)
are never chosen automatically: they are slow to the first token, which reads badly
in a streamed answer. They are still there to pick by hand. Where the guess is not
good enough, `MODEL_FAST` / `MODEL_BALANCED` / `MODEL_DEEP` pin exact models; a pin
naming a model your account does not have is ignored rather than breaking every
request.

Choosing a model by hand in Settings turns all of this off for every request — that
choice is used for everything, which is what picking it means.

Newer models also reject settings the older ones require: `max_tokens` has to become
`max_completion_tokens`, and some refuse `temperature` outright. Rather than keep a
table of which model wants what, the server reads the refusal, sends the request
again without the offending setting, and remembers what each model refused — so that
round trip is paid once, not on every message.

### Talking with Grandpa

Tap **Talk with Grandpa** on the welcome screen, or the waveform beside the
microphone, and it becomes a conversation: you speak, you stop, he answers
aloud, and he is listening again before you think to ask for it.

Three things make that harder than plugging the browser's two speech APIs
together, and each one shows in the interface:

- **A phone hears its own loudspeaker.** The recogniser cannot be left running
  while he talks, or it transcribes his answer back to him and the
  conversation eats itself. So the *recogniser* is shut while he speaks — but
  a second microphone stream, with the browser's echo cancellation on, watches
  the **volume** and nothing else. A voice that rises over him stops him. See
  below.
- **A silence is how a turn ends, but how long a silence is personal.** An
  elder thinking mid-sentence has not finished. So the wait is a setting —
  Quick, Normal or Patient, under Voice in Settings — and it stretches further
  still when you stop on a word nobody ends on.
- **Waiting for the whole answer would leave dead air.** Each sentence is
  spoken as soon as it is complete, while the rest is still arriving. On a 2G
  connection that is the difference between a conversation and a wait.

The server is told the turn is spoken, and asks for a spoken answer: about
sixty words, no headings or bullets or asterisks, no URLs read out letter by
letter, and if the recogniser clearly mangled something, say what it heard
rather than guess. Everything said is saved as an ordinary conversation, so
hanging up leaves a transcript.

**Talking over him.** Browsers have had acoustic echo cancellation for years —
it is what every video call runs on — so a microphone opened with it subtracts
most of the loudspeaker from what it reports. A second stream does nothing but
measure the level: no words leave it, nothing it hears is sent anywhere. When a
voice stays well clear of the room's own noise for about a third of a second,
he stops and listens.

Where that fails, it fails loudly rather than quietly: on a phone whose echo
cancellation does not hold, Grandpa's own voice trips the meter and he
interrupts himself. So a cut-in that nobody follows with words counts against
the feature, and after three it switches itself off and says why. It is also a
plain switch in Settings, for a noisy market where it would misfire.

That same stream drives the seal: it swells with the voice the microphone is
really hearing, rather than pulsing on a timer. A circle that answers your own
voice is the proof that the thing can hear you, which is the first question
anyone has.

**Not being cut off.** A person who stops on "and", "because", "so" or "um" has
not finished — they are reaching for the next word. Ending their turn there is
the rudest thing a listener can do, and the commonest fault in voice
assistants. Those endings add most of a second to the wait. A lone "mm" or "ah"
is not sent as a question at all.

The screen stays awake while you are talking, listening stops if you switch
away, and a microphone left open with nobody speaking pauses itself after a
minute. Chrome, Edge and Safari can do this; where the browser cannot, the way
in is not offered at all rather than failing when tapped.

### Answers that finish

Every model has a token ceiling, and when it hits one it stops — often
mid-word. Nothing about that looks like an error: the stream ends, the cursor
disappears, and a half-finished sentence sits there looking like the answer.
The reader is left to guess whether Grandpa had more to say.

So the finish reason is now read. When the model stopped because it ran out of
room rather than because it was done, the server hands the answer back with an
instruction to carry straight on — no preamble, no repetition, finish the word
if it was cut mid-word — and keeps streaming into the same reply. The reader
sees one continuous answer and never learns there was a break.

Twice at most. Two continuations cover any question a person actually asks, and
an unbounded loop here is somebody's money. If it is *still* unfinished after
that, the app says so plainly and offers the rest, rather than letting a
hanging sentence pass for the end — and says it in the warm amber of a long
answer, not the red of a failure.

The ceilings went up too, since the cheapest fix is room to finish: 1400 → 2200
tokens for a written answer, 500 → 700 for a spoken one, 300 → 420 in low-data
mode. Library answers are JSON, where being cut off means it does not parse at
all and the reader gets *nothing* rather than most of something — so a story
went 1100 → 1600 and a recipe 1100 → 1500.

And the prompt now says it outright: answer the whole question, not the first
part of it; never stop in the middle of a sentence, a list or a step; if a
subject is genuinely too big, give the complete useful part and say what is
left out. In a spoken conversation, sixty words is a target and not a
guillotine.

### Live news, and what he still will not guess

Asked what was in the news this morning, Grandpa used to say he had no internet.
That was the honest answer and the right one — a model knows nothing after the day
its training stopped, and an elder who invents the news is worse than one who says
he has not heard it. But it is not a *useful* answer, and the rule was never the
point. The point was not making things up.

So rather than loosen the rule, he was given a way to actually find out.

A question that is about **now** — the news, today's rate, the weather, who won last
night, anything naming this year or later — is sent to OpenAI's Responses API with its
web-search tool attached, on the same account and the same key, so the model reads the
web before answering. That turn gets a different set of instructions: name the paper or station and the date, prefer Liberian sources where
they exist (FrontPage Africa, the Daily Observer, the New Dawn, the Liberian
Investigator, the Liberia News Agency), give both sides where reports disagree, and
say plainly when the search came back with nothing rather than filling the gap.

Every other question goes where it always went. "How do I plant rice" has not changed
since the model was trained, a search costs more than an answer, and most of what
people ask him is not news. Those turns keep the old instruction word for word: no
internet, no feeds, say so.

Which turn you got is on the screen. An answer he read carries a small mark —
**◉ Looked it up just now** — and the papers behind it are listed underneath as links
you can go and check. An answer he did not look up carries neither. The two are not
the same kind of claim, and the page should not let them look alike.

**A search that cannot happen is never allowed to cost the answer.** If the reading
fails — the key is not cleared for it, the tool is refused, OpenAI is having a bad
minute — the turn quietly falls back to an ordinary answer under the honest
instruction, the mark is taken back off before a word is written, and the reader gets
what he does know instead of a red box. A refusal that will still be a refusal in five
minutes (a 400, 403 or 404) is remembered, so the round trip is paid once rather than
on every news question after it.

The tool has been called two things; `web_search` is current and `web_search_preview`
is what older accounts answer to. Rather than guess, the first is sent, the refusal is
read, and the other is used from then on — the same way the parameter quirks are
learned. It is deliberately **not** `gpt-4o-search-preview`: those models were retired,
and a key that still sees one in its listing gets "has been deprecated" when it tries
to use it.

It runs on the same key and the same bill as everything else: no second provider, no
second account. If your key has no search-capable model, the feature switches itself
off and `/api/config` reports `liveNews: false`, because promising live news the
account cannot fetch is the same lie this whole thing exists to prevent.

`ENABLE_LIVE_NEWS=false` turns it off deliberately — then he goes back to saying he
has not heard the news, which is true again.

### How Grandpa talks

"Answer in Liberian English" is a one-line instruction, and what it produces is
an accent filter: slang sprinkled over standard English. What it does not
produce is a person. So the register is built as separate layers, set out in
`server/liberian.js` as a document about a language — so that someone who
speaks it can read it and correct it without wading through application code.

**Three registers.** *Standard* is the default: the English of Liberian
teachers and broadcasters, dignified and clear, with the markers below applied
lightly. *Warm familial* is for personal advice and folktales — closer, more
vernacular, more particles. *Formal ceremonial* is for public and official
matters, with the honorifics used properly. A folktale starts familial; the
model may move between them when the moment asks, and move back.

**The sound, on the page.** Consonant blends soften (`left → lef`, `last →
las`); *th* moves to *t* and *d* (`think → tink`, `that → dat`). Capped at
roughly one word in six or seven, no apostrophes for dropped letters, and a
standing rule that if a sentence gets harder to read, spell it the ordinary
way. Heavy phonetic spelling reads as mockery and is slow going for exactly the
reader this is built for.

**The grammar**, which is where a language actually lives — slang is borrowed
easily, syntax is not. Completive *done* ("I done look at dat problem
already"), habitual *be* for what keeps happening and never for a single event,
reduplication (*small-small*, *fine-fine*, *fast-fast*), and the clause-ending
particles *o*, *ya* and *nor* placed where the voice would rest — at most one
in a sentence.

**The lexicon**, in its real contexts: *palaver*, *country fashion*, *snap*,
*eat money*, *the thing dem*. And a boundary that matters as much as the
vocabulary: a model reaching for "West African English" reaches for Nigerian
pidgin, because that is what the internet is full of. *wetin*, *abi*, *abeg*,
*oya*, *chale*, *wahala* are ruled out by name — a Liberian ear hears them
instantly as somebody else's language.

**The discourse.** Ground the answer in a proverb or an observation before
giving it. Correct sideways, through comparison, not bluntly. Return to the key
phrase once. Address the person as an elder would. An assistant that answers
like a helpdesk is not an elder, whatever the words are doing.

One thing this must never touch: pick **Standard English** and none of it
applies, because there *dat* is not a register, it is a mistake. The tests
check that both ways round.

### Starting to talk quickly

Speech is generated before a word of it can play, and how long that takes goes
with how much text was sent. Handing the voice a whole folktale means standing
there in silence while all of it is made.

So a press of Listen is split. The first piece is about one sentence — it comes
back quickly and starts talking — and the longer pieces behind it are fetched
while it plays, where nobody is waiting on them. The sizes ramp rather than
jump (roughly 110, 330, then 550 characters), because a one-sentence opener is
only a second or two of audio and a full-size piece behind it might not be
ready when that second runs out.

The two ends want opposite things and are cut differently: the first piece
takes the *earliest* sentence end it can find, since it is the one being waited
on; every piece after it takes the *latest* that fits, for fewer round trips
and fewer seams. Both break at a sentence wherever possible — a piece that
stops at "…that was not" and resumes with "his." sounds worse than one that ran
a little over.

This also fixed a real fault. The text used to be cut to one request's length
and the remainder dropped, so "Read it to me" on a long folktale, with the real
voice on, simply stopped two thirds of the way through and never said the rest.
Nothing is discarded now, and the tests check the whole text is accounted for.

### The accent

There is no Liberian voice in any text-to-speech service, and there is not
going to be one soon. What there is, is this: **a speech engine pronounces the
letters it is handed.** Write "dat ting" and it says "dat ting".

So the page and the speaker do not get the same text. On screen the words stay
easy to read — a light scattering of spoken forms, no more, which is what
`server/liberian.js` is careful about, because someone has to *read* it. On the
way to the voice they go through `public/pronounce.js` first, and there the
shift can be as complete as the accent really is, because nobody is reading it:

| on the page | to the voice |
| --- | --- |
| "Good day, my friend." | "Good day, my fren." |
| "I think that thing will be better after the water comes." | "I tink dat ting will be betta afta de wata comes." |
| "Ask the doctor, and remember to take the medicine small-small." | "Aks de docta, an rememba to take de medicine small-small." |

Three features carry most of the sound, and each is applied by a named list or
a guarded rule — never by ear:

1. **The interdentals.** /θ/ and /ð/ are *t* and *d*: think → tink, this → dis.
2. **Final clusters simplify.** last → las, hand → han, left → lef.
3. **It is non-rhotic.** Unstressed *-er* is *-a*: water → wata, never → neva,
   doctor → docta.

The clusters are a list rather than a suffix rule on purpose. "-nd → -n" would
correctly give *han* and *husban*, and would also turn **brand** into **bran**,
which is a different word. A rule that can quietly swap one real word for
another is not in that file, and the tests name eight such traps and check each
one.

**Grandpa's accent** in Settings is Full, Light (the *th* only) or Off, and the
hint shows you the sentence rather than describing it.

The instruction sent with the voice names the accent too — Liberian English,
non-rhotic, syllable-timed and even rather than the stress-timed bounce of
American English, level intonation — and tells the engine to pronounce the
spelling as written and not correct it back. All five elders get it; they are
all Liberian.

### How loud he talks

The first thing anyone said about the spoken voice was that they could not hear it.
A phone's volume button stops where it stops, and an elder talking on a porch in
Monrovia is competing with a generator, a road, and other people's conversations.

`audio.volume` cannot help — 1 is the ceiling and it is already there. Going past it
means Web Audio, and a plain gain past 1 would only clip. So what is actually in the
chain is a compressor first and the gain after it: the loud syllables are held back so
the quiet trailing ones — which is most of how an old man speaks — can be lifted with
them, and the compressor then stands in front of the gain as the limiter so nothing
crunches.

Three steps: **Normal** (the compressor sitting there wide open, doing nothing),
**Loud** (×1.9, 4:1) and **Very loud** (×3.1, 9:1). Loud is the default. Changing it
is two numbers on nodes that are already in the graph, not a rebuild, so it lands on
the sentence being spoken rather than the next one — somebody who cannot hear him is
turning it up to find out whether it helped.

At Normal with no room chosen there is nothing to do to the audio at all, so nothing
is built and nothing is routed; the element plays exactly as it did before. And like
the rooms, this can only reach Grandpa's own voice: the phone's built-in synthesiser
goes straight to the loudspeaker and no browser lets you get in between, so the
setting says so instead of letting someone turn it up and hear no difference.

### Where he is sitting

The spoken voice can be placed in a room — a palaver hut, an evening fire, or a
county shortwave set — through a Web Audio chain built on the device. The hut
adds warmth and a short reverb whose impulse response is synthesised from a
noise burst rather than downloaded; the fire dampens the high end the way night
air does; the radio is a narrow band with speech pushed up in the middle and a
little grit from a small cheap speaker.

This can only reach audio the app plays itself, which means Grandpa's own
voice. The phone's built-in synthesiser goes straight to the loudspeaker and no
browser lets you intercept it, so the setting says so rather than leaving
someone to wonder why nothing changed.

### Grandpa's own voice

A browser can already read text aloud for free, and that is what this used to
do. The trouble is what it sounds like: on most Android phones the default
English voice is a young woman reading a train timetable. For an app whose
whole promise is a grandfather talking to you, that is not a cosmetic flaw —
it is the product being wrong.

So the answer is spoken by a real voice from OpenAI, and each of the five
elders has their own. Grandpa gets the deepest one, and with it an instruction
about how to say it: *an old West African grandfather, around seventy, on the
porch in the evening; deep chest voice, slow, warm, small pauses the way an old
man does when he is remembering; never like a presenter.* That instruction is
the difference between an elder and a newsreader, and only the `gpt-4o-mini-tts`
family takes one.

It costs about a US cent for four or five answers — the same order as the
answers themselves — so it is on by default, with a ceiling of its own.

The phone's own voice is still there underneath, and takes over by itself when:

- the network is gone, or the voice service fails, or the audio will not play
  (the words already fetched go to it too, so nothing is lost mid-answer);
- the hourly ceiling is spent;
- **low-data mode is on** — speech is tens of kilobytes, which is not a thing
  to send down a 2G line unasked;
- the listener turns it off in Settings.

That fallback also got the fix it needed: a man's voice now outranks everything
else when choosing among the phone's own, including a closer accent, because a
device answering in a woman's voice gets the one thing wrong that everybody
hears. Browsers do not report a voice's gender, so this reads the name —
crude, but the alternative is leaving it to chance.

On a serverless host the hourly ceiling is counted per instance and resets with
every cold start, the same caveat as the picture limit; `ACCESS_CODE` is the
real protection on a public address.

### Pictures cost real money

A text answer costs a fraction of a penny. A picture costs **cents** — a hundred
times more. So the Album is off unless `ENABLE_IMAGES=true`, and when it is on:

- `IMAGES_PER_HOUR` caps the whole deployment, not each visitor, so a public
  address cannot empty the account overnight. The picture is counted *before* the
  call, so two requests arriving together cannot both slip past.
- The panel states the cost before anyone presses the button, and shows how many
  are left this hour.
- The Album tab does not appear at all where pictures are switched off.

Pictures are made in two steps. A text model first writes a grounded scene
description under the cultural rules — a painted scene, ordinary life treated with
dignity, no poverty tropes, no real named people or places, nothing sacred — and
the image model renders that. A visitor's words never reach the image service
unchanged. Every picture carries a visible label: *drawn by AI, not a photograph of
a real place or person*.

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

### Vercel

`vercel.json` and `api/index.js` are included, so Vercel works too — import the
repo, add `OPENAI_API_KEY` under **Settings → Environment Variables**, deploy.

Two things genuinely differ there, because Vercel runs short-lived serverless
instances rather than one continuous server:

- **The per-IP rate limit and the hourly picture ceiling are counted in memory**,
  so each instance keeps its own count and a cold start resets it. Neither is a
  real ceiling on Vercel. `ACCESS_CODE` is the protection that actually holds, and
  the app **refuses to generate pictures on a serverless host without one** rather
  than letting a weakened guard look like a real one.
- **A long answer streams for as long as it takes.** `maxDuration` is set to 60
  seconds in `vercel.json`; if your plan caps it lower, a long reply is cut off
  mid-sentence. Low-data mode keeps answers short enough that this rarely bites.

For a pilot with real users, a host that runs a normal server — Render, Railway,
Fly — keeps both ceilings real. Vercel is a good fit for showing the thing to
people.

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
api/
  index.js      Serverless entry — hands the app to Vercel, no listener
server/
  app.js        The Express app — static files, SSE chat, rate limit, validation
  index.js      Starts the app on a port (local, Render, Railway, Fly)
  openai.js     OpenAI client: streaming parser, one-shot completions, error
                translation, and adapting to what each model will accept
  models.js     Which model each task deserves, ranked from the account's own list
  personas.js   The system prompts — persona x language x low-data
  liberian.js   The register itself: phonology, grammar, lexicon, discourse
  config.js     Environment, the fallback model list and the chat-model filter
  structured.js The Library's prompts and reply validators (stories, names,
                recipes, quizzes) — kept server-side like the personas
public/
  index.html    One page
  styles.css    Brand palette, light and dark, mobile-first breakpoints
  app.js        State, streaming, history, settings, sharing
  speech.js     Text-to-speech chunking, voice ranking, dictation locales
  converse.js   The hands-free loop: turn-taking, silence detection, cutting in
  ear.js        The microphone as a volume meter — never as words
  pronounce.js  The accent: what the voice is handed, not what the page shows
  room.js       Palaver hut, fire and shortwave, as Web Audio filters
  realvoice.js  Grandpa's real voice, with the phone's own as the fallback
  markdown.js   Small Markdown renderer (escapes first, then adds markup)
  storage.js    localStorage for conversations and preferences
  glossary.js   Liberian terms, and DOM-safe annotation of them
  proverbs.js   Proverb of the day
  sounds.js     Procedural interface sounds (Web Audio, no assets)
  library.js    The Storyteller and Wisdom Hub, and the journal
  logo.png      The Grandpa AI seal — sidebar, topbar, welcome screen, sharing
  favicon.png   Tab icon
  apple-touch-icon.png  Home-screen icon on iPhone
render.yaml     Render blueprint — secrets are prompted for, never committed
vercel.json     Vercel config — static from public/, API as one function
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
- **Model choice (unit)** — 31 checks: a model id read for family, generation and
  size, an unfamiliar future name still placing sensibly, a current mini beating an
  older flagship for conversation, reasoning models kept out of the automatic picks
  but used when they are all there is, pins honoured and impossible pins ignored.
- **Model choice (end to end)** — 17 checks through the running server: the tier
  each endpoint really used, low-data overriding the storytelling persona, a hand
  picked model winning everywhere, and one the account lacks falling back.
- **Adapting to a model** — 16 checks: `max_tokens` renamed and `temperature`
  dropped when a model refuses them, the fix remembered so the second request is
  right first time, streaming adapting the same way, and a refusal that sending
  less cannot fix thrown rather than retried.
- **Browser (Playwright)** — 41 checks: streaming display, Stop/Send swapping,
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
- **Whole answers (server)** — 19 checks: a finished answer left alone, a
  cut-off one carried on and the halves joined in order with nothing repeated
  and no apology at the seam, a runaway answer carried exactly twice and then
  reported unfinished rather than passed off as whole, and spoken and low-data
  turns finishing their thought like any other.
- **The Liberian register (unit)** — 56 checks: every layer reaching the model
  with its examples intact, the density caps on phonetic spelling, each of the
  eight ruled-out pidgin words named, the three registers and which one a
  folktale starts in — and, both ways round, that Standard English gets none of
  it while the roadmap languages get all of it.
- **Where he is sitting, and how loud (Playwright)** — 41 checks against a
  stubbed Web Audio graph: each room building the chain it claims to and no
  other, the choice surviving a reload, the hint admitting what a room cannot
  reach, and — three ways — a failure never costing the listener the answer.
  Then the level: nothing built before there is a word to say, nothing routed
  at Normal with no room, routed but untouched in tone when only the loudness
  is up, the makeup gain pushed past what an audio element can reach, Very loud
  lifting further and squeezing harder to make room for it, Normal leaving the
  sound alone, the new level landing on nodes already in the graph rather than
  the next piece, and the same honesty about the phone's own voice.
- **Breaking text up for the voice (unit)** — 22 checks: a small first piece
  that is a whole sentence rather than a fragment, larger ones behind it,
  sizes that ramp rather than jump, and — the one that matters — every
  character of a long story accounted for, including a single sentence longer
  than one request is allowed to be, and text with no sentence ends at all.
- **The accent (unit)** — 40 checks: each of the three features, a whole
  sentence surviving with nothing dropped and its punctuation intact, case kept
  through every substitution, the three strengths differing as they claim,
  applying it twice being the same as once — and eight trap words (brand, bond,
  beyond, wand…) that a looser rule would turn into different real words.
- **Grandpa's voice (server)** — 23 checks: each elder given their own voice,
  the delivery instruction actually sent, the speed slider passed through and
  an impossible speed clamped, an over-long piece cut rather than refused, an
  upstream failure named for what the reader was doing, and the hourly ceiling
  holding and saying the phone's voice still works.
- **Grandpa's voice (Playwright)** — 21 checks against both engines stubbed:
  the real voice used and the phone's untouched, and the other way round when
  it is switched off; low-data holding it back but the answer still read;
  the fallback taking over when the voice cannot be reached, when the browser
  refuses to play it and when the audio will not decode — with the words
  already fetched handed over rather than lost.
- **Reading the Library aloud (Playwright)** — 26 checks on *what* is spoken:
  the title first, the decision put to the listener and both choices read out
  and numbered so they can be answered aloud, the proverb and moral at the end
  and the stale choices gone, a recipe's ingredients and numbered steps and the
  tip last, every quiz option numbered — plus the control marking itself as the
  one talking, stopping when pressed again, and stopping when the reader moves
  on to something else.
- **Turn-taking (unit)** — 33 checks against a driven ear and mouth: a turn
  ending on "and", "because", "um" or "the" held rather than answered, and one
  that has genuinely finished sent on the ordinary wait; a lone "mm" or "ah"
  not sent as a question at all while real words beginning with one are;
  talking over an answer stopping it and the interruption then being answered;
  and — where echo cancellation fails — three interruptions with nobody behind
  them switching the feature off and saying why, while an interruption somebody
  does follow up on is not held against it.
- **Talking with Grandpa (Playwright)** — 38 checks against fake ears and a
  fake mouth: a silence ending the turn with nothing pressed, the ear shut for
  the whole time he is talking and open again after, the answer spoken in
  sentences as it streams rather than in one block, no markdown read out, a
  half-heard noise not sent as a question, tapping the seal cutting him off,
  Wait and Continue, a refused microphone explained instead of retried forever,
  and the whole exchange left behind as an ordinary readable conversation.
- **What he can do (Playwright)** — 13 checks: a line under the composer that
  is not the old warning, moving on to other things he can do without ever
  showing an empty one, holding still while you type and while he answers —
  and, both ways round, a deployment with pictures and live news switched off
  never offering either of them.
- **Settings (Playwright)** — 33 checks: opening and closing three ways, text size
  moving the root size and surviving reload, the three-way theme, low-data staying
  in step between the pill and the switch, language syncing both ways, the spoken
  speed label, conversation counts, the download's name and contents, two-tap
  delete, and the mobile sheet without horizontal overflow.
- **Album (Playwright)** — 14 checks: the tab hidden where pictures are off and shown
  where they are on, the cost stated before the button, a picture rendered with its
  caption and its "not a photograph" label, the journal keeping a downscaled thumbnail
  rather than a megabyte of PNG, download, and the hourly ceiling explaining itself.
- **Library (Playwright)** — 34 checks: the story arriving and stopping at a decision
  with no moral yet, a choice continuing that same story to an ending with a proverb,
  keeping it in the journal and reading it back, the name form's 16 groups, recipes
  with ingredients and numbered steps, the quiz marking the right answer and carrying
  a streak across a reload.
- **Structured endpoint** — unknown and prototype-key `kind` values refused, replies
  validated field by field so a half-built story never reaches the interface, and the
  access gate covering it like the chat endpoint.
- **Hearth (Playwright)** — 18 checks: the daily proverb holding across a reload, the
  four card names, greeting by name, the name, speaker and tone actually reaching the
  server, glossary terms marked and explained (and never inside code), and the chips
  switching persona and asking.
- **Live news (server)** — 42 checks across four deployments: a question about
  today sent to the endpoint where web search actually lives, with the tool
  attached and the ceiling under the name that endpoint uses; an ordinary one
  left on the everyday chat call with no tool at all; the prompt swapping
  between "say where you read it" and "say you have not heard the news" and
  never carrying both; eight questions sorted either way; the tool's other name
  learned from one refusal and remembered for the next question; the pages it
  cited passed on as links. Then the three ways it can be unavailable — no
  capable model, switched off, and a key that is told no — each falling back to
  the honest refusal, the last one with the answer still arriving, no error
  shown, the claim withdrawn mid-stream and the refusal remembered so the next
  question does not pay for it.
- **Live news (Playwright)** — 13 checks: the page saying he is reading while he
  reads, the finished answer still marked as looked up, the sources listed as
  site names with the headline as the tooltip and `rel="noopener noreferrer"`,
  an answer he did not look up carrying no mark, the mark remembered with the
  conversation — and, on a key that cannot read, an answer with no error box and
  the mark taken back off.
- **Access gate** — 17 checks: requests refused with no code, a wrong code and a
  wrong code of the same length; accepted with the right one; `/api/title` gated
  too; the code absent from `/api/config`; and the browser flow through prompt,
  rejection, entry and reload.

---

## Not built yet

Named honestly, because the dossier and the reference design list them and this app
does not do them:

- **Animation and video** for the Album — the API generates still images only.
- **Acoustic environments** (palaver hut, campfire, radio) — these filter real audio
  through `AudioContext`. Browser speech output cannot be captured and filtered, so this
  needs a server-side text-to-speech voice instead of the device's.
- **Accounts and cloud sync** — conversations live in the browser only; there is no
  database, so nothing follows a user between devices.

- **SMS / USSD fallback** for feature phones — needs a telecom aggregator.
- **Offline caching** of recent answers — history persists and the app tells you it is
  offline, but answering still needs a network.
- **The community knowledge feed** — crowd-sourced local knowledge with moderators.
- **Trained indigenous-language models** — Kpelle, Vai and Bassa are declared as
  roadmap in the UI rather than approximated.
- **Accounts and server-side history** — conversations live in the browser only.

---

Tolbert Innovation Hub · Monrovia, Liberia · [tolbertinnovationhub.org](https://tolbertinnovationhub.org)
