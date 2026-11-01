# Build: making the coding feature work like ChatGPT and Claude Code

The aim is the loop good coding assistants follow:

1. **Understand** the request.
2. **Plan.**
3. **Make small, exact changes.**
4. **Check** the result.
5. **Fix** what is wrong.
6. **Say plainly** what changed.

Everything happens through the Build chat, on a phone.

## What already works

- **A conversation before the first build.** Grandpa asks questions, then shows a "What I'll build" brief and waits for *Start building* (PR #103).
- **An engineering team for the first build.** It plans, sets the architecture, writes the files, reviews them, and runs phone and desktop preview checks.
- **Fixes in your own words after the build** (PR #104). The real problems found by the preview checks are sent with the request, and one automatic repair follows if a check still fails.
- **Pictures, text and documents added through the chat** (PR #105).

## Problems seen on the live site (fixed in phase 1)

The owner's screenshots of "Add the logo" on the FixPoint site showed three problems:

| What happened | Why | Fix |
|---|---|---|
| The code for `assets/app.js` appeared as chat text, and the logo never reached the site | Meta's model put the opening of the code block on the same line as its sentence ("…header now.```js path=…"), so the app did not see a file | The app now accepts a code block that starts mid-line or ends glued to the last line of code |
| "The file being edited is too large…" / "File context needed" | The cloud builder was sent the logo's picture data (hundreds of KB of text) as if it were code | Pictures and documents are now described to the model in one short line (their path and size), never sent as data. This applies in the browser, the cloud builder, and when choosing which files the cloud builder needs |
| The logo was added by JavaScript that edited the page after it loaded | The model had to rewrite whole files, so it patched instead | Changes now use **edit blocks**, which replace only the exact lines named, like Claude Code. The page itself is changed |

## Phase 1: reliable, exact changes (this PR)

- **Edit blocks.** Each one names a file, then pairs of lines to find (SEARCH) and their replacements (REPLACE):

  ```text
  ```edit path=index.html
  <<<<<<< SEARCH
  exact current lines
  =======
  new lines
  >>>>>>> REPLACE
  ```
  ```

  - They are applied to the latest version of the file.
  - Exact text is tried first, then the same lines ignoring indentation.
  - If the text is missing, or appears in more than one place, nothing is changed on a guess.
  - If an edit does not match, Grandpa automatically asks again once, for those files written out whole.
- **Whole files** are still used for new files and full rewrites.
- **Code blocks** are recognised even when glued to a sentence.
- **Pictures and documents** are never sent to the model, and never overwritten.
- **The chat explanation** is one to three plain sentences, with no code pasted into the chat.

## Phase 2: a visible plan and step-by-step work (done)

- For larger requests, Grandpa first shows a short **to-do list**, for example: "1. Add logo to header. 2. Make the menu work on phones. 3. Check every page." He ticks each item as it is done, like Claude Code's task list.
- **Read before editing.** The model can ask to see a file it needs instead of receiving every file every time. This keeps big projects within limits and makes edits more precise.
- **A change card per turn.** It shows which files changed and the lines added or removed, with **Undo** (restore the version before this turn) right in the chat.

How it works now:

- **Deciding whether to plan.** A small request runs at once. A longer one, or one with several parts ("…and also…", new pages, a gallery, a form, every page), first calls `POST /api/build/steps` (`server/build-steps.js`). That returns two to six steps, each naming the files it needs, checked against the real files.
- **Running the plan.** The plan appears as a to-do card. Each step runs as its own focused change and shows ◐ while working, ✓ when done and ✕ if it fails; steps after a failure are marked skipped. The preview checks, and one automatic repair, run after the last step.
- **Reading files on demand.** A focused step gets its own files in full, plus any small file. Larger files appear as a one-line note. If the builder writes ```` ```read path=… ```` it is sent the file and the step runs again.
- **Undo.** The latest change has **Undo this change**; a finished plan has **Undo all N steps**. Either restores the saved version from before, and added pictures are kept. Older versions remain under History.

## Phase 3: remembering the project

- **A project summary** is kept with the project and sent with every turn: its purpose, pages, colours, fonts, the main selectors and the files the person added. Grandpa then stays consistent across many fixes.
- **Search across files** ("where is the phone number?") without rewriting anything.

## Phase 4: seeing the result

- After each change, a **screenshot of the preview** (phone width) is shown to Muse Spark, which can read images. The model can then catch visual problems that code checks miss, such as overlapping text, a logo that is too big, or unreadable colours, and fix them in the same turn.
- Accessibility and speed checks: missing alt text, contrast, very large images.

## Phase 5: versions and publishing

- A clear history of versions with one-tap restore, and side-by-side **compare**.
- Publishing stays behind the full engineering review, which already runs before release.

## Costs and limits

All coding requests come from the owner's **Build (coding)** allowance in Owner Controls, and run on Meta Muse Spark (high reasoning effort for builds). Preview checks run in the phone's browser and cost nothing.
