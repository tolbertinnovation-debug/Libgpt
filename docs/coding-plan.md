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

## Phase 3: remembering the project (done)

- **A project summary** is kept with the project and sent with every turn: its purpose, pages, colours, fonts, the main selectors and the files the person added. Grandpa then stays consistent across many fixes.
- **Search across files** ("where is the phone number?") without rewriting anything.

How it works now (`public/build-summary.js`):

- **The project summary** is worked out from the files in the browser, so it is free, instant and always current. It covers:
  - the purpose (as first asked);
  - each page with its title and sections;
  - the main colours, CSS variables and fonts;
  - the header or menu classes;
  - the phone numbers and emails on the site;
  - the files the person added (never rewritten) and the other files.

  It goes with every build request as `projectSummary`, and the server adds it to the builder's instructions under "keep every change consistent with it".
- **"What is in my website?"** (a chip after every build) shows that summary in the chat.
- **"Where is…?" questions** are answered from the files with the file and line number, and no AI call. Examples: "Where is the phone number?", "which file has the menu", `find "Book now"`, "where are the prices". Phone numbers, emails, pictures, prices and menus are recognised specially.

## Phase 4: seeing the result (done)

- After each change, a **screenshot of the preview** (phone width) is shown to Muse Spark, which can read images. The model can then catch visual problems that code checks miss, such as overlapping text, a logo that is too big, or unreadable colours, and fix them in the same turn.
- Accessibility and speed checks: missing alt text, contrast, very large images.

How it works now:

- **Taking the picture** (`public/build-look.js`). After a change passes the code checks, the browser draws the page at phone width (390 pixels) into a JPEG. It uses the page's real HTML, its CSS and the person's pictures, with scripts removed, so it costs nothing and needs no service.
- **The review** (`POST /api/build/look`, `server/build-look.js`). The picture goes to Muse Spark with a design-reviewer prompt. The prompt asks only about real, visible problems (overlap, cut-off content, a giant logo, unreadable text, the requested change missing), never taste. The answer is checked, with at most four problems. Only JPEG, PNG and WebP pictures of up to 1.6 MB are accepted, and the route is off where pictures cannot be read.
- **The result in the chat.** The change card shows "Looked at it on a phone screen: it looks right", or what was seen. Problems get one automatic visual repair, which has its own budget separate from the code-check repair, and the page is looked at again.
- **On request.** "Look at it on a phone and fix what is wrong" (a chip after every build) runs the review and repairs what it finds.
- **Cost.** One picture review per change, from the Build (coding) allowance.

## Phase 5: versions and publishing (done)

- **Every change is named.** A version is saved before every change and named after it, for example "Before: Make the heading green". History therefore reads like the chat. Several saves from one change are grouped into one entry (`public/build-history.js` `historyEntries`).
- **The Versions sheet** opens from "See versions" after every build, or from the ⋮ menu. Each entry shows how many files differ from now and when it was saved, with **Compare** and **Restore** buttons.
- **Compare** shows each file that differs, as added, removed or changed. Changed files get a line-by-line diff with a little context: red for the saved version, green for now, ⋯ for unchanged stretches. Pictures are named but not shown as text. From there, **Restore this version** is one tap.
- **Restoring** keeps the version you were on, so a restore can itself be undone. It also invalidates the release review.
- **Publishing** stays behind the full engineering review, which already runs before release.

## Costs and limits

All coding requests come from the owner's **Build (coding)** allowance in Owner Controls, and run on Meta Muse Spark (high reasoning effort for builds). Preview checks run in the phone's browser and cost nothing.

## Editing the page by hand (in progress)

The owner asked to be able to edit the preview directly: click and type, add or change pictures, move parts of the page. Every change must be saved.

**Done: steps 1–2, Edit mode and text** (`public/visual-edit.js`)

- **Edit / Done** in Preview. While editing, the page's own scripts and links are paused, so a tap means "edit this".
- **Exact edits.** Every element in the page's source is located by position (a small HTML reader that matches how browsers close `<li>` and `<p>` by themselves), and the preview copy is numbered with `data-gp`. An edit replaces only that element's content in the real file, so formatting, scripts and everything else are untouched.
- **Tap any text and type.** Headings, paragraphs, links, buttons, list items and so on can be edited. Enter finishes one-line text and Escape cancels. A small bar offers **Bold**, *Italic* and **Link**.
- **What is typed is cleaned** to text and simple formatting. Scripts, event handlers, `javascript:` links and pasted blocks are removed.
- **Saving.** Each edit is saved straight away as a named version ("Before: you edited index.html"), so Undo, Compare and Restore work. **Done** adds one chat message with **Undo**.
- **Safety.** The preview only accepts well-formed editor messages from its own frame.

**Next:** step 3 (pictures: replace, size, remove, add), step 4 (move, duplicate, delete parts), step 5 (checks after Done).
