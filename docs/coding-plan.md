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

### Phase E: business tools (done, without recurring costs)

- **Bookings at set times.** In Manage → **Shop & bookings**, the owner switches bookings on and chooses:
  - booking days, opening and closing times, and the length of each booking (15 minutes to 2 hours);
  - people per time, how many days ahead, and closed dates.

  On the published site, a booking form (`data-gk-form="booking"` with `date` and `time` fields) limits the date to that window. It offers only the times still free (from `GET /api/site-slots/<address>?date=`), with "n left" when more than one person fits.

  The server refuses a time the owner did not open, and a full time is never booked twice: the count is checked inside the same database lock as the insert. **Cancel booking** in Manage frees the time. **Upcoming bookings** lists bookings by day, and the inbox gains a Cancelled filter.
- **Cart and orders.** `data-gk-add` buttons in list items (name and price from `data-gk-field`) fill a cart, which stays while the visitor moves between pages (`window.name`, which works in the sandbox).
  - A cart button shows the count and total.
  - Checkout asks for name, phone, address and a note, and shows the owner's **payment** and **delivery** instructions (pay on delivery or mobile money, as the owner writes it).
  - The order arrives in Manage with its items and total, and **Invoice / receipt** fills the lines from it. The visitor gets the reference, the payment instructions and a PDF copy.
- **Search.** `input[data-gk-search]` filters the page's cards, list items, FAQ and documents.
- **SEO.** Published pages get the tags they are missing:
  - a description from the first paragraph;
  - Open Graph title, description, URL and picture (the hero photo or first image);
  - a Twitter card and a canonical address.

  `/s/<address>/sitemap.xml` lists the pages, unless the site has its own. Builders write a unique title and description per page, one h1, alt text and `lang`.
- **Grandpa Kit 4** adds search-box styles and explains in Build's preview that the cart works once published.
- **Needs approval later (recurring costs):** email or SMS alerts for new orders and bookings; real mobile-money or card payments (merchant accounts).

### Phase G: quality and security (done)

- **Quality check before publishing** (`public/publish-quality.js`). It is free, instant, runs on the phone, and changes nothing by itself. It appears in the publish sheet before and after publishing, with a score for each area and the problems listed, **Fix** first:
  - **Accessibility:** page language, phone screen setting, a main heading, picture descriptions (alt), form labels, buttons and links without words, frames without titles.
  - **Speed:** pictures over 400 KB, videos over 8 MB, a site over 3 MB.
  - **Security:** forms that send to email or another site, password or card fields, `http:` resources browsers block, scripts from outside sites, embeds from unknown sites, `javascript:` links, and forms without a privacy page.
  - **Search:** page title, description, more than one h1.
- **One tap to fix.**
  - **Ask Grandpa to fix these** sends the list as a change request that keeps the design.
  - **Make the large pictures smaller** shrinks photographs on the phone (about 1600 px, under 300 KB), keeping their names, as a version that can be undone. A 1.3 MB photo became about 250 KB in the browser test.
- **Backups.** Manage → Settings → **Download all website data** saves one file with everything visitors sent, the prices and text, booking and shop settings, and visitor counts (`GET /api/manage/<address>/export`, owner only). **Restore prices, text and settings** puts them back from that file, without touching what visitors sent.
- **Security review of the data features:**
  - The Manage page can never be framed (`X-Frame-Options: DENY`, `frame-ancestors 'none'`), so a published site on the same host cannot overlay it.
  - Published sites get a `Permissions-Policy` that turns off camera, microphone, location, payment, USB and serial ports (Bluetooth was dropped: Chrome does not recognise it in this header and logs an error).
  - Email links in Manage are encoded. The cart dialog moves focus properly.
  - Confirmed as before:
    - visitors can only send;
    - reading needs the publishing phone's key or the passcode (scrypt, with a lockout after wrong tries);
    - everything Manage shows is built as text;
    - CSV cells cannot run as formulas;
    - published pages run in an opaque-origin sandbox.
- **Speed of the data features.** Forms, sign-in and Manage now read only a site's name, key and page list (`siteStore.meta`), instead of loading the whole website (up to 4 MB) from the database on every request.

## Free photographs and YouTube videos (no keys, no money)

The owner asked for videos with a proper player, and for photos to be found and placed when building, without money.

- **Free real photographs** (`server/media-search.js`). After every build or change, each `<img data-picture>` is first matched with a real photograph:
  - It searches **Wikimedia Commons**, with **Openverse** as a quick backup. Only licences that allow business use are accepted: CC0, CC BY, CC BY-SA and public domain.
  - Photos must be at least 700 px wide; SVG, TIFF and GIF files are left out.
  - The builder writes `data-photo-search="2–4 words"` for this. Without them, words are taken from the description.
  - The photo is downloaded by its id (never by an address the browser sends), made web-sized on the phone (1280 px, about 180 KB), and its credit is saved.
  - `credits.html` lists every photographer and licence, and a **Photo credits** link is added to every footer.
  - A photo is **created with Muse Image only when no free one is found**, and only while the owner's Pictures allowance is above 0. With it at 0, nothing is ever paid for.
- **Edit → tap a picture → Or find a free photograph.** Search by words, see small previews, and tap one to use it. The credit is added automatically.
- **YouTube videos, embedded and never copied.**
  - The builder writes `<a class="gk-player" href="…watch?v=ID" data-youtube="ID">` for a link the person gave.
  - Where a video would help and none was given, it leaves a place: `<div class="gk-player" data-video-search="…">`, at most two per site.
  - After the build, every player is checked with YouTube's free **oEmbed**. It gets its real title and channel, and a video whose owner does not allow embedding is taken out with a note.
  - Each empty place gets a card in the chat: **Find on YouTube** (opens a YouTube search), a box to paste the link, **Use this video**, and **No video here**.
  - **+ Section** has a **Video** section too.
- **The player** (Grandpa Kit 5):
  - a poster picture, a ▶ button, the title and channel; several videos go in a `.gk-videos` grid;
  - nothing loads from YouTube until someone taps play;
  - on a normal page it plays in place with YouTube's privacy-enhanced player.
- **Published sites.** A browser test showed YouTube's player stays a black box inside the published sites' sandbox, while it plays on a normal page. So inside the sandbox, tapping the player **opens the video on YouTube** (the app on a phone), and the caption says "Tap to watch on YouTube". Older YouTube embeds the builder wrote are turned into players the same way.
- **Limits:** at most 600 free searches a day across the app, the usual rate limit, and results remembered for a day.

## Engineering Playbook: Phases 1 and 2 (done)

The owner asked for stronger coding, so that Grandpa can choose how to build any website or web software and make it beautiful and professional.

- **Phase 1, project recipes** (`public/build-recipes.js`, shared by the browser and the server). There are 14 recipes:
  - business, restaurant, shop, booking, portfolio, church/school/NGO, event, landing page, blog, web tool, game, dashboard or tracker, course or docs, and phone app.
  - Each recipe sets the pages and screens, the sections and components, the data features (forms, bookings, cart, Manage lists), the engineering (app state, screens, game loop, honest limits of the sandbox) and the design direction.
  - It is chosen from the person's words. On ties the more specific recipe wins, and business is the last resort.
  - The conversation card shows **Type of project** with a menu to change it. The chosen type is sent as "Project type: …", which always wins.
  - The single builder, the team planner and every front-end team builder receive the recipe. The backend and cloud builders do not.
- **Phase 2, Grandpa Kit 6.**
  - Design tokens: a fluid type scale (`--step--1` … `--step-5`), an 8px spacing scale (`--s-1` … `--s-9`), and brand and accent shades computed with `color-mix()`.
  - Button text colour chosen in code for contrast (`--on-brand`, `--on-accent`).
  - Eight free font pairings (`data-gk-fonts`), loaded by the kit, with system fonts when offline.
  - New components:
    - an eyebrow label and badge;
    - a sticky header with a real phone menu (aria-expanded, Escape, and the current page marked);
    - testimonials, steps, timeline, tabs with arrow keys, a popup (`<dialog>`), a logo strip and a stats band;
    - product cards and article cards;
    - a phone-app bottom bar.
  - **Design rules** for every builder: tokens only, 60-30-10 colour, WCAG AA, at most two fonts, 60–75 character lines, an eyebrow, heading, lead and one primary action per section, consistent radius and shadow, image sizes against layout jumps, and 44px touch targets.
  - **+ Section** gains testimonials, How it works, Our story (timeline) and Sign up for news.
- **Phase 3, real software (done).** Kit 7 adds `assets/grandpa-app.js`, the **app toolkit**, protected like the rest of the kit and shown to models only as a note. It has no build step and no outside services. It provides:
  - **State:** `App.store` with listeners; `remember` keeps data on the device, or for the open tab inside the published sandbox, where localStorage is blocked.
  - **Safe rendering:** `App.html` escapes every value, and `App.render` puts it on the page.
  - **Screens:** `App.screens` with `data-screen` sections and the `.gk-appbar`.
  - **Forms:** `App.form` gives friendly messages beside each field, with room for them reserved so a message never moves the button being tapped. Fields are read with `namedItem`, so a field called "item" works.
  - **Data:** `App.table` with search and sort, accessible SVG `App.chart` (bar, line or pie), `App.csv` export, and `App.format` for money, numbers, dates and percent.
  - **Games:** `App.loop` (pauses when the page is hidden), `App.sound`, `App.timer` and `App.toast`.

  The tool, game, dashboard and phone-app recipes tell builders to use it, and `KIT_GUIDE` documents it. A **Download as ZIP** chip now sits next to the other build chips; the ZIP itself already existed.
- **Phase 4, professional extras added automatically (done).** Every published page gets the following, unless it has its own:
  - an **app icon** (`/s/<address>/_grandpa/icon.svg`): the first letter of the name on the site's brand colour, read from its own stylesheet, with a contrast-chosen letter colour;
  - an **install file** (`manifest.webmanifest`: name, colours, icon, start address) and `theme-color`;
  - **structured data** (schema.org JSON-LD), from what the page itself says: `<address>`, `tel:` and `mailto:` links, and `.gk-hours`. It is LocalBusiness when there are local details and Organization otherwise; nothing is invented.
  - a **share picture**: when the site has no photograph, publishing draws a 1200×630 PNG on the phone (name, first heading, brand colour) as `images/share.png`, and it becomes the og:image;
  - a **"page not found" page**: the site's own `404.html` (with the Grandpa script), or one in its brand colour with a button home.

  The builder guide asks for addresses in `<address>`, `tel:`/`mailto:` links, and the builder's own JSON-LD (Restaurant, Event, Product, Course) only with details the person gave.
- **Phase 5, a higher quality bar (done).**
  - The free quality check has a fifth area, **Design**, measured from the CSS and never guessed:
    - **colour contrast** for the main text pairs (body, muted, text on dark sections) and every rule that sets both a text and a background colour. Kit defaults are combined with the site's `:root` overrides, `var()` is resolved, a rule is flagged under 4.5:1 and marked Fix under 3:1, and backgrounds it cannot read are not guessed;
    - more than three fonts, more than 14 colours, and more than 18 spacing sizes;
    - **layout jumps**: pictures with no width and height, no inline aspect-ratio and no CSS aspect-ratio, listed under Speed.

    Ask Grandpa to fix these includes the Design findings.
  - Grandpa's phone look now also gives a **design score** (1–10) for hierarchy, spacing, contrast, consistency and pictures. Below 7 it gives up to three concrete improvements, which join the existing single automatic repair as "Design: …". The chat shows "Design score n/10". The repair path is the one already used for visual problems; it was not run against the paid vision model in testing.
- **Phase 6, published sites on their own address (written; switched on by the owner).** With `SITES_HOST` set (for example `sites.libgrandpaai.com`, added as a domain in Vercel), published sites live at `https://SITES_HOST/<address>/`.
  - **Why it is safe.** A separate address is a separate origin. Grandpa AI's cookies are host-only, and its storage belongs to its own origin, so sites still cannot read them. On that address sites are served without the CSP sandbox (`frame-ancestors 'self'` only). On the app's own address the sandbox stays.
  - **What it unlocks**, verified in a browser:
    - YouTube plays inside the page, where before it showed only a black box;
    - the app toolkit's saved data is kept on the device and survives a reload;
    - the install file's start address matches the page, so "Add to home screen" works.
  - **Nothing else of Grandpa AI** is served on the sites address: the app, its API, Manage and the root all return 404. Only the sites, `/s/…`, and the send-only form and slot addresses are served.
  - **Old links still work.** Visitors opening `libgrandpaai.com/s/<address>/…` are forwarded (301) to the new address. The app's own fetches, such as Manage reading pages, are not forwarded.
  - **Every generated address uses the new address:** the publish result, QR codes, Manage, backups, the sitemap and the canonical and Open Graph tags.
  - Because all sites share one origin there, the app toolkit (Kit 8) keeps saved keys per site.
  - It needs no money: the subdomain is part of the domain the owner already has.

  To switch it on, add `sites.libgrandpaai.com` under Vercel → Project → Settings → Domains, add the DNS record Vercel shows (a CNAME for `sites`), set `SITES_HOST=sites.libgrandpaai.com` in Environment Variables, and redeploy. (app icon, 404 page, structured data, share picture, manifest), Phase 5 (a higher quality bar with a design score), and Phase 6 (optional: a separate sites address so YouTube plays in the page and apps can install, work offline and remember data).

### Videos found automatically, and played in Build's preview (done)
- **Grandpa finds and places videos himself** when `YOUTUBE_API_KEY` (the free YouTube Data API key, with no payment card) is set in Vercel.
  - After a build, each empty `data-video-search` place is searched on YouTube by the server, so the key never reaches the browser.
  - The search uses strict safe search and asks only for embeddable, syndicated videos. The details call then keeps only public, processed, embeddable videos of at least 30 seconds, ranked by relevance with 1–20 minute videos first.
  - The best video goes into the player automatically. A chat card shows it with up to three **Use: …** alternatives and **Remove**.
  - Results are remembered for a day. There is a daily ceiling of 90 searches (`VIDEO_SEARCHES_PER_DAY`, at most 95, under Google's free ~100), and a used-up quota says so.
  - Without the key, the Find on YouTube and paste-link card remains.
- **Videos play in Build's preview.** The preview's sandbox blocks YouTube, so the kit (Kit 9) sends a checked `play-video` message (an 11-character id and a short title, from the preview frame only), and the app plays it in a **video window** outside the sandbox.
  - The window and the kit's inline player set `referrerpolicy="strict-origin-when-cross-origin"`; without it YouTube shows Error 153.
  - In browser tests, some videos show "Video unavailable" from data-centre computers even on a plain page. That is YouTube's choice for those machines, not the app.
- **On published sites** videos play inline once the sites address (Phase 6, `SITES_HOST`) is set up.

### Phase V: video players (Grandpa Kit 10) (done)
- **Full video player** for the person's own video files: `<figure class="gk-video-player"><video controls …>`.
  - The kit replaces the browser's controls with large ones: play, seek, time, sound, speed, subtitles (only with a `<track>`), picture-in-picture and full screen.
  - It has keyboard keys (space/k, arrows, f, m) and shows a clear message when a video cannot play.
  - Without the script, the browser's own controls stay.
- **Playlists** (`.gk-playlist`): YouTube players and `data-video-src` file entries become one large player with the list beside it (below it on phones). A file that ends plays the next one.
  - A playlist place `data-video-search="…" data-video-count="3"` is filled with up to 4 found videos from one search. Each can still be changed or removed in the chat card.
- **Video library** (`.gk-video-library` with `data-category`): search and category buttons.
- **Video player apps:** `input[data-gk-video-file]` plays videos chosen on the visitor's device (object URLs; nothing is uploaded).
- **New recipe:** "Video or media website (video library, playlists, video player)". The kit guide and design rules teach builders the players; builders are told a video file is a video, not a download.
- **The person's own clips:** `.mp4`, `.m4v` and `.webm` become `videos/…`, limited to 2.5 MB.
  - A site holds at most 4 MB of text, stored as base64, which is a third larger. Vercel also caps a request at 4.5 MB.
  - Longer videos belong on YouTube, and the message says so.
- **Published sites send videos and sound in parts** (HTTP Range, 206). Safari plays video only this way, and seeking needs it (verified in Chromium: seeking failed without it).
- **Build's preview** resolves `<video>`, `<source>`, `<track>`, `poster`, `data-video-src` and `data-poster` paths, so the person's videos play in the preview.
- **Quality check:** a video that plays with sound by itself must be fixed. It also warns about a video with no controls and about video files over 2 MB.

### Phase A1: installable apps, only for apps and web apps (done)
- **Only what the person made as an app or web app becomes an app.** Ordinary websites stay websites, as the owner asked.
  - An app is a project of type Phone app, Web tool, Game or Dashboard, or one where the person said "app" (`public/build-app.js`, `wantsApp`).
  - The publish sheet shows an **Installable app** choice (only once `SITES_HOST` is set up), ticked from that guess. The person's choice wins.
  - Build marks the published home page with `<meta name="grandpa-app" content="yes">`. The project's own files are not changed, and no database change is needed.
- **On the sites address an app gets:**
  - an install file that opens it in its own window (`display: standalone`). A website added to a home screen opens in the browser (`display: browser`);
  - an **offline helper** (`/<address>/_grandpa/sw.js`):
    - saves every file of the app (not videos);
    - pages come from the network when there is one, so updates arrive, and from the saved copy offline;
    - an unknown page offline says so;
    - forms and orders always need the network;
    - each publish is a new version that replaces the saved copy;
  - a **Get the app** page (`/<address>/_grandpa/app`) with the icon and name, and an **Install the app** button whenever the browser offers to install. It also gives steps for the visitor's device (Android, iPhone and iPad, Windows, other computers), a link to open it in the browser, and a QR code.
- **In Build,** a published app's sheet shows the Get the app link, a QR code (`/api/sites/<address>/qr.svg?app=1`) and Copy app link, with a note to test on your own phone.
- **The Phone app recipe** no longer asks builders to write a manifest; Grandpa adds the install support itself.
- **Verified in Chromium against the real server:**
  - the helper takes control and Chrome's installability check reports no errors;
  - offline, the app's pages and styles open and an unknown page shows the offline message;
  - the Get the app page shows the right steps for Android, iPhone and Windows;
  - the Install button appears only when the browser offers it, and opens the browser's install dialog;
  - a published website gets none of this.
- **Not verifiable in a headless browser:** Chrome's own install offer, which needs a real device and some use of the page. Test on a phone.

### Phase A2: Android app download (.apk) for apps (done)
- **Every published app** (Phase A1 apps only, never ordinary websites) gets `https://SITES_HOST/<address>/_grandpa/app.apk`. It is linked from the Get the app page (Android card, with install steps; other devices get a link for sending it to a phone), from Build's publish sheet (**Android app (.apk)**), and in the publish result (`apkUrl`).
- **The app** (`android/shell`, plain Android with no libraries, minSdk 24 / Android 7.0, targetSdk 34):
  - It opens the app's published address full screen in a WebView, so every update the owner publishes reaches installed phones without a new download, and the Phase A1 offline helper keeps it working offline.
  - Pages of the app stay in the app; other links open in the phone's browser.
  - File choosers work (video and photo pickers), videos can go full screen, and Back goes back.
  - A first start without internet shows a clear message with Try again.
  - The page gets no access to the phone beyond what a browser allows (no JavaScript bridge).
- **How it is made, with no Android tools on the server and nothing paid** (`server/android-app.js`):
  - The template APK (15 KB, `server/android/shell-apk.js`) is built once by `scripts/android-shell/build.sh` with Google's free build-tools 35.0.1 and android-35. The checksums were checked against Google's repository index.
  - For each app, the server rebuilds the manifest's string pool with the app's own package name (`com.grandpaai.app.s_<address>`) and name. It draws the icon (the first letter on the brand colour) at five sizes from Inter Bold outlines (SIL OFL; `server/android/glyphs.json`, from `scripts/android-shell/glyphs.py`), and writes `assets/app.json` with the address.
  - It then re-zips with stored entries 4-byte aligned and signs with **APK Signature Scheme v2**.
  - Each version is cached in memory per app.
- **The signing key** is made by the server the first time it is needed: RSA 2048, with a self-signed certificate "Grandpa AI apps" valid 30 years.
  - It is sealed with AES-256-GCM, using a key derived (HKDF) from `APP_SIGNING_SEAL_KEY` if set, otherwise the database connection secret. It is kept in `grandpa_ai_site_secrets`; it is never shown, logged or sent anywhere.
  - All apps share it, so a newer .apk installs over an older one.
  - If the sealing secret changes, the key can no longer be opened and downloads fail with a clear error rather than silently making a new key, which would stop updates installing over old copies.
- **Verified:**
  - Google's `apksigner verify --min-sdk-version 24` says "Verifies (v2 scheme)", `zipalign -c 4` passes, and `aapt2 dump badging` shows the app's own package name, label, icons, minSdk 24 and the INTERNET permission only;
  - `dexdump` shows the app code;
  - tests re-check the v2 signature from the specification on every run, and a changed byte breaks it;
  - every app has the same certificate, and websites get no .apk.
- **Not verifiable here:** installing and opening it on a phone (no Android emulator without hardware acceleration). Test on a real Android phone.
- **What people will see:** Android asks to allow installing apps from the browser, and may say the app is not from the Play Store. The Play Store needs Google's paid developer account, which is not used.

### Phase A3: Windows app download (.exe) for apps (done)
- **Every published app** (never ordinary websites) gets `https://SITES_HOST/<address>/_grandpa/app.exe`. It is linked from the Get the app page (Windows card, with honest SmartScreen steps), from Build's publish sheet (**Windows app (.exe)**), and in the publish result (`exeUrl`).
- **The program** (`windows/launcher/launcher.c`, 64-bit, 175 KB):
  - When opened, it asks "Install <app> on this computer?". Yes adds Start menu and desktop shortcuts that open the app in its own Microsoft Edge window (`--app=<address>`; Chrome if Edge is missing, otherwise the default browser), with the app's icon. Then it opens the app.
  - It copies nothing, changes no settings, never asks for administrator rights (`asInvoker` manifest), and keeps ASLR, DEP and high-entropy addresses on.
  - To remove the app, delete its shortcuts.
  - It opens only a plain https address of printable characters.
  - A damaged or incomplete file says so and stops.
- **How it is made, with no compiling on the server and nothing paid** (`server/windows-app.js`):
  - The launcher is built once with the free MinGW-w64 cross-compiler (`scripts/windows-app/build.sh`, `-Wall -Wextra -Werror`) and committed as `server/windows/launcher-exe.js`.
  - For each app, the server redraws the program's own icon images in place (32-bit BMP images of fixed size, 16–128 px, the same letter-on-colour icon as Android). It then appends `url=`, `name=`, `slug=`, an .ico file (PNG images, 16–256 px) and a 16-byte footer (`GPAPP001`, sizes).
  - Each version is cached in memory per app.
- **Verified under Wine 9:**
  - the program reads its details;
  - with Edge registered, it finds it;
  - `--install-quiet` writes `%LOCALAPPDATA%\Grandpa AI apps\<address>\app.ico` and both shortcuts. The desktop shortcut's target is msedge.exe with `--app="https://…"` and the app's icon;
  - a truncated file exits with an error.
- **Tests** check that only the icon images change in the program, the details as the launcher reads them, unsafe addresses refused, the PE flags and the asInvoker manifest, and the server routes.
- **Not verifiable here:** a real Windows 10/11 PC with Edge and SmartScreen. Test on a Windows computer.
- **What people will see:** SmartScreen's "Windows protected your PC" (More info → Run anyway), because the program is not code-signed; signing needs a paid certificate, which is not used. The "Install the app" button from Phase A1 has no warning and remains the recommended way on Windows.

### Apps look like apps, websites like websites (done)
- **The owner's rule:** when the person asks for an app, Grandpa makes only an app; when they ask for a website, only a website. Before this, every builder was told "ONE PROMPT, A COMPLETE WEBSITE" and given the website rules (hero, sections, footer, scroll animations, 4–8 pages), so apps came out as websites.
- **`projectKind` (public/build-recipes.js)** decides:
  - the choice on the conversation card (`Make: an app.` / `Make: a website.`) wins;
  - then whichever the person named first ("app", "application" but not "application form", "mobile app", "web app", "android", "iphone", "software", versus "website", "site", "web page", "landing page", "blog");
  - then the project type (App, Web tool, Game and Dashboard are apps).
  - The conversation card shows **Make: An app / A website**, and the choice also sets the "Installable app" default.
- **An app gets the APP STANDARD instead of the website standard,** in every builder, the single builder and the team. The team planner gets "ONE PROMPT, A COMPLETE APP": one page of 3–6 screens.
  - The standard covers the app shell (app bar with title and Back, tabs, screens), the main job on the first screen, lists of rows, summary tiles, an Add button with bottom sheets, segmented filters, empty states, and data kept with App.store.
  - It forbids hero banners, marketing sections, about, contact, FAQ and gallery pages, footers, scroll animations and decorative photographs.
  - A website-type recipe used for an app (for example a restaurant ordering app) is told its pages become screens.
- **Kit 11** adds the app shell:
  - `.gk-app`, `.gk-app-bar`, `.gk-app-main`, `.gk-list` / `.gk-row` / `.gk-avatar`, `.gk-stats-row` / `.gk-stat`, `.gk-fab`, `.gk-sheet`, `.gk-segmented`, `.gk-empty` and `.gk-app-label`;
  - a side rail instead of bottom tabs at 900 px and wider;
  - App.screens now sets the bar's title from the screen's `data-title`, and shows Back only on screens that are not tabs.
- **Verified in Chromium** (Pixel 7 and 1280×800) on an app written to the standard: the title follows the screen, Back appears only on inner screens and goes back, the tabs sit at the bottom on phones with a side rail on computers, Add opens a bottom sheet, and there are no page errors.
- **Not yet verified:** a full build with the AI model (a paid call); the owner tests it.

### Phase D1: every app gets its own database (done)
- **The design:** an app describes its tables in `data/schema.json`. That allows 1–20 tables of up to 40 fields, of types text, longtext, number, integer, money, boolean, date, datetime, time, choice, email, phone and url, with required, min/max and max length.
  - Each table has an access rule: `team` (default: owner and staff), `public-read` (a menu), `public-add` (orders, sign-ups) or `public`.
  - A publish with a broken design is refused with a clear message.
- **The data** lives in Grandpa AI's own Postgres (`grandpa_ai_app_records`, `grandpa_ai_app_usage`), fully separate per app, and is checked against the design on every save (`server/app-db.js`).
  - Queries: filters eq/ne/gt/gte/lt/lte/contains/in on known fields only, sorting, paging and text search. Field names are always SQL parameters.
  - Totals: count and sum grouped by a field or by day/month/year.
  - The in-memory test store and Postgres give identical results (tested against PGlite).
- **Limits per app:** 20,000 records, 25 MB and 3,000 saves a day. Only Grandpa AI's owner can change one app's limits (`POST /api/admin/app-db/:slug/limits`, never unlimited). Taking an app down deletes its data.
- **Who may do what:**
  - The owner is identified by the publishing phone's key or a Manage session.
  - Staff sign in with the **team passcode** the owner sets in Manage (scrypt, 30-day sessions, lock after 8 wrong tries; changing it signs staff out). A staff key does not open Manage.
  - Visitors may do only what a table's access allows, and the change counts only cover tables they may read.
- **`App.db` in the app toolkit (Kit 12):**
  - It provides add, list, get, update, remove, summary, `App.db.onChange` (polls every 5 s while visible) and `App.db.ready`.
  - On a published app it uses the online database. Private apps show a sign-in screen for the team passcode, and the owner opens the app from Manage with `#app-key=…`, which is stored and removed from the address.
  - Offline, saves are queued on the phone and sent when the internet is back, and the last lists are shown from the phone.
  - In Build's preview it is a test database with the same checks, filled from `data/sample.json`; the published app starts empty.
  - `App.render` now joins lists of pieces.
- **Manage → App data:** usage against the limits, "Open the app as owner", the team passcode, and a spreadsheet view of every table (search, add, edit, delete, paging), plus CSV of a table and a JSON backup of everything.
- **Builders** learn it in the kit guide (APP DATABASE), the app rules use App.db for records (App.store only for this device's choices), and the App and Dashboard types use it.
- **Verified in Chromium against the real server:**
  - the preview shows the sample data, adds records and applies the same checks;
  - a published private app shows the sign-in screen to a stranger, opens for the owner from the Manage link, and starts empty;
  - staff sign in (a wrong passcode is refused) and see the owner's new sale within seconds;
  - a sale added offline is kept on the phone and reaches the database when back online;
  - Manage shows, adds and downloads the records as CSV;
  - no page errors.
- **Not yet verified:** a full build with the AI model, which the owner tests.

### Phase D2: accounts for the people who use an app (done)
- **The design file can switch accounts on:** `"accounts": { "signup": "open" | "invite" | "off", "roles": [...], "defaultRole": "..." }` in `data/schema.json`.
  - The app's owner is always allowed everything and is not a role.
  - Staff get their role from an **invite code** the owner makes in Manage (8 characters, at most 20 codes), or the owner changes their role there.
- **Rules per table:** `"rules": { "read", "add", "change", "remove" }`, each a list of `anyone`, `signed-in`, `team` (the team passcode), a role name, or `own` (only records the person added; not for add).
  - Every record remembers who added it (`by`).
  - Tables without rules keep their D1 `access` meaning.
  - The server applies the rules to lists, totals, single records, changes, deletions and change notices, so "own" really is enforced on the server.
  - Visitors get 401 and a sign-in prompt; signed-in people who aren't allowed get 403.
- **Accounts** (`server/app-users.js`, tables `grandpa_ai_app_accounts`, `grandpa_ai_app_sessions` and `grandpa_ai_app_invites`):
  - People sign in with a phone number (in any format; a leading + is kept) or a username, and a password of 6–72 characters stored only as an scrypt hash.
  - Sessions last 60 days. Eight wrong passwords lock the account for 15 minutes.
  - Limits: 5,000 accounts per app and 300 new accounts a day.
  - Changing a password signs other phones out. The owner resets forgotten passwords in Manage, because email and SMS cost money.
  - Switching an account off or resetting its password signs it out, and a new role applies straight away.
  - Taking the app down deletes its accounts.
- **App.auth in the app toolkit (Kit 13):** `require()`, `user()`, `signIn`, `signUp`, `signOut`, `changePassword` and `onChange`.
  - The kit shows its own sign-in and create-account screen, with an invite-code field and a link to the team passcode.
  - The owner (from Manage) and team-passcode phones count as signed in.
  - Signing out clears the phone's copy and reloads, so nothing private stays on screen.
  - In Build's preview you are the owner, and a test account there sees what a customer would, with "own" rules applied.
- **Manage → App data → App users:** every account with its role (changeable), Reset password, Switch off/on and Delete, plus invite codes to make, copy and delete. The records table shows who added each record.
- **Builders** learn it in the kit guide (ACCOUNTS): never their own sign-in form, password storage or user table.
- **Verified:**
  - Tests: rule checking, identical behaviour from the memory and Postgres account stores (lock-out, owner controls, invites), and the full server story.
  - The tests caught a real gap, now fixed: deleting a record was checked against the change rule, not the remove rule.
  - In Chromium against the real server:
    - in the preview, the owner sees the sample data and a test customer sees only their own;
    - a visitor gets the screen and creates an account;
    - two customers each see only their own order, and staff join with an invite code and see every order;
    - signing out shows the screen and leaves no data behind;
    - a wrong password says so, and the phone number works in another format;
    - Manage lists the accounts, shows who placed each order, and the owner promotes a customer to staff, who then sees every order;
    - no page errors.
  - This check also found and fixed the owner being asked to sign in, and Manage's squeezed role menu.

### Phase D3: the features toolkit (done)
- **Photos and documents:** fields of type `image` or `file`.
  - `App.db.upload(file, { table })` makes photos smaller on the phone (at most 1600 px, JPEG) and sends them to `POST /api/app-db/:slug/files`, which takes at most 2 MB of JPEG, PNG, WebP, GIF, PDF, text, CSV, DOCX or XLSX.
  - The first bytes must match the type, and SVG is refused (it can carry scripts).
  - Files are stored in `grandpa_ai_app_files` and counted in the app's space, at an unguessable address. Images are shown inline; other files download, with nosniff and a sandbox.
  - A replaced or removed record's old photo is deleted. `App.db.fileUrl(id)` gives the address.
  - Manage shows thumbnails and has a file picker.
- **Automatic numbers:** `{ "type": "autonumber", "prefix": "INV-", "digits": 4 }`, assigned on the server inside the save (never repeated, never set by the app).
- **Links between tables:** `{ "type": "link", "table": "products" }`.
  - The linked record must exist.
  - `list({ expand: 'product' })` adds `record.linked.product`, only if the person may read it.
  - A summary grouped by a link gives each group the linked record's name (for best sellers).
  - Manage shows links by name and offers a menu of records.
- **Effects:** `"effects": [{ "link": "product", "field": "stock", "change": "-qty" }]` changes the linked number in the same database transaction.
  - It is undone when the record is removed, and moved or adjusted when it changes.
  - A minimum on the field refuses the save with "Not enough stock for Rice: 5 left." (409), and a refused save changes nothing.
- **Alerts:** `"alerts": [{ "table", "on", "when", "message", "for" }]`.
  - Raised on the server after a save, including on records an effect changed (stock), and only when a condition *becomes* true.
  - Shown only to the roles named (the owner sees all), and the last 500 are kept.
  - In the app, `App.alerts.watch()` shows new ones as messages within seconds and `App.alerts.list()` lists them.
- **Activity log:** who added, changed, removed or imported what, with the record's name; the last 2,000 are kept. It's in Manage, and in the app for the owner and team (`App.db.activity()`).
- **Spreadsheet import:**
  - Manage → App data → Import reads a CSV (commas, semicolons or tabs, quoted cells) and matches columns to fields by name or label, and links by the linked record's name.
  - `POST /t/:table/import` (owner and team, 500 rows a time) checks every row, saves the good ones and lists the bad ones by row.
  - CSV downloads give file addresses.
- **Reports:** summaries, App.chart, App.table, App.csv and `data-gk-print` (print or save as PDF), all taught in the kit guide (APP FEATURES).
- **The preview's test database** applies the same automatic numbers, links, effects (with the minimum) and alerts.
- **Verified:**
  - tests check the design, effects maths, identical behaviour from the memory and Postgres stores (numbers, stock moves on add, change, product change and remove, refusals, files, the log, alerts) and the whole server story;
  - in Chromium, the preview sale lowers stock and raises the alert, and an oversized sale is refused;
  - the owner adds a product with a photo, which shows;
  - a staff sale is numbered INV-0001 and lowers stock, and the owner's phone shows "Stock low" within seconds; an oversized sale is refused with the reason;
  - Manage shows the thumbnail and sales by product name, imports a spreadsheet (2 added, 2 bad rows explained) and shows the activity log and alerts;
  - no page errors.

### Phase D4: the agent designs and tests the database (done)
- **The data plan comes first.** When someone asks for an app, the planning conversation now proposes its data in plain words: each table, its fields, and who may add, change or see it, plus how people sign in (accounts).
  - Build shows it as a "Your app's data" card under the plan. The person can ask for changes ("add a phone number to customers") before anything is built.
  - The approved plan is added to the brief, and the builders are told to make `data/schema.json` from it exactly.
- **Checked after every build** (the same check that already catches broken pages, so the existing automatic repair fixes it):
  - the code uses `App.db` but there is no `data/schema.json`; the design is not valid JSON; the code uses a table the design does not have; the sample data has a table the design does not have;
  - the server checks the design and every sample record with the same rules as the real database (`POST /api/app-design/check`);
  - in the hidden check run, the kit tests every table in the test database as the owner: it adds a record (from the sample data, or sensible values), lists it, changes it and removes it. A field the code saves that the table does not have, a table the code lists that does not exist, a sample record that breaks a rule, or a table that cannot save a record is reported.
- **Publishing a new version never deletes saved data.** If the new design drops a table or field that has records, or changes a field's type, the publish message says "Your saved data is safe" and lists what was left out; the data comes back if the table or field is added again.
- **Verified:**
  - tests check the data plan (names made safe, broken tables dropped) and its text for the builders, the design checks, the server check, and that republishing a smaller design warns, hides the table and brings it back with its records;
  - in Chromium, at phone size: the "Your app's data" card shows the tables, fields and accounts, and saying "yes" sends the approved plan to the builders;
  - in the check run, a clean app reports nothing; a wrong table name, a bad sample record and a table that cannot save a record are each reported;
  - no page errors.

### Phase D5: the app's own server code, in a sandbox (done)
- **What it is for:** work that must not be done or trusted on a visitor's phone, such as prices and totals worked out from the products table, steps that change several tables together, checks across records, and calling another service with a secret key. Plain saving and listing stays in `App.db`.
- **How an app uses it:**
  - A file `server/<name>.js` with `export default async function (input, app)`. The page calls `await App.server('<name>', input)`.
  - `export const who = 'everyone' | 'signed-in' | 'team' | ['staff', …]` says who may run it. Without it, only the owner and the team can, because the code runs with the owner's power.
  - `app.db(table)` has get, list, add, update, remove and summary. Every save goes through the same checks, links, effects, activity log and alerts as a save from the app.
  - `app.user` is the person running it. `app.fetch(url, options)` calls another service. `app.secrets.NAME` reads a key the owner added. `console.log` goes to the owner's log.
- **The sandbox:** QuickJS compiled to WebAssembly (`quickjs-wasi`, already used by the `workflow` package, now a direct dependency; free, with no new service).
  - Each run gets a fresh engine with no files, network, timers, imports or access to Grandpa AI's process, keys or other apps.
  - Limits per run: 1 s of computing (loops are stopped), 10 s in all, 32 MB of memory, 100 database calls, 3 web calls (5 s and 512 KB each), 64 KB in and 256 KB out.
  - Each app may run its code 2,000 times a day. Only Grandpa AI's owner can raise that, like the other app limits.
- **Web calls** use HTTPS on the normal port only. The name is looked up once; addresses on this machine, private networks or the cloud's metadata service are refused, and the connection goes to the checked address. Redirects are not followed.
- **Secret keys:** the owner adds them in Manage → App data → Server code (at most 20 per app).
  - They are sealed with AES-256-GCM, with a key derived from a server secret and tied to the app.
  - They are opened only for a run and never shown again.
  - Failed runs are listed in the owner's Activity with the error and the last log lines.
- **Visitors never see the code:** `server/…` is never served, and is left out of the installed app's offline files.
- **In Build:**
  - The preview sends `App.server` calls (checked messages from the visible preview only) to `POST /api/app-actions/try`. That runs the same code against a copy of the preview's test database and sends back the tables it changed. Secret keys are empty there.
  - After each build the checks report:
    - a page calling `App.server('x')` with no `server/x.js`;
    - badly named server files;
    - server code using a table the design lacks, or with no `data/schema.json`;
    - a file that does not load or has no default function (checked in the sandbox on the server).
  - The kit guide teaches SERVER CODE (Grandpa Kit 16).
- **Verified:**
  - Tests cover:
    - who may run code;
    - the sandbox: no Node, timers or host functions; a loop stops after 1 s; memory, database-call, web-call, time, input and output limits; errors meant for people pass through, others are hidden; `app` cannot be changed;
    - web-call refusals: http, other ports, passwords in the address, localhost, private, metadata and IPv6-mapped addresses, a name that points inside;
    - sealing keys to their app, keys and daily runs in both the memory and Postgres stores;
    - Build's checks and the preview message checks;
    - the whole published story: the code is not served, the price comes from the database, stock goes down by effect, a refusal gives the reason, owner-only code refuses visitors, keys are read but never returned, failures are logged, the preview continues the order numbers.
  - In Chromium, at phone size:
    - in Build's preview, buying runs the server code (ORD-0001, LRD 3600), the stock goes 5 → 3, and an order that is too big says "Not enough stock for Rice: 3 left.";
    - published on the sites address, a visitor's order runs on the server, the stock goes down, and `server/checkout.js` gives 404;
    - Manage lists the code, who may use it and today's runs, and saves a secret key without showing it again;
    - no page errors.
  - `npm run build` copies the engine (`quickjs.wasm`) into the server function, and it resolves there.

### Owner-paid services, P1: SMS and email from the owner's own account (done)
- **Principle (Samuel):** paid extras go through the app owner's own account with each provider. The owner pays the provider directly and receives their own customers' money. Grandpa AI never pays for, resells or holds these. Plan: P1 SMS and email; P2 mobile-money payments (the owner's own MTN MoMo merchant account); P3 custom domains (the owner buys the domain); P4 a Play Store upload for the owner's own Google Play account.
- **Providers:** SMS goes through Twilio, which delivers in Liberia; MTN needs an alphanumeric sender name. Email goes through Resend (free plan: 3,000 a month).
- **Connecting:** in Manage → App data → Messages, the owner pastes their keys. These are stored as the app's sealed secret keys (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `SMS_FROM`, `RESEND_API_KEY`, `EMAIL_FROM`) and never shown again. The owner can disconnect at any time.
- **Alerts:** every alert can also go to up to 5 phone numbers and 5 email addresses. A number starting with 0 gets the owner's country code (231 by default). Failures go to Activity, and the save still works.
- **Server code:** `app.sms(to, text)` and `app.email(to, subject, text)`, at most 5 per run. In Build's preview they are listed, not sent.
- **Daily limit:** the owner sets it to protect their bill (default 200, at most 5,000). Only messages that can actually go are counted: not connected or a wrong address fails first, free. Manage can send a test.
- **Verified:**
  - Tests cover:
    - number and address checks;
    - the exact Twilio and Resend requests, with the owner's credentials;
    - settings and daily counts in the memory and Postgres stores;
    - the per-run limit;
    - the whole published story (with a stand-in provider, so nothing real is sent): nothing goes before connecting, only the owner can connect, keys are never returned, an alert reaches the owner's phone and email, server code thanks a customer, the daily limit stops more, a provider refusal is logged, the preview lists without sending, and disconnecting works.
  - In Chromium, Manage connects Twilio without showing the token, saves alert numbers in international form and offers a test.

### Owner-paid services, P2: mobile money through the owner's own MTN MoMo account (done)
- **How it works:** MTN MoMo Collections ("request to pay"). The customer approves on their own phone and the money goes straight to the app owner's MoMo merchant account. Grandpa AI never holds, receives or charges anything; MTN's own fees apply.
- **Connecting** (Manage → App data → Payments): the Collections subscription key, API user and API key, stored as sealed app secrets (`MOMO_*`) and never shown again.
  - The test system is the default: MTN's sandbox, `sandbox.momodeveloper.mtn.com`, in euros, with no real money.
  - Live means MTN Liberia (`proxy.momoapi.mtn.com`, target `mtnliberia`) in LRD or USD. It needs a merchant account approved by MTN Liberia (Lonestar), and switching to it asks the owner to confirm.
  - The owner sets a daily limit on payment requests (default 500).
- **The amount always comes from server code:** `app.pay.request({ phone, amount, note, table, record, field })` (at most 3 per run). The request is recorded with a new UUID, which is MTN's reference.
- **Following a payment:** the page uses `App.pay.wait(id)` / `App.pay.status(id)` (Kit 17), and `GET /api/app-db/:slug/payments/:id` reports progress without the phone number. While a payment is pending, the server asks MTN at most every 3 seconds.
- **When MTN reports success:** the payment settles once (an atomic pending → successful/failed), the record's yes/no field is set through the normal checks, so alerts fire, and the activity log records it.
- **In Build's preview:** nothing is charged, payments count as paid at once, and MTN is never called.
- **Not yet confirmed:** whether MTN Liberia currently opens merchant API access. Owners start on the free test system.
- **Verified:**
  - Tests cover:
    - request and settings checks;
    - the exact MTN token, request-to-pay and status calls for the test system and live, with token caching;
    - payments and daily counts in the memory and Postgres stores, with a single settle;
    - the whole published story, with a stand-in MTN so no real money moves: not connected, owner-only connecting, the amount taken from the database, pending then successful, the order marked paid once with its alert, a refused payment leaves the order unpaid, Manage shows payments without keys, live uses MTN Liberia, and the preview never calls MTN.
  - In Chromium, at phone size:
    - the preview checkout shows paid;
    - published, the customer sees "Approve the payment on your phone", then "Paid ✓ LRD 3600", and the order is marked paid;
    - Manage connects to the test system without showing keys and lists the payment;
    - no page errors.

- Email or SMS alerts for new orders and bookings.
- Real mobile-money or card payments (merchant accounts with Lonestar MTN / Orange).
- Custom domains for published sites (for example mamakitchen.lr).
