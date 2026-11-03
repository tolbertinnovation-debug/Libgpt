// Apps (Phase A1). Only what the person made as an app or web app becomes an
// installable app when published: it can be added to a phone's home screen or
// the Windows Start menu, works offline, and gets a "Get the app" page. An
// ordinary website stays a website. Build marks the home page it sends with
// <meta name="grandpa-app" content="yes">; the project's own files are not changed.

/** Project types that are apps or web apps. */
export const APP_RECIPES = new Set(['app', 'tool', 'game', 'dashboard']);
const APP_WORDS = /\b(?:apps?|application|web ?apps?|pwa|installable|install(?:ed)? on (?:my |the |a )?(?:phone|computer)|android|windows program|desktop program)\b/i;
const MARK = /\s*<meta\s+name=["']grandpa-app["']\s+content=["'][^"']*["']\s*\/?>/gi;

/** Is this project an app? The person's own choice wins; then the project type; then their words. */
export function wantsApp({ installable, recipeId = '', brief = '', files = [] } = {}) {
  if (typeof installable === 'boolean') return installable;
  const home = files.find((f) => f.path === 'index.html');
  if (/<meta\s+name=["']grandpa-app["']\s+content=["']yes["']/i.test(String(home?.body || ''))) return true;
  return APP_RECIPES.has(recipeId) || APP_WORDS.test(String(brief || ''));
}

/** The files to publish, with the home page marked as an app (or the mark removed). */
export function markApp(files = [], app = false) {
  return files.map((f) => {
    if (f.path !== 'index.html' || /^data:/.test(String(f.body || ''))) return f;
    const clean = String(f.body || '').replace(MARK, '');
    if (!app) return clean === f.body ? f : { ...f, body: clean };
    const tag = '<meta name="grandpa-app" content="yes">';
    const body = /<head\b[^>]*>/i.test(clean) ? clean.replace(/<head\b[^>]*>/i, (h) => `${h}\n  ${tag}`) : `${tag}\n${clean}`;
    return { ...f, body };
  });
}
