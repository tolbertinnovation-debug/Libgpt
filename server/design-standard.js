// What every website the builder makes should have, so a one-line request
// still comes back looking like a professional, modern site: a rich hero,
// real photographs, tasteful motion, good backgrounds, video when the person
// has one. Shared by the single builder, the engineering team and the planner.

export const DESIGN_STANDARD = `DESIGN STANDARD (every website must look professional, modern and finished)
- Design tokens: define the brand colour, accent, dark and light surfaces, text colours, radius, shadow and spacing as CSS variables in :root and use them everywhere.
- Hero: the first section is full width with a rich background: a layered gradient (linear plus soft radial highlights), a subtle SVG pattern, or a photograph under a dark gradient overlay so the text stays readable (contrast at least 4.5:1). A big, confident headline, one short lead sentence, a primary and a secondary button.
- Sections: alternate backgrounds (light, tinted, dark), generous spacing with clamp(), a centred max-width container, grid or flex layouts that become one column on phones. Cards with rounded corners and soft shadows. Inline SVG icons for services and features.
- Typography: a clean system font stack (or the brand's), fluid sizes with clamp(), a clear hierarchy, comfortable line length.
- Motion: tasteful animation. Sections and cards fade and slide up as they scroll into view (an IntersectionObserver adds the class is-visible), buttons and cards lift slightly on hover and focus, smooth scrolling, optionally a slowly shifting gradient in the hero. Put all motion inside @media (prefers-reduced-motion: no-preference). Content must be visible without JavaScript: animation only enhances it, never hides it.
- Photographs make a site feel real. For each photo the page needs (hero, about, gallery, products, services), write
  <img src="images/descriptive-name.jpg" alt="what it shows" data-photo-search="2 to 4 plain words to find a real photo" data-picture="a detailed description of the photograph: subject, setting, light, style" loading="lazy" width="1200" height="800" style="object-fit: cover">
  and give the image a background colour and aspect-ratio in CSS. After the files are written the app finds a free, real photograph by the data-photo-search words (from open photo libraries, with credits), and only creates one from the description when none is found (at most six per build). Search words name a common subject ("jollof rice", "tailor sewing", "classroom children", "beach sunset"), never a brand or a person's name; descriptions have no words or logos in them. Always use the person's own pictures (files they added) first. Logos and icons are inline SVG.
- Video: a file the person added (under files/) as <video autoplay muted loop playsinline poster="..."> for a background or section. A YouTube link the person gave becomes a player: <a class="gk-player" href="https://www.youtube.com/watch?v=ID" data-youtube="ID" data-title="short title">Watch the video</a> (the app completes it with the real title, picture and play button); several go in <div class="gk-videos">. Where a video would really help (a how-to, a tour, a testimonial, a performance) and none was given, leave a place: <div class="gk-player" data-video-search="3 to 6 words to search YouTube"></div>, at most two per site; the person chooses the video. Never invent a YouTube ID, video, picture or file URL.
- Footer: contact details, navigation and the year. A favicon as an inline SVG data URL.`;

// The Grandpa Kit is added to every project as two shared files. Builders use
// its classes instead of writing these effects again, so they look
// professional and behave the same on every site.
export const KIT_PATHS = Object.freeze(['assets/grandpa-kit.css', 'assets/grandpa-kit.js']);
export const isKitPath = (path) => KIT_PATHS.includes(String(path || '').replace(/^\.\//, ''));

export const KIT_GUIDE = `GRANDPA KIT (already in the project: assets/grandpa-kit.css and assets/grandpa-kit.js; never write, plan or change these two files)
Link both on every page: <link rel="stylesheet" href="assets/grandpa-kit.css"> before your own stylesheet, and <script src="assets/grandpa-kit.js" defer></script>. Use ../ in pages inside folders. Set the brand with CSS variables in your own stylesheet (:root { --brand: ...; --accent: ...; }).
- Style preset on <html>: data-gk-style="modern" | "bold" | "elegant" | "friendly" | "corporate" (fonts, corners, shadows). Dark mode: <button class="gk-theme-toggle" data-gk-theme-toggle aria-pressed="false">Dark mode</button>.
- Layout: .gk-container, .gk-section (add .is-tint or .is-dark), .gk-grid of .gk-card (an .gk-icon with an inline SVG at the top), .gk-lead, .gk-buttons with .gk-btn and .gk-btn.is-ghost.
- Hero: <section class="gk-hero is-animated"> (rich animated gradient), or class="gk-hero has-photo" style="--hero-photo:url(images/hero.jpg)", or a person's video as <video class="gk-bg" autoplay muted loop playsinline>.
- Motion: add class gk-reveal to sections and cards (they fade up when seen). Counters: <span data-gk-count="500">500</span>. Year: <span data-gk-year></span>.
- Gallery with a full-screen viewer: <div class="gk-gallery" data-gk-gallery> of <img> (photographs with data-picture).
- Slider: <div class="gk-slider" data-gk-slider data-gk-auto="5000"><div class="gk-slides"> one element per slide </div></div>.
- FAQ: <div class="gk-faq"><details><summary>Question</summary><p>Answer</p></details>...</div>.
- Pricing: <div class="gk-pricing"> of <div class="gk-card gk-price"> (add .is-featured to one) with <div class="gk-amount">, a <ul> and a .gk-btn.
- Opening hours: <table class="gk-hours"><tr><td>Monday</td><td>8:00 – 18:00</td></tr>...</table>. Team: <div class="gk-grid gk-team"> of .gk-card.
- Map: <div class="gk-map"><iframe title="Map" loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=...&layer=mapnik"></iframe></div>. Videos: use the gk-player link described above, never a YouTube iframe (iframes cannot play on published sites; the player opens YouTube there).
- WhatsApp button (only with a number the person gave): <a class="gk-whatsapp" href="https://wa.me/NUMBER" aria-label="Chat on WhatsApp">(WhatsApp SVG)</a>. Back to top: <button class="gk-top" aria-label="Back to top">↑</button>. Page loader: <div class="gk-loader" aria-hidden="true"></div> as the first element in body.
- Several languages (when asked): <nav class="gk-lang-switch" data-gk-lang-switch><button data-lang="en">EN</button><button data-lang="fr">FR</button></nav>, and each translatable text written once per language with lang="en" / lang="fr" / lang="lib" (Liberian English) on sibling elements.
- Footer: <footer class="gk-footer">.
GRANDPA DATA AND MANAGE (the published site saves forms, and the owner changes content on a private Manage page; no other service is needed)
- Every contact, booking, order or sign-up form: <form class="gk-form" data-gk-form="message" | "booking" | "order" | "signup">, each field with a <label> and a clear name attribute (name, phone, email, date, time, people, item, quantity, address, message), required on what is needed, type="tel"/"email"/"date"/"time" where right, and a <button class="gk-btn" type="submit">. Optional: data-gk-success="Thank you text". Never add action or method, never use mailto: forms or an outside form service, and never ask for card numbers or passwords.
- Content the owner will want to change without a rebuild (prices, menu, products, opening hours, a notice) is marked so Manage can edit it:
  - single texts: data-gk-text="key" (for example <p class="notice" data-gk-text="notice" data-gk-label="Notice at the top">Open on public holidays</p>, phone, address);
  - lists: an element with data-gk-list="name" (data-gk-label="Menu"), holding repeated items marked data-gk-item, whose parts are marked data-gk-field="name" | "price" | "note" (same fields in every item). Example: <div class="gk-grid" data-gk-list="menu" data-gk-label="Menu"><article class="gk-card" data-gk-item><h3 data-gk-field="name">Jollof rice</h3><p data-gk-field="price">LRD 350</p><p data-gk-field="note">With chicken</p></article>...</div>. Hours: <table class="gk-hours" data-gk-list="hours" data-gk-label="Opening hours"><tr data-gk-item><td data-gk-field="day">Monday</td><td data-gk-field="time">8:00 – 18:00</td></tr>...</table>.
  Write real starting content in the page; Manage shows it to the owner to change.
BUSINESS TOOLS (all work on the published site with settings the owner chooses in Manage → Shop & bookings)
- Bookings at set times: <form class="gk-form" data-gk-form="booking"> with <input type="date" name="date" required> and <select name="time" required><option value="">Choose a date first</option></select>, plus name, phone and anything else needed. Grandpa fills the free times; never hard-code a timetable or promise instant confirmation.
- A shop or menu that takes orders: inside each data-gk-list item add <button class="gk-btn" type="button" data-gk-add>Add to order</button> (the name and price come from data-gk-field="name" and "price"; or give data-gk-name and data-gk-price). A cart button and checkout appear by themselves, with the owner's payment and delivery instructions. Never add card payment or a payment service.
- Search a long menu, product list, FAQ or documents: <input type="search" class="gk-search" data-gk-search placeholder="Search…" aria-label="Search"> (data-gk-search="#menu" to search one part).
- Search engines and sharing: every page has a unique <title> (page name and business), a <meta name="description"> written for that page (under 155 characters), one <h1>, alt text on every picture, and the language on <html lang>. Grandpa adds the sharing tags and a sitemap.xml when the site is published.
DOCUMENTS
- A download list, only for files that really are in the project: <ul class="gk-docs"><li><a href="files/price-list.pdf" download>Price list<small>PDF</small></a></li></ul>.
- Printable documents (a certificate, price list or menu to print): put it in <div class="gk-doc" id="price-list"> (add gk-certificate for a certificate) with <button class="gk-btn" type="button" data-gk-print="#price-list">Print or save as PDF</button>. data-gk-print with no value prints the whole page.
- Order and booking forms already give the visitor a reference and a "Save a copy (PDF)" button; the owner makes invoices and receipts in Manage. Do not build your own.
POLICY PAGES
- A business website with any form gets privacy.html; one that sells, takes orders or bookings also gets terms.html and refunds.html. Link them in the footer of every page.
- Write them in plain, honest words with the business name: what the forms collect and why, that the business keeps it privately (Grandpa Data) and uses it only to reply, how to ask for it to be deleted, that there are no advertising or tracking cookies, and how to contact the business. Do not name laws, registration numbers or guarantees nobody gave you. End with "Last updated" and the month and year.`;
