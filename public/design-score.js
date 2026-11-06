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
  if (!all.length) return { score: 100, issues: [], tips: [], scored: false };
  if (all.some((f) => /class="[^"]*\bgk-app\b/.test(f.body))) return scoreApp(files, all);
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

/**
 * The app score: how much an app looks and works like a real installed phone app (the APP STANDARD), from its
 * files alone. Same shape as the website score, with kind: 'app'.
 */
export function scoreApp(files = [], all = pages(files)) {
  const home = all.find((f) => /class="[^"]*\bgk-app\b/.test(f.body)) || all[0];
  const html = all.map((f) => f.body).join('\n');
  const code = files.filter((f) => /\.m?js$/i.test(f.path) && !/^assets\/grandpa-/.test(f.path)).map((f) => f.body).join('\n')
    + all.map((f) => (f.body.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || []).join('\n')).join('\n');
  const styles = files.filter((f) => /\.css$/i.test(f.path) && !/^assets\/grandpa-/.test(f.path)).map((f) => f.body).join('\n') + (html.match(/<style[\s\S]*?<\/style>/gi) || []).join('\n');
  const issues = [], tips = [];
  let score = 100;
  const take = (points, sentence, plain) => { score -= points; issues.push(sentence); if (!tips.includes(plain)) tips.push(plain); };

  if (!/<meta[^>]+name=["']viewport["']/i.test(home.body)) take(10, `${home.path} needs <meta name="viewport" content="width=device-width, initial-scale=1"> so it fits phones.`, 'Fit phone screens properly');
  if (!/class="[^"]*\bgk-app-bar\b/.test(html)) take(8, 'Add the top bar: <header class="gk-app-bar"> with <button data-app-back aria-label="Back"> and <h1 data-app-title>.', 'A top bar with the screen title and a back button');
  if (!/class="[^"]*\bgk-app-main\b/.test(html)) take(6, 'Put the screens inside <main class="gk-app-main">.', 'Screens laid out like a real app');
  const nav = html.match(/<nav\b[^>]*class="[^"]*\bgk-appbar\b[^"]*"[^>]*>([\s\S]*?)<\/nav>/i);
  const tabs = nav ? count(nav[1], /<a\b|<button\b/gi) : 0;
  if (!nav) take(8, 'Add a tab bar: <nav class="gk-appbar"> with 3–5 tabs (icon + short label) linking to the screens.', 'A tab bar at the bottom to move between screens');
  else if (tabs < 3 || tabs > 5) take(4, `The tab bar has ${tabs} tab${tabs === 1 ? '' : 's'}; use 3 to 5.`, 'Three to five tabs at the bottom');
  const screens = count(html, /data-screen=["'][^"']+["']/gi);
  if (screens < 2) take(8, `There ${screens === 1 ? 'is only 1 screen' : 'are no screens'} (<section data-screen="…" data-title="…">); a finished app has at least 2 (the main job, plus add/details/settings).`, 'More than one screen (the main list, add, settings)');
  if (!/grandpa-app\.js/.test(html)) take(6, 'Load the app toolkit: <script src="assets/grandpa-app.js" defer></script>, and use App.screens, App.db and App.form.', 'Use Grandpa\'s app toolkit for screens, saving and forms');
  if (!/grandpa-kit\.css/.test(html)) take(5, 'Link the Grandpa Kit stylesheet (assets/grandpa-kit.css) so the app parts look right.', 'Use Grandpa\'s app design pieces');
  if (!/--brand\s*:/i.test(styles)) take(6, 'Set the brand colours once as CSS variables (:root { --brand: …; --accent: …; }).', 'Use one set of brand colours everywhere');
  if (!/<title>[^<]{3,}<\/title>/i.test(home.body)) take(4, `${home.path}: give the app a real <title> (its name).`, 'The app\'s name in the browser tab and when installed');

  const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/gi) || [];
  const unnamed = buttons.filter((b) => !/aria-label=["'][^"']+/i.test(b) && !b.replace(/<svg[\s\S]*?<\/svg>/gi, '').replace(/<[^>]+>/g, '').trim()).length;
  if (unnamed) take(Math.min(8, unnamed * 2), `${unnamed} icon button${unnamed === 1 ? ' has' : 's have'} no name; add aria-label="…" so screen readers and the person know what ${unnamed === 1 ? 'it does' : 'they do'}.`, 'Name every icon button');
  const ids = new Set((html.match(/<label\b[^>]*\bfor=["']([^"']+)/gi) || []).map((l) => l.match(/for=["']([^"']+)/i)[1]));
  const fields = (html.match(/<(input|select|textarea)\b[^>]*>/gi) || []).filter((tag) => !/type=["']?(hidden|submit|button|checkbox|radio)\b/i.test(tag));
  const unlabelled = fields.filter((tag) => !/aria-label=/i.test(tag) && !ids.has(tag.match(/\bid=["']([^"']+)/i)?.[1])).length;
  // A field inside its <label> is labelled too; count those back.
  const wrapped = count(html, /<label\b[^>]*>(?:(?!<\/label>)[\s\S])*?<(?:input|select|textarea)\b/gi);
  const missing = Math.max(0, unlabelled - wrapped);
  if (missing) take(Math.min(8, missing * 2), `${missing} form field${missing === 1 ? ' has' : 's have'} no label; give each a <label for="…"> (a placeholder is not a label).`, 'A clear label on every form field');
  if (/class="[^"]*\bgk-list\b/.test(html) && !/gk-empty/.test(html + code)) take(4, 'Show a friendly empty state (.gk-empty with a line of help and an Add button) when a list has no records yet.', 'A helpful message when there is nothing saved yet');
  if (/\b(?:window\.)?(?:alert|prompt)\s*\(/.test(code)) take(5, 'Replace alert()/prompt() with App.toast and a <dialog class="gk-sheet"> form; browser pop-ups look broken in an installed app.', 'Use app-style messages instead of browser pop-ups');
  if (/\b(?:delete|remove)\w*\s*\(/i.test(code) && !/confirm/i.test(code)) take(4, 'Ask for confirmation before deleting a record.', 'Ask before deleting anything');
  const inline = count(html, /style="[^"]*font-size\s*:\s*\d+px/gi);
  if (inline > 3) take(5, `Text sizes are set inline in pixels ${inline} times; use the kit type scale (var(--step-0) … var(--step-5)).`, 'Consistent text sizes');
  if (FILLER.test(html.replace(/<[^>]+>/g, ' '))) take(8, 'There are filler words (like "lorem ipsum"); write real words for this business.', 'Replace filler words with real words about you');
  return { score: Math.max(0, Math.min(100, Math.round(score))), issues: issues.slice(0, 20), tips, scored: true, kind: 'app' };
}

/** What Grandpa is asked when the person taps "Polish the design". */
export function polishRequest(issues = [], kind = 'website') {
  if (kind === 'app') return `Polish this app so it looks and works like a real installed phone app (the APP STANDARD). Keep every screen, feature, record, word the person wrote, and the brand colours. Fix these points from the design check:\n${issues.map((issue) => `- ${issue}`).join('\n')}\nUse the kit app parts where they help (gk-app-bar, gk-appbar, gk-list/gk-row, gk-stats-row, gk-fab, gk-sheet, gk-empty, gk-segmented). Return every changed file completely.`;
  return `Polish the design of this website so it looks premium and finished. Keep every page, feature, word the person wrote, and the brand colours. Fix these points from the design check:\n${issues.map((issue) => `- ${issue}`).join('\n')}\nUse the Grandpa Kit 18 premium sections where they help (gk-split hero, gk-section-head, gk-bento, gk-feature-rows, gk-cta-band, gk-footer-cols). Return every changed file completely.`;
}
