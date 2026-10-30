# Phase 2 Stage 9 — preview security

Generated websites run inside a sandboxed `srcdoc` frame on the app's own page. Three gaps remained (listed as open in `docs/phase2-stage7a-recovery.md`). Each was reproduced in Chromium before it was fixed.

## 1. Runaway loops froze Grandpa AI

**Reproduced:** a sandboxed opaque-origin frame shares the app's main thread. `while(true){}` in a preview froze the whole app, including with every site-isolation flag Chromium offers. The app cannot interrupt the frame from outside.

**Fix:** loop protection, as CodePen's preview does.
- `public/preview-guard.js` parses each preview script with acorn 8.16.0 (MIT, vendored unmodified and minified as `public/vendor/acorn.js`, about 34 KB gzip). It is loaded only when a preview first opens, never at app start.
- Every `for`, `for…in`, `for…of`, `while` and `do…while` body gets `typeof __gpLoop==='function'&&__gpLoop(line);`. Braceless bodies are wrapped in a block, so labels and ASI keep working.
- A small runtime, installed before any project script, measures **continuous main-thread blocking**, not loop counts. The first check in a turn records the time and posts a `MessageChannel` message; that message runs only when the page yields. If the page is still busy after 2.5 s, the check throws a `RangeError`. The loop exits, the reporter shows "Grandpa AI stopped a loop on line N…", and the app stays responsive.
- Timer- or event-paced loops (`await` on a timer) are never stopped, and long but finite work under 2.5 s is untouched. Endless microtask loops (`while(true){await null}`) are caught because they never yield to the channel message.
- A check placed before the body's own `try` cannot be swallowed by it. Scripts that cannot be parsed are left unchanged (the browser reports the syntax error). JSON, template and other non-JavaScript script types are not touched.
- Downloads, GitHub export and published sites use the original source. Only the preview is instrumented.

**Not covered:** inline event-handler attributes (`onclick="…"`), code built from strings (`eval`, `new Function`, blob workers), and memory exhaustion. The browser itself still ends a tab that runs out of memory.

## 2. Pages could leave their preview

**Reproduced:** a script redirect (`location.href = 'https://…'`), an outside form submission or a repeated `location.reload()` replaced the saved page inside the preview. The visitor could then see another site in a frame that looks like their project.

**Fix:** every app-initiated preview load now goes through `setPreviewDocument` in `public/ritual.js`. Any other `load` event on the visible preview frame means the page left its saved document. The app then:
- loads the saved page again and shows "This website tried to leave its page… Outside links open in a new tab";
- after more than three departures within 10 s, pauses the preview instead of reloading forever. Refresh resumes it.

The warning stays visible until the page or project changes. Outside links already opened in a new tab, and the sandbox already blocked navigating the app itself.

## 3. Check results could be forged

**Reproduced by inspection:** the reporter and navigation scripts carried the check ID inside the frame's DOM, where project scripts could read it. They also used the global `parent`, which a page can replace.

**Fix:** both helper scripts remove their own `<script>` element as they run, and they capture `window.parent` before any project code runs. A page can no longer read the check ID, send a "ran" message the check accepts, or intercept the reporter's messages.

Frame reports remain diagnostics. A page can still hide its own errors or alter what the in-frame inspection sees. Production release approval comes from the server-side release gates, never from frame messages.

## Cost and safety

No AI calls, services, budgets, models, admin controls or deployment settings change. The one new asset is the 34 KB (gzip) parser, loaded on first preview. If it cannot load, the preview says so and runs no project code.

## Verification

- `tests/stage9-preview.test.mjs` (9 tests):
  - the parser is required before guarding;
  - all loop forms are guarded and compute the same results, including nested braceless loops and ASI;
  - runaway loops throw, even through an inner try/catch;
  - unparseable and non-JavaScript scripts are untouched;
  - modules parse, and code copied into a worker tolerates a missing guard;
  - the runtime is ordered before project scripts;
  - helper scripts remove themselves and capture the parent;
  - leave-page restore and reload-loop pause.
- Updated existing source-extraction tests to pass the new helpers; no test was skipped or removed.
- Full suite: 733 passed, 0 failed.
- Real Chromium, real `public/` modules (10 checks):
  - four kinds of endless loop stopped with the app still responsive (including an async microtask loop and one that catches its own errors), plus the same loop in restricted mode;
  - an unguarded control loop freezes the app, proving the test is meaningful;
  - a legitimate 2-second async loop and a 3-million-step loop are not stopped;
  - a page cannot read the check ID or capture reporter messages by replacing `window.parent`;
  - real errors are still reported.
- Real app through the Stage 7A QA harness (392 px phone viewport, 4 checks): an endless loop doesn't freeze Grandpa AI; a redirect is caught and the saved page restored; a page that leaves on every load is paused; a normal page previews with no warning.
- Stage 7A phone regression at 320/390/392/1440 px: same results as the live version.
- `npm run build` (production Nitro build) succeeds and publishes `preview-guard.js` and `vendor/acorn.js`.
- Not tested: a physical phone, Safari or Firefox.
