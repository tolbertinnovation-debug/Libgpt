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

## Editing the page by hand (done)

The owner asked to be able to edit the preview directly: click and type, add or change pictures, move parts of the page. Every change must be saved.

**Done: steps 1–2, Edit mode and text** (`public/visual-edit.js`)

- **Edit / Done** in Preview. While editing, the page's own scripts and links are paused, so a tap means "edit this".
- **Exact edits.** Every element in the page's source is located by position (a small HTML reader that matches how browsers close `<li>` and `<p>` by themselves), and the preview copy is numbered with `data-gp`. An edit replaces only that element's content in the real file, so formatting, scripts and everything else are untouched.
- **Tap any text and type.** Headings, paragraphs, links, buttons, list items and so on can be edited. Enter finishes one-line text and Escape cancels. A small bar offers **Bold**, *Italic* and **Link**.
- **What is typed is cleaned** to text and simple formatting. Scripts, event handlers, `javascript:` links and pasted blocks are removed.
- **Saving.** Each edit is saved straight away as a named version ("Before: you edited index.html"), so Undo, Compare and Restore work. **Done** adds one chat message with **Undo**.
- **Safety.** The preview only accepts well-formed editor messages from its own frame.

**Done: step 3, pictures**

- **Tap a picture** to open its menu:
  - **Replace** it with a photo from your phone (resized for the web and added to your files) or with another picture already in the site;
  - choose a **size**: small, medium, large or full width (the height keeps its shape);
  - add a **description** for people who cannot see it;
  - **Remove** it.
- **"+ Picture"** in the text bar adds a picture straight after that text, on its own line with the same indent.
- **Only that picture's tag changes** in the file. Its other attributes and style rules are kept, and a removed picture takes its empty line with it.

**Done: step 4, moving, copying and deleting parts**

- **Selecting a part.** Tap around a part (a card's edge, a section's background), or tap text and press **⇅ Move**. The part gets an orange outline and its own bar: **↑ Up**, **↓ Down**, **Copy**, **Delete**, **Bigger** (select the part around it, for example from a chip to the whole list) and **✕**.
- **Moving and copying.** Moving swaps the part with its neighbour inside the same section, and copying puts a copy straight after it. In both cases, the part being worked on stays selected after the page reloads, so it can be moved again at once.
- **Deleting.** Deleting a part removes its line too. Large parts ask first, and everything can be undone after **Done**.
- **Exact source.** All of this happens in the real source text, keeping indentation. The page itself, html/head/body, can never be moved or deleted.

**Done: step 5, checks after Done**

- **Checks run automatically.** After **Done**, the free preview checks run first (missing pages or files, empty pages, phone and desktop errors). If they pass, Grandpa looks at the page on a phone screen (Phase 4).
- **Nothing is changed on its own.** These are the person's own edits, so any problem is listed in the chat with **Ask Grandpa to fix this (your edits are kept)**. That runs a focused fix told to keep every text, picture and order edit exactly as it is.
- **The bars stay out of the way.** The editing bars (B / I / Link / + Picture / ⇅ Move, and the part bar) sit at the bottom of the screen like a keyboard toolbar, so they never cover the text you want to tap next.

## Rich websites: photographs, video, animation, backgrounds

The owner asked that every website include what it needs: images, video, animation design and good backgrounds.

- **One design standard for every builder** (`server/design-standard.js`). The single builder, the engineering team's planner and every team builder all work to it:
  - design tokens as CSS variables;
  - a full-width hero with a rich background (layered gradient, SVG pattern, or a photo under a dark overlay with readable contrast);
  - alternating section backgrounds, cards and inline SVG icons, and a responsive layout;
  - tasteful motion: reveal on scroll with `is-visible`, hover lift and smooth scrolling, all inside `prefers-reduced-motion: no-preference` and never hiding content;
  - a proper footer and favicon.
- **The team plan carries the look.** The planner's shared contract must fix the tokens, hero and section backgrounds, motion classes and the list of photographs, so the whole team produces one consistent design.
- **Photographs are created for you.** Builders write `<img src="images/name.jpg" data-picture="description">`. After the files are saved, the app creates those photos with Muse Image, from the owner's Pictures allowance:
  - at most six per build, 1280 px and about 180 KB each;
  - this happens after a cloud build, after a build on the phone and after each change;
  - a "Create the photographs this site needs" chip appears when any are pending;
  - until then they count as pending, not broken links;
  - the person's own pictures always come first, and any photo can be replaced by tapping it in Preview → Edit.
- **Video.** Only video the person supplies is used: a file they added (as a muted, looping background or section video) or a YouTube or Vimeo link (a privacy-friendly embed in a 16:9 frame). No video or picture address is ever made up.
- **The conversation before building** now asks about logo, photos and video, and says Grandpa will create photos if they have none.

## Professional features plan

The owner approved this order: A design, B publish on Grandpa, C database, D management, E business tools, F documents, G quality and security.

### Phase A: more design features (done)

- **The Grandpa Kit** (`public/kit/grandpa-kit.css` and `grandpa-kit.js`, about 18 KB, works offline). It is added to every project once, before a build or change, as `assets/grandpa-kit.*`. Builders are given its guide (`KIT_GUIDE`) and only a one-line note instead of its source, and only the kit itself can replace it. It provides:
  - five **style presets** (`data-gk-style`: modern, bold, elegant, friendly, corporate) and **dark mode**;
  - an animated or photo or video **hero**, sections, cards with icons and buttons;
  - **reveal on scroll**;
  - a **gallery with a full-screen viewer** (arrows, keys, swipe) and a **slider** (dots, arrows, swipe, auto-advance);
  - **FAQ**, **prices**, **opening hours**, **team**, **map** (OpenStreetMap) and **video embeds**;
  - a **WhatsApp button**, **back to top**, **counters**, a **page loader** and the **year**;
  - a **language switch** for English, French and Liberian English.

  All motion respects reduced-motion settings, and content is visible without JavaScript.
- **The conversation before building** asks for the style preset and the languages.
- **+ Section in Edit.** Select a part, then tap **+ Section**: services with icons, gallery, slider, prices, questions, opening hours, map, numbers, call to action, or WhatsApp. The section goes after the selected part and the kit is linked into the page. Its photographs are created when you tap **Done**, and then the checks run.

### Phase B: publish on Grandpa (done)

- **Publish on the web** (a chip after every build). Choose an address (suggested from the project name) and get `https://libgrandpaai.com/s/<address>/`, with a **QR code**, **Copy link**, **Share** and **Open**. The free checks run first, and pending photographs are created. After you change the site, the chip reads **Update the published website**. **Take the website down** removes it.
- **Storage** (`server/site-store.js`). Sites are kept in the app's existing database (`grandpa_ai_sites`), or in memory on a local server. There are at most 150 files and 4 MB per site; files a browser cannot open (programs) are left out; at most 100 new sites a day. Publishing needs the access code.
- **Ownership.** Publishing returns a private token, kept on the phone that published, and only that phone can update or remove the site. The owner can list and take down any site (`/api/admin/sites`).
- **Safety.** Sites are public and served with `Content-Security-Policy: sandbox …` without `allow-same-origin`. Every published page therefore runs in an opaque origin and **cannot read the app's storage, cookies or access code**, whatever its scripts do. A browser test confirmed the page was blocked. `nosniff` is set too. Pictures are served as real images, and `/s/name/about` finds `about.html`.
- **Later (needs approval):** your own domain (for example fixpoint.lr) or a separate sites domain.

### Phases C and D: Grandpa Data and Manage (done)

- **Forms that save.** Every published page gets a small Grandpa script (`server/site-runtime.js`), served at `/s/<address>/_grandpa/site.js` and placed first in `<head>`. Forms marked `data-gk-form="message|booking|order|signup"` are sent to `POST /api/site-data/<address>`. Visitors see a thank-you message and the form clears.
  - **Visitors can only send, never read.** The address answers any origin (published pages have an opaque origin), never uses cookies, and accepts plain HTML forms too.
  - **Spam protection:** a hidden field only robots fill in, a too-fast check, at most 30 fields and 10,000 characters a form, 120 requests a minute per visitor, 300 forms a day per site, and 3,000 kept per site.
- **Manage** (`/manage/<address>`, `public/manage.js`), on the app's own address, outside the site sandbox:
  - **Inbox:** messages, bookings, orders and sign-ups with filters. Mark done or new, WhatsApp, Call, Email, Delete, and **Export to Excel (CSV)**. Cells that could run as formulas are made plain text.
  - **Prices & text:** Manage reads the site's pages and finds what can be changed:
    - single texts marked `data-gk-text="key"`;
    - lists marked `data-gk-list="name"`, with items `data-gk-item` and parts `data-gk-field`.

    The owner edits, adds, removes and reorders rows. The Grandpa script shows the saved version on the next page view, with no rebuild. An empty text is hidden.
  - **Visitors:** page views for the last 14 days. No names, addresses or cookies are kept.
  - **Settings:** the publishing phone sets a **passcode** (6–64 characters, stored with scrypt) so the business owner can sign in on their own phone.
    - Sign-ins last 30 days.
    - After 8 wrong passcodes, sign-in pauses for 15 minutes.
    - Changing the passcode, or **Sign everyone else out**, ends the other sign-ins.
    - People who signed in with the passcode cannot change it.
- **Opening Manage.** Build → Publish on the web → **Manage** opens it with the publishing phone's key in the address fragment, which never reaches a server. The key is then kept on that phone.
- **Storage.** The app's existing database: `grandpa_ai_site_entries` and `grandpa_ai_site_admin`, or memory on a local server. Taking a site down removes what it collected.
- **Builders know it.** `KIT_GUIDE` tells every builder to write forms with `data-gk-form`, and to mark prices, menu, products, hours and notices for Manage. The conversation before building asks what visitors should be able to send.
- **Grandpa Kit 2** adds form styles. It also explains in Build's preview that forms work once the site is published, and older projects get the new kit automatically.
- **Cost:** no new service. Each page view makes one small database read and write.

### Phase F: documents (done)

- **A copy for the visitor.** After an order or booking is sent, the visitor sees a **reference** (8 characters) and a **Save a copy (PDF)** button. It prints a clean receipt page (business name, reference, date, what they sent), which the phone's print screen saves as a PDF. Any form can offer this with `data-gk-receipt`. A plain HTML form's thank-you page shows the reference too.
- **Invoices and receipts in Manage.** Each inbox entry shows its reference and an **Invoice / receipt** button. It opens an editor with a live preview:
  - number (`INV-` or `RCT-` plus the reference), date, the business name and contact line (remembered on that phone), and currency (LRD by default);
  - the customer (filled from the form), item lines with quantity and price, the total, and notes.

  **Print or save as PDF** prints only the document. The CSV export has a Reference column too.
- **Grandpa Kit 3:**
  - a **document list** (`.gk-docs`) for downloads;
  - **printable documents** (`.gk-doc`, `.gk-certificate`) with `data-gk-print="#id"`, which prints only that part, or the whole page without a value;
  - print styles that hide menus, buttons and effects.

  Older projects are moved to Kit 3 automatically.
- **+ Section** has **Documents to download**, and the **Opening hours** section is now editable in Manage.
- **Policy pages.** Builders write `privacy.html` for any business site with a form, and `terms.html` and `refunds.html` when it sells or takes orders or bookings. They are linked in every footer and written in plain, honest words (no invented laws or guarantees), with "Last updated". Sites without a privacy page get a one-tap chip, **Add privacy, terms and refund pages**.
- **Cost:** none. PDFs are made by the phone's own print screen.

### Next: Phase E (business tools), then G (quality and security).
