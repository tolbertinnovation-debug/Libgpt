// The design benchmark: 15 typical one-sentence website requests, built by Grandpa and scored for free with the
// design score. The owner runs it from their own signed-in browser (it uses the access code already saved there),
// so no key or code ever leaves their device. Each build is one normal paid Build request; nothing runs on its own.
import { filesFrom } from './build.js?v=kit-4';
import { scoreDesign } from './design-score.js?v=score-2';

export const PROMPTS = Object.freeze([
  'A website for my restaurant in Sinkor that sells jollof rice, fufu and pepper soup, with delivery',
  'A website for my phone and accessories shop on Broad Street, Monrovia',
  'A website for my barber shop in Paynesville where customers can book a cut',
  'A website for St. Peter\'s Lutheran Church in Monrovia with service times and giving',
  'A website for Bright Future Academy, a primary and junior high school in Gbarnga',
  'A website for a youth farming NGO in Bong County that trains young farmers',
  'A portfolio website for a Liberian photographer who shoots weddings and events',
  'A website for a construction company in Monrovia that builds houses and roads',
  'A website for a small clinic in Buchanan with services, doctors and opening hours',
  'A website for the Liberia Tech Summit 2027 with speakers, programme and registration',
  'A website for my tailoring business that makes African print dresses and suits',
  'A website for a car rental company at Roberts International Airport',
  'A landing page for a mobile money savings app for market women',
  'A website for a guest house in Robertsport for surfers and tourists',
  'A website for a cleaning company that cleans offices and homes in Monrovia',
]);

const CODE_KEY = 'grandpa-ai:code', RESULTS_KEY = 'grandpa-ai:design-benchmark';
const readCode = () => { try { return localStorage.getItem(CODE_KEY) || ''; } catch { return ''; } };
export const loadResults = () => { try { return JSON.parse(localStorage.getItem(RESULTS_KEY) || '[]'); } catch { return []; } };
const saveResults = (results) => { try { localStorage.setItem(RESULTS_KEY, JSON.stringify(results)); } catch { /* private window */ } };

/** One build, the same request Build sends for a new website. Returns the full answer text. */
async function build(prompt, signal) {
  const headers = { 'Content-Type': 'application/json' };
  const code = readCode();
  if (code) headers['x-access-code'] = code;
  const response = await fetch('/api/chat', { method: 'POST', headers, signal, body: JSON.stringify({ mode: 'build', messages: [{ role: 'user', content: prompt }], files: [] }) });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(response.status === 401 ? 'Sign in to Grandpa first (open the home page and enter your access code), then come back.' : data.error || `The server said ${response.status}.`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', text = '', error = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, cut); buffer = buffer.slice(cut + 2);
      const event = block.match(/^event: (.+)$/m)?.[1];
      const data = block.match(/^data: (.+)$/m)?.[1];
      if (!event || !data) continue;
      try {
        const parsed = JSON.parse(data);
        if (event === 'delta') text += parsed.text || '';
        if (event === 'error') error = parsed.error || parsed.message || 'The build stopped.';
      } catch { /* a partial line */ }
    }
  }
  if (!text && error) throw new Error(error);
  return text;
}

/** Score one answer: the files it wrote, the score and the plain tips. */
export function scoreAnswer(prompt, text) {
  const files = (filesFrom(text).files || []).filter((f) => f?.path);
  const result = scoreDesign(files);
  return { prompt, at: Date.now(), files: files.length, pages: files.filter((f) => /\.html?$/i.test(f.path)).length, score: result.scored ? result.score : null, tips: result.tips || [], issues: result.issues || [] };
}

/** A short text summary someone can paste into a chat. */
export function summary(results = []) {
  const scored = results.filter((r) => typeof r.score === 'number');
  if (!scored.length) return 'No results yet.';
  const average = Math.round(scored.reduce((sum, r) => sum + r.score, 0) / scored.length);
  const counts = new Map();
  for (const r of scored) for (const tip of r.tips) counts.set(tip, (counts.get(tip) || 0) + 1);
  const common = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([tip, n]) => `- ${tip} (${n} of ${scored.length})`);
  return [`Design benchmark: ${scored.length} websites, average ${average}/100, ${scored.filter((r) => r.score >= 85).length} at 85 or more.`,
    ...scored.map((r) => `${r.score} — ${r.prompt} (${r.pages} page${r.pages === 1 ? '' : 's'})`),
    ...(results.length > scored.length ? [`${results.length - scored.length} build(s) returned no pages.`] : []),
    'Most common gaps:', ...common].join('\n');
}

export function start(root = document) {
  const $ = (id) => root.getElementById(id);
  let controller = null;
  const render = () => {
    const results = loadResults();
    $('results').innerHTML = results.map((r) => `<li><span class="score ${r.score >= 85 ? 'good' : r.score === null ? 'none' : 'weak'}">${r.score ?? '—'}</span><span>${r.prompt.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}<small>${r.pages} page${r.pages === 1 ? '' : 's'}${r.tips.length ? ' · needs: ' + r.tips.slice(0, 3).join('; ') : ''}</small></span></li>`).join('');
    $('summary').textContent = summary(results);
    $('copy').disabled = !results.length;
  };
  $('run').addEventListener('click', async () => {
    const results = loadResults();
    const left = PROMPTS.filter((p) => !results.some((r) => r.prompt === p));
    if (!left.length) { $('status').textContent = 'All 15 are done. Clear the results to run again.'; return; }
    if (!confirm(`Build ${left.length} test website${left.length === 1 ? '' : 's'}? Each is one normal Build request (about $0.10 each on Meta).`)) return;
    controller = new AbortController();
    $('run').disabled = true; $('stop').hidden = false;
    try {
      for (const [i, prompt] of left.entries()) {
        $('status').textContent = `Building ${i + 1} of ${left.length}: ${prompt}…`;
        const text = await build(prompt, controller.signal);
        results.push(scoreAnswer(prompt, text));
        saveResults(results); render();
      }
      $('status').textContent = 'Done. Tap "Copy the summary" and paste it to Claude.';
    } catch (error) {
      $('status').textContent = controller.signal.aborted ? 'Stopped. Finished builds are kept; Run continues where it stopped.' : `Stopped: ${error.message}`;
    } finally { $('run').disabled = false; $('stop').hidden = true; controller = null; }
  });
  $('stop').addEventListener('click', () => controller?.abort());
  $('copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(summary(loadResults())); $('status').textContent = 'Copied.'; } catch { $('status').textContent = 'Select the summary below and copy it.'; } });
  $('clear').addEventListener('click', () => { if (confirm('Clear all results?')) { saveResults([]); render(); } });
  render();
}
