// Phase 3: remembering the project. A summary worked out from the files
// themselves (free, instant, always current): what the site is for, its pages,
// colours, fonts, contact details and the files the person added. It travels
// with every build request so many small changes stay consistent. Search
// answers "where is the phone number?" straight from the files, with no AI.

const isData = (body) => /^data:/.test(String(body || ''));
const strip = (html) => String(html || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const first = (re, text) => (String(text || '').match(re)?.[1] || '').replace(/\s+/g, ' ').trim();
const counted = (list, limit) => [...list.reduce((m, v) => m.set(v, (m.get(v) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([v]) => v);

export const PHONE = /(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)\d{3}[\s-]?\d{3,4}\b/g;
export const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

/** The summary as plain text (at most about 2,500 characters). */
export function summarize(project) {
  const files = (project?.files || []).filter((f) => f?.path);
  if (!files.length) return '';
  const pages = files.filter((f) => /\.html?$/i.test(f.path) && !isData(f.body));
  const styles = files.filter((f) => /\.css$/i.test(f.path)).map((f) => f.body).join('\n') + pages.map((f) => first(/<style[^>]*>([\s\S]*?)<\/style>/i, f.body)).join('\n');
  const text = pages.map((f) => strip(f.body)).join(' ');
  const lines = [];
  const purpose = String(project?.team?.asked || project?.background?.asked || '').split('\n')[0].slice(0, 300);
  if (project?.name) lines.push(`Project: ${project.name}`);
  if (purpose) lines.push(`Purpose (as first asked): ${purpose}`);
  if (pages.length) {
    lines.push('Pages:');
    for (const page of pages.slice(0, 12)) {
      const title = first(/<title[^>]*>([\s\S]*?)<\/title>/i, page.body) || first(/<h1[^>]*>([\s\S]*?)<\/h1>/i, page.body).replace(/<[^>]+>/g, '');
      const heads = [...page.body.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => strip(m[1])).filter(Boolean).slice(0, 5);
      lines.push(`- ${page.path}${title ? ` — "${title.slice(0, 80)}"` : ''}${heads.length ? `; sections: ${heads.join(', ').slice(0, 160)}` : ''}`);
    }
  }
  const colours = counted([...styles.matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|rgba?\([^)]+\)/gi)].map((m) => m[0].toLowerCase()), 6);
  if (colours.length) lines.push(`Main colours: ${colours.join(', ')}`);
  const vars = [...styles.matchAll(/(--[\w-]+)\s*:\s*([^;}{]+)/g)].slice(0, 8).map((m) => `${m[1]}: ${m[2].trim()}`);
  if (vars.length) lines.push(`CSS variables: ${vars.join('; ').slice(0, 300)}`);
  const fonts = counted([...styles.matchAll(/font-family\s*:\s*([^;}]+)/gi)].map((m) => m[1].trim()), 3);
  if (fonts.length) lines.push(`Fonts: ${fonts.join(' | ').slice(0, 200)}`);
  const header = first(/<(?:header|nav)[^>]*class=["']([^"']+)["']/i, pages.map((f) => f.body).join('\n'));
  if (header) lines.push(`Header/menu classes: ${header.slice(0, 120)}`);
  const phones = [...new Set(text.match(PHONE) || [])].filter((p) => p.replace(/\D/g, '').length >= 7).slice(0, 3);
  const emails = [...new Set(text.match(EMAIL) || [])].slice(0, 3);
  if (phones.length || emails.length) lines.push(`Contact details on the site: ${[...phones, ...emails].join(', ')}`);
  const added = (project?.materials || []).filter((path) => files.some((f) => f.path === path));
  if (added.length) lines.push(`Files the person added (use by path, never rewrite): ${added.join(', ')}`);
  const other = files.filter((f) => !pages.includes(f) && !added.includes(f.path)).map((f) => f.path);
  if (other.length) lines.push(`Other files: ${other.slice(0, 20).join(', ')}`);
  return lines.join('\n').slice(0, 2500);
}

/** Is this a "where is…?" question about the site, rather than a change? */
export const SEARCH_QUESTION = /^(?:where(?:'s| is| are| do| does| can)|which (?:file|page)|find|search(?: for)?|show me where|look for|is there)\b/i;
const STOP = new Set('where is are the a an my our in on of to do does can which file page find search for show me look there it this that what i we you site website'.split(' '));

/** Lines in the project that answer a "where is…" question. */
export function searchProject(files, question, limit = 8) {
  const q = String(question || '').toLowerCase();
  const quoted = first(/["“']([^"”']{2,60})["”']/, question);
  const tests = [];
  if (quoted) tests.push((line) => line.toLowerCase().includes(quoted.toLowerCase()));
  else {
    if (/\b(?:phone|number|call|whatsapp|contact)\b/.test(q)) tests.push((line) => (line.match(PHONE) || []).some((p) => p.replace(/\D/g, '').length >= 7));
    if (/\b(?:email|e-mail|mail)\b/.test(q)) tests.push((line) => EMAIL.test(line) && !(EMAIL.lastIndex = 0));
    if (/\b(?:logo|image|picture|photo)\b/.test(q)) tests.push((line) => /<img\b|background(?:-image)?\s*:\s*url/i.test(line));
    if (/\b(?:price|prices|cost|fee|fees)\b/.test(q)) tests.push((line) => /(?:\$|LD|L\$|USD|\bprice\b)\s*\d|\d[\d,]*\s*(?:LD|USD|dollars)/i.test(line));
    if (/\b(?:menu|nav|navigation)\b/.test(q)) tests.push((line) => /<nav\b|class=["'][^"']*(?:menu|nav)/i.test(line));
    const words = q.replace(/[^\w\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
    if (!tests.length && words.length) tests.push((line) => words.every((w) => line.toLowerCase().includes(w)));
    if (!tests.length) return [];
  }
  const found = [];
  for (const file of files || []) {
    if (!file?.path || isData(file.body)) continue;
    const lines = String(file.body || '').split('\n');
    for (let i = 0; i < lines.length && found.length < limit; i += 1) {
      if (tests.some((test) => test(lines[i]))) found.push({ path: file.path, line: i + 1, text: lines[i].trim().slice(0, 160) });
    }
  }
  return found;
}
