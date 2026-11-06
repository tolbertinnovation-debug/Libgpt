// The design score: how finished and professional a website looks, from its files alone (no model, no cost).
// It starts at 100 and takes points off for what separates an amateur site from a premium one, each with a
// plain sentence a builder can act on. Shown after every save ("Design 92/100"); under 85, Grandpa offers to
// polish it. Apps, tools and games (no website pages) are not scored.

const pages = (files) => files.filter((f) => /\.html?$/i.test(f.path) && !/^data:/.test(f.body || '') && !/(^|\/)(404|offline)\.html?$/i.test(f.path));
const count = (text, pattern) => (String(text).match(pattern) || []).length;

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const FILLER = /lorem ipsum|dolor sit amet|welcome to our website|your company name|company name here|insert (?:text|image)|placeholder text|coming soon\.\.\./i;

/** { score: 0–100, issues: [exact sentences for the builder], tips: [short plain words for the person], scored: false for apps and projects with no pages } */
export function scoreDesign(files = []) {
  const all = pages(files);
  if (!all.length || all.some((f) => /class="[^"]*\bgk-app\b/.test(f.body))) return { score: 100, issues: [], tips: [], scored: false };
  const home = all.find((f) => /(^|\/)index\.html?$/i.test(f.path)) || all[0];
  const styles = files.filter((f) => /\.css$/i.test(f.path)).map((f) => f.body).join('\n') + all.map((f) => (f.body.match(/<style[\s\S]*?<\/style>/gi) || []).join('\n')).join('\n');
  const issues = [];
  let score = 100;
  const tips = [];
  const tip = (words) => { if (!tips.includes(words)) tips.push(words); };
  const take = (points, sentence, plain) => { score -= points; issues.push(sentence); tip(plain); };

  if (!all.every((f) => /<meta[^>]+name=["']viewport["']/i.test(f.body))) take(10, 'Every page needs <meta name="viewport" content="width=device-width, initial-scale=1"> so it fits phones.', 'Fit phone screens properly');
  const brand = styles.match(/--brand\s*:\s*(#[0-9a-f]{6})\b/i)?.[1];
  if (!/--brand\s*:/i.test(styles)) take(10, 'Set the brand colours once as CSS variables (:root { --brand: …; --accent: …; }) and use them everywhere.', 'Use one set of brand colours everywhere');
  else if (brand && contrast('#ffffff', brand) < 4.5) take(8, `The brand colour ${brand} is too light for white text on buttons (contrast ${contrast('#ffffff', brand).toFixed(1)}:1, needs 4.5:1). Use a darker shade.`, 'Make the brand colour darker so button text is readable');
  if (!all.some((f) => /grandpa-kit\.css/.test(f.body))) take(5, 'Link the Grandpa Kit stylesheet (assets/grandpa-kit.css) so the premium sections and effects are available.', 'Use Grandpa\'s premium design pieces');

  const body = home.body;
  if (!/class="[^"]*\b(gk-split|gk-hero)\b/.test(body)) take(10, `${home.path}: the home page needs a strong hero at the top (gk-split with a photo, or gk-hero) with one headline, one lead sentence and two buttons.`, 'A strong opening at the top with a photo and two buttons');
  const sections = count(body, /<section\b/gi);
  if (sections < 4) take(10, `${home.path} has ${sections ? `only ${sections} section${sections === 1 ? '' : 's'}` : 'no <section> blocks'}; a finished home page has 5 to 8 (hero, what is offered, proof, the story, a call to action).`, 'More sections on the home page (what you offer, reviews, your story)');
  if (!/<footer\b/i.test(body)) take(5, `${home.path}: add a footer (gk-footer-cols) with contact details, the pages and the year.`, 'A footer with your contact details');
  if (!/<header\b|<nav\b/i.test(body)) take(5, `${home.path}: add a header with the name and the pages (gk-header).`, 'A menu at the top with your pages');
  if (!/class="[^"]*\bgk-btn\b|<button\b/i.test(body)) take(5, `${home.path}: the home page needs a clear call-to-action button (gk-btn).`, 'A clear button telling visitors what to do');
  if (!/<title>[^<]{3,}<\/title>/i.test(body)) take(5, `${home.path}: give the page a real <title>.`, 'A page title for search and browser tabs');
  if (!/<meta[^>]+name=["']description["']/i.test(body)) take(3, `${home.path}: add a <meta name="description"> of one sentence for search engines and link previews.`, 'A one-line description for Google and shared links');

  // Every page: one main heading, no skipped levels, no filler, real image attributes.
  let headingPoints = 0, altPoints = 0, sizePoints = 0, inlinePoints = 0;
  for (const page of all) {
    const h1 = count(page.body, /<h1\b/gi);
    if (h1 !== 1 && headingPoints < 10) { headingPoints += 5; issues.push(`${page.path} has ${h1} main headings (<h1>); use exactly one.`); tip('One main headline per page'); }
    if (/<h1\b[\s\S]*?<\/h1>(?:(?!<h2\b)[\s\S])*?<h3\b/i.test(page.body) && !/<h2\b/i.test(page.body) && headingPoints < 10) { headingPoints += 3; issues.push(`${page.path} jumps from <h1> to <h3>; use <h2> for section headings.`); tip('Tidy heading sizes'); }
    const images = page.body.match(/<img\b[^>]*>/gi) || [];
    const noAlt = images.filter((tag) => !/\balt=/i.test(tag)).length;
    if (noAlt && altPoints < 10) { altPoints += Math.min(10 - altPoints, noAlt * 2); issues.push(`${page.path}: ${noAlt} picture${noAlt === 1 ? ' has' : 's have'} no alt text describing ${noAlt === 1 ? 'it' : 'them'}.`); tip('Describe every picture for blind visitors and Google'); }
    const noSize = images.filter((tag) => !/\bwidth=/i.test(tag) || !/\bheight=/i.test(tag)).length;
    if (noSize && sizePoints < 6) { sizePoints += Math.min(6 - sizePoints, noSize); issues.push(`${page.path}: give ${noSize} picture${noSize === 1 ? '' : 's'} width and height attributes so the page does not jump while loading.`); tip('Stop the page jumping while pictures load'); }
    if (FILLER.test(page.body.replace(/<[^>]+>/g, ' '))) { score -= 8; issues.push(`${page.path} still has filler words (like "lorem ipsum" or "Welcome to our website"); write real, specific words for this business.`); tip('Replace filler words with real words about you'); }
    const inline = count(page.body, /style="[^"]*font-size\s*:\s*\d+px/gi);
    if (inline > 3 && inlinePoints < 5) { inlinePoints = 5; issues.push(`${page.path} sets text sizes inline in pixels ${inline} times; use the kit type scale (var(--step-0) … var(--step-5)).`); tip('Consistent text sizes'); }
  }
  score -= headingPoints + altPoints + sizePoints + inlinePoints;
  return { score: Math.max(0, Math.min(100, Math.round(score))), issues: issues.slice(0, 20), tips, scored: true };
}

/** What Grandpa is asked when the person taps "Polish the design". */
export function polishRequest(issues = []) {
  return `Polish the design of this website so it looks premium and finished. Keep every page, feature, word the person wrote, and the brand colours. Fix these points from the design check:\n${issues.map((issue) => `- ${issue}`).join('\n')}\nUse the Grandpa Kit 18 premium sections where they help (gk-split hero, gk-section-head, gk-bento, gk-feature-rows, gk-cta-band, gk-footer-cols). Return every changed file completely.`;
}
