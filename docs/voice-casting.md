# Voice casting: the right voice for each topic

Grandpa AI now speaks with a cast of voices and picks the one that suits what
was asked. The parts and their default voices are set in `public/voice-cast.js`:

| Part | Topics | Default voice |
|---|---|---|
| Grandpa | Everyday questions | the main voice (Ballad unless changed) |
| Auntie | Cooking and food | Coral (woman) |
| Nurse | Health and care | Shimmer (woman) |
| Teacher | School and homework | Marin (woman) |
| Business mentor | Money and business | Ash (man) |
| Farmer | Farming | Onyx (man) |
| Storyteller | Stories, proverbs and history | Verse (man) |
| News reader | News and research | Sage (woman) |

## How Grandpa chooses
- **The part.** It is chosen from the question. If the question says little, it
  is chosen from the conversation's role (homework, business, farming,
  culture), from whether the answer was researched, and finally from the answer
  itself. Library stories and recipes are cast from their own text.
- **The mood.** It comes from the question and the answer:
  - **comfort** for grief, worry or illness;
  - **urgent** for danger signs;
  - **steps** for instructions and numbered steps;
  - **cheerful** for good news;
  - otherwise **steady**.
- **The instructions.** Each part has its own way of speaking, for example the
  auntie's cheerful kitchen manner or the storyteller's suspense and pauses.
  The mood is added on top. The server builds these instructions only from the
  fixed lists of parts and moods, so nothing a browser sends can rewrite them.
- **One answer, one voice.** An answer keeps the same voice and manner from
  start to finish. The next answer can be cast differently.
- **Where it applies:**
  - reading answers aloud;
  - the Listen button;
  - the Talk conversation, which is cast from the spoken question;
  - Library stories and recipes;
  - Live Talk, which is cast from the conversation's role and can only use the
    realtime voices. Onyx falls back to Ballad there.

## The person stays in control (Settings → Voice & listening)
- **Different voices for different topics:** on by default. Switched off, one
  voice reads everything in Grandpa's manner.
- **Main voice:** Grandpa's own voice, and the only voice used when casting is
  off. The owner chose Ballad over Cedar; a saved Cedar moved to Ballad once,
  and any voice picked afterwards stays.
- **Who speaks for each topic:** choose any of the nine voices for each part,
  and press ▶ to hear a sample.
- The speaking bar says who is talking, for example "Auntie is speaking…".

## Voices
- Nine voices that sound natural with `gpt-4o-mini-tts`:
  - women: Marin, Coral, Sage, Shimmer;
  - men: Cedar, Ash, Ballad, Verse, Onyx.
- The older voices (alloy, echo, fable, nova) are still refused.
- Every voice costs the same, and all speech counts against the Voice limit
  on Owner Controls.

## Tests
- `tests/voice-cast.test.mjs` covers:
  - who speaks for each topic;
  - moods;
  - the person's choices;
  - building instructions safely;
  - one voice per answer.
- In Chromium, the Listen button gave Coral for cooking, Ballad for a story
  and a comforting Grandpa for grief. Changing a voice and playing its sample
  worked, and switching casting off left one voice for everything.
