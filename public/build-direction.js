// Grandpa's creative director: before a new website is built, one clear art direction is chosen for it from
// the person's own words, so every page comes back looking like one designed brand rather than a template.
// It is rule-based (no model call, no cost): a tested colour set, a style and font pairing, a photography
// direction, the home page's premium sections in order, and the voice of the words.
//
// Every colour set below was chosen so white text is readable on the brand colour and dark text on the accent.

export const PALETTES = Object.freeze({
  harvest: { brand: '#9a3412', accent: '#f59e0b', style: 'friendly', fonts: 'warm', hue: ['orange', 'brown', 'red'], feel: 'warm, generous and appetising' },
  palm: { brand: '#166534', accent: '#eab308', style: 'modern', fonts: 'modern', hue: ['green', 'yellow', 'gold'], feel: 'fresh, natural and trustworthy' },
  ocean: { brand: '#0e4c75', accent: '#22c1c3', style: 'corporate', fonts: 'modern', hue: ['blue', 'teal'], feel: 'calm, capable and professional' },
  clinic: { brand: '#0f766e', accent: '#38bdf8', style: 'modern', fonts: 'friendly', hue: ['teal', 'green', 'blue'], feel: 'clean, caring and reassuring' },
  royal: { brand: '#4c1d95', accent: '#f59e0b', style: 'elegant', fonts: 'classic', hue: ['purple', 'gold'], feel: 'dignified, warm and welcoming' },
  liberty: { brand: '#1e3a8a', accent: '#dc2626', style: 'corporate', fonts: 'bold', hue: ['blue', 'red', 'navy'], feel: 'proud, confident and Liberian' },
  sunset: { brand: '#be123c', accent: '#fb923c', style: 'bold', fonts: 'bold', hue: ['red', 'pink', 'orange'], feel: 'lively, bold and celebratory' },
  gold: { brand: '#78350f', accent: '#d4a017', style: 'elegant', fonts: 'elegant', hue: ['gold', 'brown', 'cream'], feel: 'refined, luxurious and calm' },
  slate: { brand: '#1f2937', accent: '#f97316', style: 'modern', fonts: 'tech', hue: ['black', 'grey', 'gray', 'orange'], feel: 'sharp, modern and focused' },
  forest: { brand: '#14532d', accent: '#a3e635', style: 'friendly', fonts: 'friendly', hue: ['green', 'lime'], feel: 'earthy, hopeful and hands-on' },
  school: { brand: '#1d4ed8', accent: '#facc15', style: 'friendly', fonts: 'friendly', hue: ['blue', 'yellow'], feel: 'bright, encouraging and organised' },
  ink: { brand: '#111827', accent: '#818cf8', style: 'elegant', fonts: 'editorial', hue: ['black', 'purple', 'indigo'], feel: 'thoughtful, editorial and clear' },
});

// The colour sets that suit each kind of website, best first.
const FIT = {
  restaurant: ['harvest', 'sunset', 'gold', 'palm'], shop: ['palm', 'slate', 'sunset', 'harvest'], booking: ['clinic', 'gold', 'ocean', 'royal'],
  portfolio: ['slate', 'ink', 'gold', 'sunset'], organisation: ['liberty', 'royal', 'school', 'forest'], event: ['sunset', 'royal', 'gold', 'ink'],
  landing: ['slate', 'ocean', 'sunset', 'palm'], blog: ['ink', 'slate', 'ocean', 'royal'], media: ['ink', 'slate', 'sunset', 'royal'],
  docs: ['ocean', 'ink', 'school', 'slate'], business: ['ocean', 'liberty', 'slate', 'palm'], general: ['ocean', 'palm', 'liberty', 'slate'],
};

// What the photographs should look like, by kind.
const IMAGERY = {
  restaurant: 'close, warm, natural-light food photography: plated dishes, hands serving, the cook at work; one wide photo of the room',
  shop: 'clean product photos on plain light backgrounds, plus one lifestyle photo of the products in use in Liberia',
  booking: 'calm, bright photos of the place and the people who work there; real staff and clients, never stock-model poses',
  portfolio: 'the person\'s own work, big and uncropped; one honest portrait',
  organisation: 'real people of the community together: classrooms, services, volunteers at work; warm and hopeful',
  event: 'joyful people at past events, the venue, details (decorations, food, music)',
  landing: 'one strong photo or illustration that shows the result the visitor wants',
  blog: 'one striking photo per article, 16:9, consistent colour mood',
  media: 'video thumbnails with faces and clear titles',
  docs: 'simple diagrams and screenshots; few photographs',
  business: 'the team and the work in progress (tools, vehicles, finished jobs) in Liberia',
  general: 'real, local photographs that show what the organisation actually does',
};

// The home page's sections, in order, using the kit's premium pieces.
const BLUEPRINT = {
  restaurant: ['sticky gk-header with the name, menu links and an Order button', 'gk-split hero: an appetising headline that names the place, the lead, Order + See the menu buttons, a gk-trust row (fresh daily, delivery, hours) and the signature dish photo with a gk-float rating', 'gk-bento of signature dishes (first .is-wide with a photo) with prices in Liberian dollars', 'gk-feature-rows: the story of the kitchen and the cook', 'gk-testimonials (three short, specific quotes)', 'opening hours (gk-hours) and the map side by side', 'gk-cta-band: order or book a table', 'gk-footer-cols'],
  shop: ['sticky gk-header with categories and a cart/WhatsApp order button', 'gk-split hero: what is sold and why here (price, quality, delivery), Shop now + WhatsApp buttons, a gk-trust row, and a product photo with a gk-float offer', 'categories as a gk-bento (first .is-wide)', 'best sellers as gk-product cards with prices', 'how ordering works (gk-steps: choose, order on WhatsApp, delivery)', 'gk-testimonials', 'gk-cta-band', 'gk-footer-cols'],
  booking: ['sticky gk-header with a Book button', 'gk-split hero: the service and the result for the client, Book now + See prices, a gk-trust row (qualified, on time, location)', 'services as a gk-bento with prices or "from" prices', 'gk-feature-rows: the place and the team', 'how booking works (gk-steps)', 'gk-testimonials', 'gk-faq', 'gk-cta-band: book an appointment', 'gk-footer-cols'],
  portfolio: ['minimal sticky gk-header', 'gk-split hero: the person\'s name, what they do and for whom, See my work + Contact, and their portrait', 'selected work as a gk-bento of photo cards (first .is-wide)', 'gk-feature-rows: two case studies (problem, what was done, result)', 'gk-logos of clients (only if given) and gk-testimonials', 'gk-cta-band: work with me', 'gk-footer-cols'],
  organisation: ['sticky gk-header with a Donate/Join/Enrol button', 'gk-hero has-photo with the mission in one strong sentence, two buttons and a gk-trust row', 'gk-stats band (members, years, people helped; only real numbers or clearly approximate)', 'programmes or ministries as a gk-bento', 'gk-feature-rows: the story and the leaders', 'upcoming events or service times', 'gk-testimonials', 'gk-cta-band: give, join or visit', 'gk-footer-cols'],
  event: ['gk-header with a Register button', 'gk-hero is-animated with the event name, date, place and a countdown-style line, Register + Programme buttons', 'gk-stats (speakers, days, guests)', 'programme as gk-timeline', 'speakers or performers as gk-team', 'venue with gk-map', 'gk-faq', 'gk-cta-band: register now', 'gk-footer-cols'],
  landing: ['gk-header with one button', 'gk-split hero with one clear promise, one primary button and a gk-trust row', 'gk-logos or gk-stats as proof', 'three benefits as gk-feature-rows', 'gk-testimonials', 'gk-pricing or a single offer', 'gk-faq', 'gk-cta-band', 'gk-footer-cols'],
  business: ['sticky gk-header with a Call/Quote button', 'gk-split hero: the service, the area served and the main benefit, Get a quote + Call buttons, a gk-trust row, a work photo with a gk-float (years in business or jobs done)', 'services as a gk-bento', 'why choose us as gk-feature-rows', 'how it works (gk-steps)', 'gk-stats band', 'gk-testimonials', 'gk-cta-band: get a quote', 'gk-footer-cols'],
  general: ['sticky gk-header', 'gk-split hero with a specific headline, two buttons and a gk-trust row', 'what is offered as a gk-bento', 'gk-feature-rows', 'gk-testimonials or gk-stats', 'gk-cta-band', 'gk-footer-cols'],
};
for (const kind of ['blog', 'media', 'docs']) BLUEPRINT[kind] = BLUEPRINT.general;

// A compact model home page in the kit's real premium markup, so builders copy correct structure instead of guessing.
export const PREMIUM_EXAMPLE = `<header class="gk-header"><a class="gk-brand" href="index.html">Name</a><button class="gk-nav-toggle" aria-label="Menu">☰</button><nav class="gk-nav">…pages…</nav></header>
<main>
<section class="gk-split"><div class="gk-split-text"><p class="gk-eyebrow">Place · what it is</p><h1>Specific headline that names the result</h1><p class="gk-lead">One sentence on why here.</p><p><a class="gk-btn" href="#contact">Primary</a> <a class="gk-btn is-ghost" href="#offer">Secondary</a></p><ul class="gk-trust"><li>Fact one</li><li>Fact two</li><li>Fact three</li></ul></div><figure class="gk-split-media"><img src="…" alt="What the photo shows" width="1200" height="900"><div class="gk-float">★ 4.9 · real proof</div></figure></section>
<section class="gk-section" id="offer"><div class="gk-container"><div class="gk-section-head"><p class="gk-eyebrow">What we offer</p><h2>Clear section heading</h2><p class="gk-lead">One line.</p></div><div class="gk-bento"><article class="gk-card is-wide"><img src="…" alt="…" width="1200" height="800"><h3>Main offer</h3><p>…</p></article><article class="gk-card"><h3>…</h3><p>…</p></article><article class="gk-card"><h3>…</h3><p>…</p></article></div></div></section>
<section class="gk-section"><div class="gk-container gk-feature-rows"><div class="gk-feature-row"><img src="…" alt="…" width="1200" height="800"><div><h3>The story</h3><p>…</p></div></div></div></section>
<section class="gk-section"><div class="gk-container gk-testimonials"><figure class="gk-quote"><blockquote>Short, specific quote.</blockquote><figcaption>Name <small>Role</small></figcaption></figure></div></section>
<section class="gk-cta-band"><div><h2>Ask for the action</h2><p>One line.</p></div><a class="gk-btn" href="#contact">Primary</a></section>
</main>
<footer class="gk-footer-cols"><div class="gk-footer-grid">…contact · pages · hours…</div><p class="gk-footer-bottom">© year Name</p></footer>`;

/** A small, stable number from text: the same request always gets the same direction. */
const seed = (text) => [...String(text)].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) >>> 0, 7);

/** The colour set for a request: one named in the words first ("green and gold"), else the best fit for its kind. */
export function choosePalette(text = '', kind = 'general') {
  const words = String(text).toLowerCase();
  // Churches, schools and NGOs share a kind, but not a look.
  const fit = kind === 'organisation' && /\b(school|academy|college|university|students?|pupils?)\b/.test(words) ? ['school', 'liberty', 'ocean']
    : kind === 'organisation' && /\b(church|ministry|mosque|worship|parish|fellowship)\b/.test(words) ? ['royal', 'liberty', 'gold']
      : kind === 'organisation' && /\b(ngo|charity|foundation|non-?profit|farm(?:ers|ing)?|women|youth)\b/.test(words) ? ['forest', 'palm', 'liberty']
        : FIT[kind] || FIT.general;
  const named = Object.entries(PALETTES).filter(([, palette]) => palette.hue.some((hue) => new RegExp(`\\b${hue}\\b`).test(words)));
  if (named.length) {
    // The one that fits this kind of site best among those matching the colours named, and most of them.
    named.sort(([a, pa], [b, pb]) => pb.hue.filter((hue) => words.includes(hue)).length - pa.hue.filter((hue) => words.includes(hue)).length
      || (fit.indexOf(a) === -1 ? 99 : fit.indexOf(a)) - (fit.indexOf(b) === -1 ? 99 : fit.indexOf(b)));
    return named[0][0];
  }
  // Variety: different businesses of the same kind do not all get the same colours.
  return fit[seed(words) % Math.min(fit.length, 3)];
}

/**
 * The art direction for a NEW website, as words for the builders. Empty for apps, tools, games and dashboards
 * (they follow the app standard) and when nothing was asked.
 */
export function creativeDirection(text = '', recipe = null, kind = 'website') {
  if (kind === 'app' || !String(text).trim()) return '';
  const type = recipe?.id && BLUEPRINT[recipe.id] ? recipe.id : 'general';
  const name = choosePalette(text, type);
  const palette = PALETTES[name];
  return `CREATIVE DIRECTION (from Grandpa's creative director: follow it exactly, so every page looks like one designed brand)
- Feel: ${palette.feel}.
- Colours (tested for readable text): in your own stylesheet set :root { --brand: ${palette.brand}; --accent: ${palette.accent}; } — unless the person named their own brand colours, which always win. Use the kit tints (--brand-50, --brand-100) for alternate sections and one .is-dark section for contrast.
- Style and fonts: <html lang="en" data-gk-style="${palette.style}" data-gk-fonts="${palette.fonts}">.
- Photographs: ${IMAGERY[type] || IMAGERY.general}.
- Home page, in this order:
${(BLUEPRINT[type] || BLUEPRINT.general).map((section, index) => `  ${index + 1}. ${section}`).join('\n')}
- Structure to copy for the home page (fill every … with real content; add the other sections from the order above in the same style):
${PREMIUM_EXAMPLE}
- Every page: the viewport meta, a real <title> and <meta name="description">, exactly one <h1>, then <h2> section headings; every <img> has alt, width and height.
- Other pages use the same header, footer, section heading blocks (gk-section-head) and spacing as the home page.
- Words: specific and local, never filler. Headlines name the place or the result ("Fresh jollof in Sinkor, ready in 20 minutes"), not generic slogans ("Welcome to our website"). Prices in Liberian dollars (L$) or US$ as the person gave them. Use only the phone numbers, addresses and names the person gave; where one is missing write a clear placeholder like "Your phone number" so it is never invented.`;
}
