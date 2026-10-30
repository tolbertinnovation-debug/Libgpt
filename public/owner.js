// Owner Controls: the emergency pause and today's spending for the site owner.
// The admin password lives only in this module's memory: never in storage,
// cookies or the URL, and it is cleared on Lock or when the page closes.
const $ = id => document.getElementById(id);
const LABELS = {build: 'Coding agent', chat: 'Chat', research: 'Research', documents: 'Documents', library: 'Library',
  images: 'Pictures', voice: 'Voice', livetalk: 'Live Talk', execution: 'Code testing'};
let token = '', timer = null;

export const usd = value => `$${(Number(value) || 0).toFixed(value > 0 && value < 0.01 ? 4 : 2)}`;

/** Rows for the spending card: the total first, then every feature with a cap or spending. */
export function spendRows(status) {
  const caps = status.limits?.capabilityDailyUsd || {}, spent = status.capabilityUsd || {};
  const names = [...new Set([...Object.keys(caps), ...Object.keys(spent)])].sort((a, b) => (LABELS[a] || a).localeCompare(LABELS[b] || b));
  return [{name: 'All features', spent: status.reservedUsd || 0, cap: status.limits?.dailyUsd},
    ...names.map(name => ({name: LABELS[name] || name, spent: spent[name] || 0, cap: caps[name]}))];
}

export function errorText(status) {
  if (status === 403) return "That password didn't work. Check it matches RITUAL_ADMIN_TOKEN in Vercel.";
  if (status === 429) return 'Too many tries. Wait a minute, then try again.';
  return 'Grandpa AI could not be reached. Check your connection and try again.';
}

async function call(path, body) {
  const response = await fetch(path, {method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'omit',
    headers: {'x-ritual-admin': token, ...(body ? {'Content-Type': 'application/json'} : {})}, ...(body ? {body: JSON.stringify(body)} : {})});
  if (!response.ok) throw Object.assign(new Error(errorText(response.status)), {status: response.status});
  return response.json();
}

function show(id, text, kind) {
  const node = $(id); node.hidden = !text; node.textContent = text || ''; node.className = `msg${kind ? ` ${kind}` : ''}`;
}

function render(status) {
  const paused = status.paused === true;
  $('state').textContent = paused ? 'Paused: no paid features are running' : 'Running: paid features are on';
  $('state').className = `state ${paused ? 'paused' : 'running'}`;
  $('state-note').textContent = paused ? 'Chat, pictures, voice and the coding agent are stopped until you resume. Saved chats and files still work.'
    : 'Pausing stops every paid feature at once, including requests already running.';
  $('pause').hidden = paused; $('resume').hidden = !paused;
  $('day').textContent = status.day ? `(${status.day})` : '';
  $('spend').replaceChildren(...spendRows(status).map(row => {
    const item = document.createElement('li'), top = document.createElement('div'), name = document.createElement('span'), value = document.createElement('strong');
    top.className = 'top'; name.textContent = row.name;
    const capped = Number.isFinite(row.cap);
    value.textContent = capped ? `${usd(row.spent)} of ${usd(row.cap)}` : usd(row.spent);
    top.append(name, value); item.append(top);
    if (capped) {
      const meter = document.createElement('div'), fill = document.createElement('span'), share = row.cap > 0 ? Math.min(1, row.spent / row.cap) : 1;
      meter.className = 'meter'; fill.style.width = `${Math.round(share * 100)}%`; if (share >= 1) fill.className = 'full';
      meter.setAttribute('role', 'img'); meter.setAttribute('aria-label', `${Math.round(share * 100)}% of today's ${row.name} limit used`);
      meter.append(fill); item.append(meter);
    }
    return item;
  }));
  $('active').textContent = String(status.activeCount ?? '–');
  $('calls').textContent = `${status.callsThisMinute ?? '–'} of ${status.limits?.callsPerMinute ?? '–'}`;
  $('concurrency').textContent = String(status.limits?.concurrency ?? '–');
  $('updated').textContent = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'});
}

async function refresh() {
  try { render(await call('/api/admin/budget')); show('control-msg', ''); }
  catch (error) { if (error.status === 403) return lock(errorText(403)); show('control-msg', error.message, 'error'); }
}

function lock(message = '') {
  token = ''; clearInterval(timer); timer = null;
  $('token').value = ''; $('controls').hidden = true; $('sign-in').hidden = false;
  show('sign-in-msg', message, message ? 'error' : '');
}

async function control(action) {
  const buttons = [$('pause'), $('resume')];
  if (action === 'pause' && !confirm('Pause every paid feature now? Requests already running will stop.')) return;
  buttons.forEach(button => { button.disabled = true; });
  try { render(await call('/api/build/control', {action})); show('control-msg', action === 'pause' ? 'Paused. No paid features will run until you resume.' : 'Resumed. Paid features are on again, within today\'s limits.', 'ok'); }
  catch (error) { show('control-msg', error.message, 'error'); if (error.status === 403) lock(errorText(403)); }
  finally { buttons.forEach(button => { button.disabled = false; }); }
}

// Never inside another site's frame, where a hidden overlay could trick a tap on Pause.
if (typeof window !== 'undefined' && window.self !== window.top) document.documentElement.replaceChildren();
else if (typeof document !== 'undefined' && $('unlock')) {
  $('unlock').addEventListener('submit', async event => {
    event.preventDefault();
    const value = $('token').value.trim();
    if (value.length < 32) return show('sign-in-msg', 'The admin password is at least 32 characters.', 'error');
    $('open').disabled = true; token = value; show('sign-in-msg', '');
    try {
      render(await call('/api/admin/budget'));
      $('token').value = ''; $('sign-in').hidden = true; $('controls').hidden = false;
      timer = setInterval(refresh, 30000);
    } catch (error) { token = ''; show('sign-in-msg', error.message, 'error'); }
    finally { $('open').disabled = false; }
  });
  $('pause').addEventListener('click', () => control('pause'));
  $('resume').addEventListener('click', () => control('resume'));
  $('refresh').addEventListener('click', refresh);
  $('lock').addEventListener('click', () => lock());
  addEventListener('pagehide', () => lock());
}
