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

## Calm on purpose
The first version gave each part strong acting directions: lively, cheerful,
building suspense, a different colour for each character. On a phone speaker
that made some voices strained and harsh. The owner reported a sound that hurt
their ears. Each part now has only a light touch of manner. Every request also
asks for a steady, comfortable volume and pitch: no shouting, nothing shrill,
squeaky, breathy or crackling, and no acting. Live Talk has the same rule.

## Speaker guard
The owner heard a buzz under every voice, like a vibrating speaker. The AI
voice arrives loud and carries deep tones that a phone speaker cannot
reproduce, and the app was playing it raw. `public/speaker-guard.js` now
routes each answer through a short Web Audio chain:
- a steep cut below 130 Hz (two high-pass filters in a row);
- a gentle −3 dB softening above 7.5 kHz;
- about 3 dB of headroom;
- a limiter, so no peak can overdrive the speaker.

Measured in Chromium: rumble at 50 Hz drops about 30 dB and at 80 Hz about
12 dB. The voice band loses only the 3 dB of headroom. Before the first tap,
or where Web Audio is missing, audio plays as before rather than going silent.

History questions are now read by the Storyteller. "President" no longer sends
them to the News reader.

## Cleaner audio (second fix for the buzz)
The buzz was still there with the speaker guard, so it was likely inside the
audio itself. Two changes:
- **Positive instructions only.** The speaking instructions no longer name
  unwanted sounds (background noise, music, crackling, shrill, and so on).
  A speech model given such words can produce them. Instructions now describe
  only the sound wanted: a calm person beside the listener in a quiet room,
  with a steady volume and an even pitch.
- **Better formats.** Browsers that can play it (Android and modern browsers)
  now get Opus, which is clearer than MP3 at the same size. Settings → **Best
  sound** asks for uncompressed WAV, which has no compression artefacts at all
  but uses more data. Other browsers keep MP3. All formats cost the same.

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
