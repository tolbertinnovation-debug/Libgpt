// Ready-made sections a person can insert from Preview → Edit, built on the
// Grandpa Kit. Each has real placeholder words to type over, and photographs
// written with data-picture so the app creates them.

export const KIT_FILES = Object.freeze({ css: 'assets/grandpa-kit.css', js: 'assets/grandpa-kit.js' });

const WHATSAPP_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7a2.8 2.8 0 0 0 1.8-1.3 2.3 2.3 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3z"/></svg>';
const ICON = '<span class="gk-icon"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg></span>';

export const SECTIONS = Object.freeze({
  features: { label: 'Services with icons', html: `<section class="gk-section">
  <div class="gk-container">
    <h2 class="gk-reveal">Our services</h2>
    <p class="gk-lead gk-reveal">Tap any words to change them.</p>
    <div class="gk-grid">
      <div class="gk-card gk-reveal">${ICON}<h3>First service</h3><p>Say what you do and why people choose you.</p></div>
      <div class="gk-card gk-reveal">${ICON}<h3>Second service</h3><p>A short, clear description.</p></div>
      <div class="gk-card gk-reveal">${ICON}<h3>Third service</h3><p>A short, clear description.</p></div>
    </div>
  </div>
</section>` },
  gallery: { label: 'Photo gallery (tap to enlarge)', html: `<section class="gk-section is-tint">
  <div class="gk-container">
    <h2 class="gk-reveal">Gallery</h2>
    <div class="gk-gallery gk-reveal" data-gk-gallery>
      <img src="images/gallery-1.jpg" alt="Our work" data-picture="A bright, professional photograph of the business at work" loading="lazy">
      <img src="images/gallery-2.jpg" alt="Our place" data-picture="A welcoming photograph of the shop or workplace, warm daylight" loading="lazy">
      <img src="images/gallery-3.jpg" alt="Happy customer" data-picture="A happy customer being served, natural light, candid" loading="lazy">
    </div>
  </div>
</section>` },
  slider: { label: 'Picture slider', html: `<section class="gk-section">
  <div class="gk-container">
    <div class="gk-slider gk-reveal" data-gk-slider data-gk-auto="5000">
      <div class="gk-slides">
        <img src="images/slide-1.jpg" alt="Slide one" data-picture="A wide, striking photograph that shows what the business offers" style="width:100%;aspect-ratio:16/9;object-fit:cover">
        <img src="images/slide-2.jpg" alt="Slide two" data-picture="A wide photograph of satisfied customers, golden hour light" style="width:100%;aspect-ratio:16/9;object-fit:cover">
        <img src="images/slide-3.jpg" alt="Slide three" data-picture="A wide photograph of the team's skilled hands at work" style="width:100%;aspect-ratio:16/9;object-fit:cover">
      </div>
    </div>
  </div>
</section>` },
  pricing: { label: 'Prices', html: `<section class="gk-section is-tint">
  <div class="gk-container">
    <h2 class="gk-reveal">Prices</h2>
    <div class="gk-pricing">
      <div class="gk-card gk-price gk-reveal"><h3>Basic</h3><div class="gk-amount">1,000 LD</div><ul><li>What is included</li><li>Another thing included</li></ul><a class="gk-btn" href="#contact">Choose</a></div>
      <div class="gk-card gk-price is-featured gk-reveal"><h3>Popular</h3><div class="gk-amount">2,500 LD</div><ul><li>What is included</li><li>Another thing included</li></ul><a class="gk-btn" href="#contact">Choose</a></div>
      <div class="gk-card gk-price gk-reveal"><h3>Premium</h3><div class="gk-amount">5,000 LD</div><ul><li>What is included</li><li>Another thing included</li></ul><a class="gk-btn" href="#contact">Choose</a></div>
    </div>
  </div>
</section>` },
  faq: { label: 'Questions and answers', html: `<section class="gk-section">
  <div class="gk-container">
    <h2 class="gk-reveal">Questions</h2>
    <div class="gk-faq gk-reveal">
      <details><summary>How long does it take?</summary><p>Type your answer here.</p></details>
      <details><summary>How much does it cost?</summary><p>Type your answer here.</p></details>
      <details><summary>Where are you?</summary><p>Type your answer here.</p></details>
    </div>
  </div>
</section>` },
  hours: { label: 'Opening hours', html: `<section class="gk-section is-tint">
  <div class="gk-container">
    <h2 class="gk-reveal">Opening hours</h2>
    <table class="gk-hours gk-reveal" data-gk-list="hours" data-gk-label="Opening hours">
      <tr data-gk-item><td data-gk-field="day">Monday – Friday</td><td data-gk-field="time">8:00 – 18:00</td></tr>
      <tr data-gk-item><td data-gk-field="day">Saturday</td><td data-gk-field="time">9:00 – 15:00</td></tr>
      <tr data-gk-item><td data-gk-field="day">Sunday</td><td data-gk-field="time">Closed</td></tr>
    </table>
  </div>
</section>` },
  map: { label: 'Map (Monrovia — change it after)', html: `<section class="gk-section">
  <div class="gk-container">
    <h2 class="gk-reveal">Find us</h2>
    <div class="gk-map gk-reveal"><iframe title="Map" loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=-10.82%2C6.28%2C-10.74%2C6.33&amp;layer=mapnik"></iframe></div>
  </div>
</section>` },
  numbers: { label: 'Numbers that count up', html: `<section class="gk-section is-dark">
  <div class="gk-container gk-grid">
    <div class="gk-reveal"><h2><span data-gk-count="500">500</span>+</h2><p>Happy customers</p></div>
    <div class="gk-reveal"><h2><span data-gk-count="10">10</span></h2><p>Years of experience</p></div>
    <div class="gk-reveal"><h2><span data-gk-count="24">24</span>h</h2><p>Typical turnaround</p></div>
  </div>
</section>` },
  cta: { label: 'Call to action band', html: `<section class="gk-hero is-animated">
  <div class="gk-container">
    <h2>Ready to start?</h2>
    <p>One short sentence that tells people what to do next.</p>
    <div class="gk-buttons"><a class="gk-btn" href="#contact">Contact us</a></div>
  </div>
</section>` },
  documents: { label: 'Documents to download (price list, forms, menu)', html: `<section class="gk-section">
  <div class="gk-container">
    <h2 class="gk-reveal">Documents</h2>
    <p class="gk-lead gk-reveal">Download or print what you need.</p>
    <ul class="gk-docs gk-reveal">
      <li><a href="#" data-gk-print>Print or save this page as a PDF<small>Add your own PDF files with + in the chat, then ask Grandpa to list them here.</small></a></li>
    </ul>
  </div>
</section>` },
  whatsapp: { label: 'WhatsApp button (add your number)', html: `<a class="gk-whatsapp" href="https://wa.me/231770000000" aria-label="Chat on WhatsApp">${WHATSAPP_SVG}</a>` },
});

/** The page with the kit's stylesheet and script linked, when they are missing. */
export function ensureKitLinks(html, pagePath = 'index.html') {
  const text = String(html || '');
  const up = '../'.repeat(Math.max(0, String(pagePath).split('/').length - 1));
  const css = `<link rel="stylesheet" href="${up}${KIT_FILES.css}">`;
  const js = `<script src="${up}${KIT_FILES.js}" defer></script>`;
  let out = text;
  if (!/grandpa-kit\.css/.test(out)) {
    // Before the page's own stylesheet, so its own rules win.
    const firstStyle = out.search(/<link\b[^>]*rel=["']?stylesheet|<style\b/i);
    out = firstStyle >= 0 ? out.slice(0, firstStyle) + css + '\n  ' + out.slice(firstStyle) : out.replace(/<\/head>/i, `  ${css}\n</head>`);
  }
  if (!/grandpa-kit\.js/.test(out)) out = out.replace(/<\/head>/i, `  ${js}\n</head>`);
  return out;
}
