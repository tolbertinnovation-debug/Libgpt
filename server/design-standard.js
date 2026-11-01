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
  <img src="images/descriptive-name.jpg" alt="what it shows" data-picture="a detailed description of the photograph to create: subject, setting, light, style" loading="lazy" width="1200" height="800" style="object-fit: cover">
  and give the image a background colour and aspect-ratio in CSS. The app creates these photographs after the files are written (at most six per build), so use clear, specific descriptions with no words or logos in them. Always use the person's own pictures (files they added) first. Logos and icons are inline SVG.
- Video: use a video only when the person supplied it: a file they added (under files/) as <video autoplay muted loop playsinline poster="..."> for a background or section, or a YouTube or Vimeo link they gave, embedded from youtube-nocookie.com/embed/ID (or player.vimeo.com) in a responsive 16:9 frame with a title. Never invent a video, picture or file URL.
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
- Map: <div class="gk-map"><iframe title="Map" loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=...&layer=mapnik"></iframe></div>. Video embed: <div class="gk-video"><iframe title="..." src="https://www.youtube-nocookie.com/embed/ID" allowfullscreen loading="lazy"></iframe></div>.
- WhatsApp button (only with a number the person gave): <a class="gk-whatsapp" href="https://wa.me/NUMBER" aria-label="Chat on WhatsApp">(WhatsApp SVG)</a>. Back to top: <button class="gk-top" aria-label="Back to top">↑</button>. Page loader: <div class="gk-loader" aria-hidden="true"></div> as the first element in body.
- Several languages (when asked): <nav class="gk-lang-switch" data-gk-lang-switch><button data-lang="en">EN</button><button data-lang="fr">FR</button></nav>, and each translatable text written once per language with lang="en" / lang="fr" / lang="lib" (Liberian English) on sibling elements.
- Footer: <footer class="gk-footer">.`;
