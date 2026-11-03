// Project recipes: how to build each kind of website or web software. The
// conversation before building picks one (the person can change it), and every
// builder and the engineering team follow it. Shared by the browser and the
// server, so this file has no imports.

export const RECIPES = [
  { id: 'restaurant', name: 'Restaurant or food website', words: /\b(restaurant|food|kitchen|cafe|café|bar|bakery|catering|chop ?shop|cook shop|grill|jollof|menu|eatery|canteen|lounge|pizza|juice)\b/,
    guide: `Pages: Home, Menu (data-gk-list="menu" with name, price, note; Add to order buttons), About, Gallery, Order or Reserve, Contact.
Must have: an appetising photo hero, today's notice (data-gk-text="notice"), the menu grouped by category with search on long menus, the cart with pay-on-delivery instructions, table bookings at set times when they reserve tables, opening hours, map and WhatsApp.
Design: warm and inviting (style friendly or elegant), large food photographs, generous spacing, prices easy to scan.` },
  { id: 'shop', name: 'Online shop', words: /\b(shop|store|boutique|sell|selling|products?|fashion|clothes|shoes|cosmetics|beauty products|electronics|supermarket|market|wholesale|retail)\b/,
    guide: `Pages: Home, Shop (product cards: photo, name, price, short note, Add to order; data-gk-list="products"; search), a product detail page for the best seller, About, Delivery and returns (refunds.html), Contact.
Must have: featured products on the home page, clear prices in the local currency, the cart and checkout with the owner's payment and delivery instructions, trust (delivery areas, returns, real customer counts only if given), WhatsApp.
Design: product-first and tidy (style modern or bold), consistent product photo crops (aspect-ratio 1/1 or 4/5), strong Add to order buttons.` },
  { id: 'booking', name: 'Booking website (salon, clinic, tutor)', words: /\b(salon|barber|spa|clinic|hospital|doctor|dentist|pharmacy|nurse|tutor|coach|appointment|book(ing)?s?|hotel|guest ?house|lodge|massage|nail|hair)\b/,
    guide: `Pages: Home, Services and prices (Manage list), Book (data-gk-form="booking" with date and time; Grandpa offers only free times), About or Team, Gallery, FAQ, Contact.
Must have: a Book now button in the header and hero, services with duration and price, how a visit works, the team with photographs, what to bring or how to prepare, opening hours, map, privacy page (health or personal details).
Design: calm and trustworthy (style elegant or friendly), soft colours, plenty of white space, a clear booking path.` },
  { id: 'portfolio', name: 'Portfolio or personal website', words: /\b(portfolio|personal|resume|résumé|cv|photographer|artist|designer|musician|singer|writer|freelanc|my work|about me|model)\b/,
    guide: `Pages: Home, Work (a gallery or project cards with a full-screen viewer), a project detail page, About (story, skills, a timeline), Contact.
Must have: a striking first screen with the person's name and what they do, the best work first, short project write-ups (challenge, what I did, result), testimonials only if given, a contact form, social links that were given.
Design: let the work speak (style elegant or bold), large images, minimal text, one accent colour.` },
  { id: 'organisation', name: 'Church, school or NGO website', words: /\b(church|ministry|mosque|school|academy|college|university|ngo|charity|foundation|association|community|youth|club|union|cooperative|non-?profit)\b/,
    guide: `Pages: Home, About (mission, history in a timeline, leaders), Programmes or Ministries or Admissions, Events, News, Gallery, Donate or Get involved, Contact.
Must have: service or school times (Manage list), upcoming events, a clear way to join, volunteer or enrol (forms), leadership with photographs, a sign-up form for updates, giving instructions only as the organisation wrote them.
Design: welcoming and dignified (style friendly or corporate), real community photographs, readable for older visitors (16px+ text).` },
  { id: 'event', name: 'Event website', words: /\b(events?|weddings?|conferences?|summit|festivals?|concerts?|party|launch|graduation|funeral|anniversary|tournament|ceremony)\b/,
    guide: `Pages: Home (date, place, a countdown or date block), Programme or Schedule (a timeline), Speakers or Guests, Venue (map, directions), RSVP or Register (form), Gallery, FAQ.
Must have: the date, time and place on the first screen, an RSVP or registration form, the schedule, how to get there, contacts for questions.
Design: celebratory and focused (style bold or elegant), one strong colour theme, big dates and headings.` },
  { id: 'landing', name: 'Landing page (one page)', words: /\b(landing|one ?page|single page|launch page|campaign|waitlist|coming soon|sign ?up page|lead)\b/,
    guide: `One long page with anchored sections: hero (headline, sub-headline, one primary button), problem, solution with 3 benefits, how it works, social proof (only real), pricing or offer, FAQ, final call to action, footer.
Must have: one goal only, repeated as the same button text in the hero, middle and end; a sign-up or enquiry form (data-gk-form="signup" or "message"); fast loading.
Design: bold, high contrast (style bold or modern), short sentences, lots of space between sections.` },
  { id: 'blog', name: 'Blog or news website', words: /\b(blog|news|magazine|articles?|journal|stories|newsletter|media house|press)\b/,
    guide: `Pages: Home (latest articles as cards with picture, title, date, reading time), Article page (readable layout), Categories or Archive, About, Contact, sign-up for updates.
Must have: comfortable reading (max-width 68ch, line-height 1.7, 18px text), dates and authors, related articles, search over article cards, share links.
Design: editorial and calm (style elegant), a strong serif or clean sans for headings, little decoration, excellent typography.` },
  { id: 'media', name: 'Video or media website (video library, playlists, video player)', words: /\b(videos?|video player|video library|playlists?|movies?|films?|sermons?|vlogs?|podcasts?|tv|channel|streaming|watch|clips?|media player)\b/,
    guide: `Pages: Home (a featured video in a large player and the latest videos), Videos (a video library with categories and search), a Watch page with a playlist, About, Contact. A video player app is one screen: a playlist with "Choose videos" from the device.
Must have: the kit's VIDEO PLAYERS only (gk-video-player for the person's own files, gk-player for YouTube, .gk-playlist for series, .gk-video-library with data-category for many videos), a short description and date under each video, subtitles when the person gave them, YouTube places (data-video-search; data-video-count="3" in a playlist) where they have no video yet, and a sign-up form for new videos.
Design: cinematic (style bold or modern), dark sections around players, 16:9 thumbnails with readable titles, big tap targets; never autoplay with sound.` },
  { id: 'tool', name: 'Web tool (calculator, quiz, form)', words: /\b(calculator|converter|quiz|test|exam|survey|generator|tool|planner|estimator|checker|counter|timer|budget|bmi|loan|grade)\b/,
    guide: `A single-page web app: a short title and explanation, the tool itself above the fold, instant results, clear reset, an explanation of how the result is worked out.
Engineering: use the APP TOOLKIT (assets/grandpa-app.js): App.store for state, App.render with App.html to redraw from state, App.form for checks, input validation with friendly messages, keyboard and screen-reader support, no page reloads, results that can be printed (data-gk-print). App.store with remember keeps the person's data on their device (also offline), so they find it again next time.
Design: focused and app-like (style modern), large touch targets, clear numbers, a results card that stands out.` },
  { id: 'game', name: 'Game', words: /\b(game|play|puzzle|snake|tic.?tac|memory game|trivia|arcade|score|level)\b/,
    guide: `A single-page game: title screen with how to play, the game, a score, game over with play again.
Engineering: the APP TOOLKIT's App.loop (or App.store turn-based state for board games), App.sound and App.timer, a canvas or DOM board that resizes to the phone, touch and keyboard controls, pause when the tab is hidden, short sounds made with the Web Audio API only after the first tap, the best score kept with App.store and remember.
Design: playful and clear (style bold or friendly), large buttons, readable on a small phone, motion that respects reduced-motion settings.` },
  { id: 'dashboard', name: 'Dashboard or tracker', words: /\b(dashboard|track(?:er|ing)?|inventory|stock|attendance|records?|report|analytics|crm|admin panel|expenses?|sales log|register)\b/,
    guide: `A web app with screens: overview (stat cards and simple SVG charts), a list or table with search, sort and filters, an add or edit form, a detail view.
Engineering: the APP TOOLKIT: App.store, App.screens for #overview and #items, App.table (search and sort), App.chart for SVG charts, App.csv for export, App.format for money and dates, number and date formatting, empty states, export to CSV in the browser. The records live in the APP DATABASE (data/schema.json, data/sample.json, App.db), shared by every phone of the business; App.db.summary gives the totals for the charts.
Design: clean and dense (style corporate), a fixed sidebar or top tabs on desktop and a bottom bar on phones, muted colours with one accent for actions.` },
  { id: 'docs', name: 'Course or documentation website', words: /\b(courses?|lessons?|tutorials?|documentation|docs|guides?|manual|handbook|training|class notes|e-?learning|curriculum|modules?)\b/,
    guide: `Pages: Home (what you will learn), a lessons or chapters list, one page per lesson (title, goals, content, summary, next and previous links), Resources (downloads), FAQ.
Must have: a sidebar or contents list, progress through lessons, search over lessons, readable long text, printable lessons (data-gk-print), quizzes as simple forms when asked.
Design: clear and studious (style modern or elegant), strong headings, code or examples in boxes, plenty of white space.` },
  { id: 'business', name: 'Business website', words: /\b(business|company|agency|consult|repair|garage|mechanic|cleaning|laundry|construction|electric|plumb|transport|logistics|printing|computer shop|phone shop|security firm)\b/,
    guide: `Pages: Home, About, Services (one card per service with an icon), a detail page for the main service, Gallery or Our work, FAQ, Contact.
Must have: a hero with the main promise and one primary button (Call, WhatsApp or Get a quote), trust signals (years, customers served, a stats band), how it works in 3 steps, opening hours (Manage list), a contact form (data-gk-form="message"), a map and a WhatsApp button when a number is given.
Design: confident and clean (style modern or corporate), the brand colour on buttons and accents only, real photographs of the work.` },
  { id: 'app', name: 'App (phone and computer)', words: /\b(app|application|mobile app|android|iphone|ios|install(?:able)?|offline|pwa|software)\b/,
    guide: `A real app (APP STANDARD): the app shell (gk-app-bar with the screen title and Back, gk-appbar tabs for 3–5 screens, a side rail on computers), the main screen doing the app's job immediately, lists of rows, an Add button that opens a bottom sheet, large touch targets, screens switched without page loads.
Engineering: the APP TOOLKIT (App.screens with the .gk-appbar, App.form, App.db for the app's records with data/schema.json and data/sample.json, App.store with remember only for this device's choices), safe-area padding (env(safe-area-inset-bottom)), no hover-only actions, and every screen usable offline once loaded (no data that only comes from the network unless the app needs it). When published, Grandpa makes it an installable app itself: the install file, the app icon, offline saving and a Get the app page with install steps for Android, iPhone and Windows. Never write a manifest, a service worker or install code.
Design: native-feeling (style modern), system fonts, cards and lists, smooth screen transitions with reduced-motion respected.` },
];

export const GENERAL = { id: 'general', name: 'Website', guide: 'Infer the pages a real organisation of this kind needs (typically 4–8) and follow the design standard closely.' };

export const recipeById = (id) => RECIPES.find((r) => r.id === id) || null;

/** The recipe for a request: an explicit "Project type: …" line first, then the words it uses. */
export function chooseRecipe(text) {
  const said = String(text || '');
  const named = /Project type:\s*([^\n.]+)/i.exec(said);
  if (named) {
    const wanted = named[1].trim().toLowerCase();
    const exact = RECIPES.find((r) => r.name.toLowerCase() === wanted || r.id === wanted);
    if (exact) return exact;
  }
  const lower = said.toLowerCase();
  let best = null, bestScore = 0;
  for (const recipe of RECIPES) {
    const pattern = new RegExp(recipe.words.source, 'g');
    const score = (lower.match(pattern) || []).length;
    if (score > bestScore) { best = recipe; bestScore = score; }
  }
  return best || GENERAL;
}

/** The recipe as instructions for a builder. For an app, the recipe's pages become screens. */
export function recipeGuide(recipe, kind = '') {
  const r = recipe || GENERAL;
  const asApp = kind === 'app' && !APP_KINDS.has(r.id)
    ? '\nTHIS IS AN APP, NOT A WEBSITE: use the recipe only for what this kind of business or activity needs. Make each need a screen of the app (lists, forms in sheets, a summary), drop every marketing page and section (home hero, about, testimonials, gallery, FAQ, contact page, footer) unless the person asked for it.'
    : '';
  return `PROJECT RECIPE: ${r.name}\n${r.guide}${asApp}\nFollow this recipe unless the person asked for something different; their words always win.`;
}

// ---- App or website --------------------------------------------------------------
// The person decides with their own words: "make an app" gets an app (screens, an
// app bar, tabs, lists) and "make a website" gets a website (pages, hero, sections,
// footer). A "Make: an app." / "Make: a website." line (the choice on the
// conversation card) wins; then whichever the person named first; then the type.
export const APP_KINDS = new Set(['app', 'tool', 'game', 'dashboard']);
const APP_NAMED = /\b(?:apps?|application(?!\s+forms?)|mobile app|web ?apps?|pwa|android|iphone|ios|software)\b/i;
const WEBSITE_NAMED = /\b(?:web ?sites?|sites?|web ?pages?|landing ?pages?|home ?page|blog)\b/i;

/** 'app' or 'website' for what the person asked. */
export function projectKind(text, recipe = null) {
  const said = String(text || '');
  const chosen = /^Make:\s*(?:an?\s+)?(app|website)\b/im.exec(said);
  if (chosen) return chosen[1].toLowerCase();
  const words = said.replace(/^Project type:[^\n]*$/gim, '');
  const app = words.search(APP_NAMED), site = words.search(WEBSITE_NAMED);
  if (app >= 0 && (site < 0 || app < site)) return 'app';
  if (site >= 0) return 'website';
  return APP_KINDS.has((recipe || chooseRecipe(said)).id) ? 'app' : 'website';
}

/** The line that carries the choice to every builder. */
export const kindLine = (kind) => (kind === 'app' ? 'Make: an app.' : 'Make: a website.');
