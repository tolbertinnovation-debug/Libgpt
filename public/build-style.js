// The style switcher: try another look for a website in one tap, for free. It changes only the brand colours
// (the --brand and --accent CSS variables) and the kit's style and font pairing on every page; the words, pictures
// and layout stay as they are. Each change is saved as a version, so it can be undone like any other.
import { PALETTES } from './build-direction.js?v=score-1';

const page = (f) => /\.html?$/i.test(f.path) && !/^data:/.test(f.body || '');
const sheet = (f) => /\.css$/i.test(f.path) && !/^assets\/grandpa-/.test(f.path) && !/^data:/.test(f.body || '');

/** The names people see, one per colour set. */
export const STYLE_NAMES = Object.freeze({
  harvest: 'Warm harvest', palm: 'Palm green', ocean: 'Ocean blue', clinic: 'Clean teal', royal: 'Royal purple', liberty: 'Liberty blue',
  sunset: 'Sunset red', gold: 'Elegant gold', slate: 'Modern dark', forest: 'Forest green', school: 'School blue', ink: 'Editorial ink',
});

/** Which colour set the website uses now, if it is one of Grandpa's. */
export function currentStyle(files = []) {
  const css = files.filter(sheet).map((f) => f.body).join('\n') + files.filter(page).map((f) => f.body).join('\n');
  const brand = css.match(/--brand\s*:\s*(#[0-9a-f]{6})\b/i)?.[1]?.toLowerCase();
  return Object.keys(PALETTES).find((name) => PALETTES[name].brand === brand) || '';
}

/** Whether a project can be restyled: a website with pages (not an app shell). */
export const canRestyle = (files = []) => files.some(page) && !files.some((f) => page(f) && /class="[^"]*\bgk-app\b/.test(f.body));

const setVar = (css, name, value) => {
  const pattern = new RegExp(`(--${name}\\s*:\\s*)[^;}]+`, 'i');
  return pattern.test(css) ? css.replace(pattern, `$1${value}`) : null;
};

const setHtmlAttr = (html, name, value) => html.replace(/<html\b[^>]*>/i, (tag) => {
  const re = new RegExp(`\\s${name}=("[^"]*"|'[^']*'|\\S+)`, 'i');
  return re.test(tag) ? tag.replace(re, ` ${name}="${value}"`) : tag.replace(/>$/, ` ${name}="${value}">`);
});

/** The files that change for a colour set: [{path, body}]. Empty when nothing would change. */
export function restyle(files = [], name = '') {
  const palette = PALETTES[name];
  if (!palette || !canRestyle(files)) return [];
  const changed = [];
  const put = (file, body) => { if (body !== file.body) changed.push({ path: file.path, body }); };
  const sheets = files.filter(sheet);
  // The stylesheet that sets the brand colours, else the first one, else a <style> in each page.
  let target = sheets.find((f) => /--brand\s*:/i.test(f.body)) || sheets[0];
  const pageStyle = !target && files.filter(page).find((f) => /--brand\s*:/i.test(f.body));
  for (const file of files.filter(page)) {
    let body = setHtmlAttr(setHtmlAttr(file.body, 'data-gk-style', palette.style), 'data-gk-fonts', palette.fonts);
    if (pageStyle && file === pageStyle) body = setVar(setVar(body, 'brand', palette.brand) ?? body, 'accent', palette.accent) ?? body;
    put(file, body);
  }
  if (target) {
    let css = target.body;
    const withBrand = setVar(css, 'brand', palette.brand);
    if (withBrand === null) css = `:root { --brand: ${palette.brand}; --accent: ${palette.accent}; }\n${css}`;
    else css = setVar(withBrand, 'accent', palette.accent) ?? withBrand.replace(/(--brand\s*:[^;}]+;?)/i, `$1 --accent: ${palette.accent};`);
    put(target, css);
  }
  return changed;
}

/** Improvements Grandpa makes on a tap (each is one model call, only when tapped). */
export const IMPROVEMENTS = Object.freeze([
  ['Make the opening stronger', 'Make the home page opening stronger: a gk-split hero with a specific headline that names the place or the result, one lead sentence, two buttons, a gk-trust row and a real photo with a gk-float proof. Keep every word the person wrote elsewhere.'],
  ['Add customer reviews', 'Add a gk-testimonials section to the home page with three short, specific quotes. If the person gave no real reviews, write clear placeholders like "Your customer\'s words here" instead of invented ones.'],
  ['Add a call to action', 'Add a gk-cta-band near the end of the home page asking for the main action of this website (order, book, call, visit or join), with one primary button.'],
  ['Make it feel premium', 'Make this website look premium and finished: consistent spacing, gk-section-head blocks for every section, one .is-dark contrast section, the kit tints for alternate sections, and a gk-footer-cols footer. Keep every page, feature, word and the brand colours.'],
]);
