# Natural OpenAI speech

Voice settings now offer Cedar (default) and Marin, the voices recommended by OpenAI for best text-to-speech quality. Both use `gpt-4o-mini-tts`. `OPENAI_API_KEY` stays on the server. Supported dated snapshots can be pinned with `OPENAI_VOICE_MODEL`; old `tts-1`/`tts-1-hd` pins automatically use the current default.

The legacy ElevenLabs adapter and cloning script have been removed. The app no longer routes speech to ElevenLabs or offers pending team/custom voice choices. Old custom voice environment variables are ignored; this update does not delete provider accounts, uploaded recordings or provider-side voices.

On first use after the update, old browser voice preferences are reset to Cedar, normal speed, normal loudness, no room effects, and no interface sounds. Conversations and projects remain intact. Later Cedar/Marin and speed choices persist. The obsolete `grandpa-team-voice` selection is removed.

OpenAI receives readable text, without the browser fallback's phonetic respelling. Instructions request warm, fluid delivery, a gentle Liberian cadence and clean speech without added ambience or effects. Accent settings adjust the instruction, not the spelling. This does not guarantee an authentic Liberian accent or clone any speaker. Voice depth only affects the phone fallback.

Listen and live conversation use the same voice. Each answer keeps its selected voice throughout; changing voices stops playback. The voice test uses the same playback path. Phone speech remains available when OpenAI is disabled, unavailable or offline, with a notice on cloud failure. AI generated speech is disclosed in Settings and the live conversation.

Live audio quality must still be checked on actual devices using the deployment's API access. Automated tests use mocked provider audio and cannot judge pronunciation or naturalness. Redeploy the repository to activate this change on the hosted app.
