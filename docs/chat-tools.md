# Grandpa chooses his own tools (Phase 1)

In a written chat, Grandpa can now decide on his own to make a picture, write a
document, look something up on the web, or offer to remember a fact about the
person. Before this, those happened only when the typed words matched the
browser's keyword patterns. The patterns still run first and still catch plain
requests ("create an image of a goat") without any paid call. The tools cover
what the patterns miss, such as "send me one" after a talk about rice farming.

## How it works

- `server/chat-tools.js` defines the tools. A turn offers only the tools it can
  really use:
  - `create_image` only when pictures are switched on;
  - `search_web` only when a web-reading model exists and research isn't off;
  - `suggest_memory` only when the browser's memory is on.
- No tools are offered on spoken (voice) turns, on "continue" turns, or in Build.
- `streamChat` (`server/openai.js`) sends the tools and puts each tool call back
  together from its streamed pieces. Nothing runs on the server. Each call
  becomes an `action` event:
  - `image`: the browser draws it through `/api/image`, under the Pictures limit.
    The prompt is the model's full description of the picture, built from the
    conversation.
  - `document`: the browser starts the usual document writer, under the
    Documents limit.
  - `memory`: a "Remember this?" card with **Yes, remember** and **No thanks**.
    Nothing is saved until the person taps Yes. Saved notes stay on the device,
    and you can change them in Settings.
  - `search_web`: handled on the server. The same turn runs again on the
    web-reading model, under the Research limit.
- Every written answer may end with
  `[[followups: question | question | question]]`. The browser hides that line,
  even while the answer is still arriving. It shows the questions as buttons
  under the newest answer, and tapping one asks it. The saved answer never
  contains the line.
- The prompt also asks for one short clarifying question when a request is
  genuinely unclear.

## Cost

- The tool descriptions add about 400 input tokens to each written chat turn,
  and the follow-ups add about 30 output tokens. On the default chat models
  that is a small fraction of a cent per message.
- A second paid call happens only in two cases:
  - Grandpa chooses to search the web;
  - he offers a memory without writing a reply, so the reply is then written.
- All of it counts against the daily limits set on Owner Controls.

## Tests

- `tests/chat-tools.test.mjs` uses a fake OpenAI, so nothing is spent. It covers:
  - which tools are offered;
  - turning tool calls into actions;
  - rebuilding streamed tool calls;
  - the follow-up line;
  - the real `/api/chat` route for pictures, memory offers, web search and
    spoken turns.
