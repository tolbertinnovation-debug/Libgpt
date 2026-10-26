# Natural OpenAI speech

Voice settings now offer Cedar (default) and Marin, the voices recommended by OpenAI for best text-to-speech quality. Both use `gpt-4o-mini-tts`. `OPENAI_API_KEY` stays on the server. Supported dated snapshots can be pinned with `OPENAI_VOICE_MODEL`; old `tts-1`/`tts-1-hd` pins automatically use the current default.

The legacy ElevenLabs adapter and cloning script have been removed. The app no longer routes speech to ElevenLabs or offers pending team/custom voice choices. Old custom voice environment variables are ignored; this update does not delete provider accounts, uploaded recordings or provider-side voices.

On first use after the update, old browser voice preferences are reset to Cedar, normal speed, normal loudness, no room effects, and no interface sounds. Conversations and projects remain intact. Later Cedar/Marin and speed choices persist. The obsolete `grandpa-team-voice` selection is removed.

OpenAI receives readable text, without the browser fallback's phonetic respelling. Instructions request warm, fluid delivery, a gentle Liberian cadence and clean speech without added ambience or effects. Accent settings adjust the instruction, not the spelling. This does not guarantee an authentic Liberian accent or clone any speaker. Voice depth only affects the phone fallback.

Listen and live conversation use the same voice. Each answer keeps its selected voice throughout; changing voices stops playback. The voice test uses the same playback path. Phone speech remains available when OpenAI is disabled, unavailable or offline, with a notice on cloud failure. AI generated speech is disclosed in Settings and the live conversation.

Live audio quality must still be checked on actual devices using the deployment's API access. Automated tests use mocked provider audio and cannot judge pronunciation or naturalness. Redeploy the repository to activate this change on the hosted app.

## Live conversation reliability

The Talk screen supports microphone recording even in browsers without the Web Speech API. Voice controls are checked again after deployment capabilities load, rather than remaining hidden after an early check. Recording requires microphone access over HTTPS (or localhost), server transcription and an available chat model.

Choose **Auto pause** for automatic turn detection or **Tap Send** to finish each question manually. Manual sending works even if the audio meter is unavailable or misses quiet speech. Audio contexts are resumed explicitly, and the noise threshold no longer learns sustained first speech as background noise. If automatic detection is unavailable, the interface directs the user to Send now. The recording ceiling remains 30 seconds per turn.

The microphone closes before transcription and while Grandpa replies. Recorded conversations use tap-to-interrupt to avoid loudspeaker echo and competing microphone captures; browser speech-recognition conversations retain their existing optional voice interruption. The overlay shows when it is processing the recording, preserves useful transcription errors and offers **Retry microphone** after a failure. Transcript and reply text remain in the saved chat.

Mute, Done, backgrounding and cancellation discard pending recordings and abort transcription requests. Late microphone permission grants are released immediately after cancellation. Transcription requests have a 30-second timeout, and permission or quota errors are displayed instead of being reduced to repeated generic network retries.

Validation includes automated lifecycle/quiet-speech/manual-send tests and a Chromium browser flow with simulated microphone input and mocked provider transcription, chat and speech. That flow completed two turns, played provider-format audio, resumed listening, recovered from a denied permission and released all microphone tracks. Real-device permissions, Liberian-accent transcription and live provider playback still require deployment testing.


## Live Talk (two-way voice)

Where the deployment allows it, the Talk screen now works like ChatGPT's voice mode. The browser opens one WebRTC audio connection directly to OpenAI's Realtime API, so Grandpa hears and speaks at the same time. OpenAI's semantic turn detection decides when you have finished, and the browser's echo cancellation stops him hearing himself. You interrupt by simply talking over him, or by tapping the seal. Mute, captions, and Done work as before. The Auto pause/Tap Send choice and Send now are hidden because they don't apply.

The server (`POST /api/live-talk/session`) mints a short-lived key for each conversation, with Grandpa's persona, the recent chat, and saved memories already in the instructions. The real API key never reaches the browser, and audio does not pass through this server. Both your words and Grandpa's spoken replies are transcribed and saved to the chat in order. Replies you cut off are saved up to where you interrupted.

Live audio costs much more than text. Since Phase 1 (see [spending controls](budget-controls.md)), Live Talk is **off unless `ENABLE_LIVE_TALK=true`**. It is offered only when the account lists a realtime model (or `OPENAI_REALTIME_MODEL` pins one), and the cheapest one is used. Each session reserves its worst-case cost for `LIVE_TALK_MINUTES` (default 2) from the $0.10 Live Talk allowance before starting. That reservation is never settled lower, because the session's real usage reaches only the browser. Each conversation ends after `LIVE_TALK_MINUTES`, and the deployment allows `LIVE_TALK_SESSIONS_PER_HOUR` conversations (default 20). On a serverless host Live Talk also requires `ACCESS_CODE`. The audit found no realtime model on the production account, so the standard Talk screen is what visitors use today.

If Live Talk is off, unsupported by the browser, or refused (for example by a quota or model-access error), the app shows the reason and continues with the standard record–transcribe–speak conversation for the rest of the visit.

Validation covers model choice, session configuration and the retry with essential settings, event handling (turn order when transcripts arrive late, voice and tap interruption, mute, failed transcription), and a Chromium run against the real Express routes with a mocked OpenAI and a stand-in WebRTC connection. Real-device audio quality, latency and accent recognition still need checking on the live site with real credit.
