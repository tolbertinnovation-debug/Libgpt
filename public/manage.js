// Manage a published website (Phases C and D): what visitors sent, the site's
// editable prices, menu, hours and notices, visitor counts and the passcode.
// Everything on this page is built with textContent, never from visitor HTML.

const slug = decodeURIComponent(location.pathname.split('/')[2] || '');
const KEY = `gp-site-key:${slug}`;
const root = document.getElementById('app');
const store = {
  get() { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } },
  set(value) { try { if (value) localStorage.setItem(KEY, value); else localStorage.removeItem(KEY); } catch { /* private mode */ } },
};
// Opened from Build: the publishing phone's key arrives in the address fragment
// (never sent to any server) and is kept on this phone only.
const fromBuild = /(?:^#|&)key=([0-9a-f]{32,64})/.exec(location.hash);
if (fromBuild) { store.set(fromBuild[1]); history.replaceState(null, '', location.pathname); }

const state = { info: null, tab: 'inbox', filter: 'all', entries: [], content: null, found: null };
const KIND_NAMES = { message: 'Message', booking: 'Booking', order: 'Order', signup: 'Sign-up', other: 'Form' };

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs || {})) {
    if (value === false || value === null || value === undefined) continue;
    if (name.startsWith('on')) el.addEventListener(name.slice(2), value);
    else if (name === 'text') el.textContent = value;
    else el.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined && child !== false) el.append(child instanceof Node ? child : String(child));
  return el;
}

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`/api/manage/${encodeURIComponent(slug)}${path}`, {
    method, headers: { 'X-Site-Key': store.get(), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  const result = response.headers.get('content-type')?.includes('json') ? await response.json().catch(() => ({})) : {};
  if (response.status === 401) { store.set(''); showLogin(result.error); throw Object.assign(new Error(result.error || 'Sign in again.'), { quiet: true }); }
  if (!response.ok) throw new Error(result.error || 'That did not work. Try again.');
  return result;
}

function message(box, text, ok = false) { box.textContent = text; box.className = `msg ${ok ? 'ok' : 'error'}`; }

/* ---- signing in ---------------------------------------------------------- */
function showLogin(reason = '') {
  const status = h('p', { class: 'msg error', role: 'alert', text: reason && !/Sign in/.test(reason) ? reason : '' });
  const input = h('input', { type: 'password', id: 'passcode', autocomplete: 'current-password', required: true, minlength: 6, maxlength: 64 });
  const go = h('button', { class: 'primary full', type: 'submit', text: 'Sign in' });
  const form = h('form', { class: 'card', onsubmit: async (event) => {
    event.preventDefault();
    go.disabled = true;
    try {
      const response = await fetch(`/api/manage/${encodeURIComponent(slug)}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: input.value }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'That passcode is not right.');
      store.set(result.key);
      await start();
    } catch (error) { message(status, error.message); go.disabled = false; input.select(); }
  } }, h('label', { for: 'passcode', text: 'Passcode' }), input, h('div', { class: 'row' }, go), status,
  h('p', { class: 'note', text: 'The person who made this website in Grandpa AI chooses the passcode, from Build → Publish on the web → Manage.' }));
  root.replaceChildren(h('h1', { text: 'Manage your website' }), h('p', { class: 'lead', text: `/s/${slug}/` }), form);
  input.focus();
}

/* ---- the page ------------------------------------------------------------ */
async function start() {
  if (!slug) { root.replaceChildren(h('p', { class: 'msg error', text: 'This address has no website name in it.' })); return; }
  if (!store.get()) { showLogin(); return; }
  try {
    state.info = await api('');
    render();
    await loadTab();
  } catch (error) { if (!error.quiet) root.replaceChildren(h('h1', { text: 'Manage your website' }), h('p', { class: 'msg error', role: 'alert', text: error.message })); }
}

function render() {
  const info = state.info;
  const tabs = [['inbox', `Inbox${info.newEntries ? ` (${info.newEntries})` : ''}`], ['content', 'Prices & text'], ['visitors', 'Visitors'], ['settings', 'Settings']];
  root.replaceChildren(
    h('h1', { text: info.name || slug }),
    h('p', { class: 'lead' }, h('a', { href: info.url, target: '_blank', rel: 'noopener', text: info.url })),
    h('nav', { class: 'tabs', role: 'tablist' }, tabs.map(([id, label]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(state.tab === id), 'data-tab': id, text: label,
      onclick: () => { state.tab = id; render(); loadTab(); } }))),
    h('section', { id: 'panel', role: 'tabpanel' }, h('p', { class: 'note', text: 'Loading…' })),
  );
}
const panel = () => {
  const el = document.getElementById('panel');
  return { replaceChildren: (...children) => el.replaceChildren(...children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false)) };
};

async function loadTab() {
  try {
    if (state.tab === 'inbox') { state.entries = (await api('/entries')).entries; showInbox(); }
    else if (state.tab === 'content') await showContent();
    else if (state.tab === 'visitors') { state.info = await api(''); showVisitors(); }
    else showSettings();
  } catch (error) { if (!error.quiet) panel().replaceChildren(h('p', { class: 'msg error', role: 'alert', text: error.message })); }
}

/* ---- inbox --------------------------------------------------------------- */
const FILTERS = [['all', 'All'], ['new', 'New'], ['message', 'Messages'], ['booking', 'Bookings'], ['order', 'Orders'], ['signup', 'Sign-ups']];
const phoneOf = (fields) => {
  for (const [key, value] of Object.entries(fields)) if (/phone|tel|mobile|whats|number|contact/i.test(key) && /\d{6,}/.test(value.replace(/[\s()-]/g, ''))) return value;
  return Object.values(fields).find((value) => /^\+?[\d\s()-]{7,20}$/.test(value)) || '';
};
const emailOf = (fields) => Object.values(fields).find((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) || '';
const when = (iso) => { try { return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); } catch { return iso; } };

function showInbox() {
  const shown = state.entries.filter((e) => state.filter === 'all' || (state.filter === 'new' ? e.status === 'new' : e.kind === state.filter));
  const exportButton = h('button', { type: 'button', text: '⬇ Export to Excel (CSV)', onclick: () => exportCsv(exportButton) });
  panel().replaceChildren(
    h('div', { class: 'chips' }, FILTERS.map(([id, label]) => h('button', { type: 'button', 'aria-pressed': String(state.filter === id), text: label, onclick: () => { state.filter = id; showInbox(); } }))),
    shown.length ? shown.map(entryCard) : h('p', { class: 'empty', text: state.entries.length ? 'Nothing here with this filter.' : 'Nothing has been sent yet. When visitors use a form on your website, it appears here.' }),
    state.entries.length ? h('div', { class: 'row' }, exportButton) : null,
  );
}

function entryCard(entry) {
  const phone = phoneOf(entry.fields), email = emailOf(entry.fields);
  const digits = phone.replace(/[^\d]/g, '');
  const status = h('p', { class: 'msg', role: 'status' });
  const card = h('article', { class: `card entry${entry.status === 'done' ? ' done' : ''}` },
    h('div', { class: 'top' },
      h('span', {}, h('span', { class: `badge${entry.status === 'new' ? ' new' : ''}`, text: `${KIND_NAMES[entry.kind] || 'Form'}${entry.status === 'new' ? ' · new' : ''}` })),
      h('span', { class: 'when', text: when(entry.createdAt) })),
    h('dl', {}, Object.entries(entry.fields).flatMap(([key, value]) => [h('dt', { text: key }), h('dd', { text: value })])),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: entry.status === 'new' ? 'primary' : '', text: entry.status === 'new' ? '✓ Mark done' : '↺ Mark new', onclick: async () => {
        try { await api(`/entries/${entry.id}`, { method: 'PATCH', body: { status: entry.status === 'new' ? 'done' : 'new' } }); entry.status = entry.status === 'new' ? 'done' : 'new';
          state.info.newEntries = state.entries.filter((e) => e.status === 'new').length; render(); showInbox(); } catch (error) { if (!error.quiet) message(status, error.message); }
      } }),
      digits.length >= 7 ? h('a', { class: 'button', href: `https://wa.me/${digits}`, target: '_blank', rel: 'noopener', text: 'WhatsApp' }) : null,
      digits.length >= 7 ? h('a', { class: 'button', href: `tel:${phone.replace(/[^\d+]/g, '')}`, text: 'Call' }) : null,
      email ? h('a', { class: 'button', href: `mailto:${email}`, text: 'Email' }) : null,
      h('button', { type: 'button', class: 'danger', text: 'Delete', onclick: async () => {
        if (!confirm('Delete this for good?')) return;
        try { await api(`/entries/${entry.id}`, { method: 'DELETE' }); state.entries = state.entries.filter((e) => e !== entry);
          state.info.newEntries = state.entries.filter((e) => e.status === 'new').length; render(); showInbox(); } catch (error) { if (!error.quiet) message(status, error.message); }
      } })),
    status);
  if (entry.page) card.append(h('p', { class: 'note', text: `Sent from ${entry.page}` }));
  return card;
}

async function exportCsv(button) {
  button.disabled = true;
  try {
    const response = await fetch(`/api/manage/${encodeURIComponent(slug)}/entries?format=csv`, { headers: { 'X-Site-Key': store.get() } });
    if (!response.ok) throw new Error('The export did not work. Try again.');
    const url = URL.createObjectURL(await response.blob());
    const link = h('a', { href: url, download: `${slug}-entries.csv` });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (error) { alert(error.message); } finally { button.disabled = false; }
}

/* ---- prices & text ------------------------------------------------------- */
// The site's pages say what can be changed: data-gk-text="key" and data-gk-list="name".
async function findEditable() {
  const texts = new Map(), lists = new Map();
  for (const page of state.info.pages) {
    const response = await fetch(`/s/${encodeURIComponent(slug)}/${page.split('/').map(encodeURIComponent).join('/')}`).catch(() => null);
    if (!response?.ok) continue;
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    doc.querySelectorAll('[data-gk-text]').forEach((el) => {
      const key = el.getAttribute('data-gk-text');
      if (key && !texts.has(key)) texts.set(key, { key, label: el.getAttribute('data-gk-label') || key.replace(/[-_]/g, ' '), value: el.textContent.trim().replace(/\s+/g, ' '), long: el.textContent.length > 80 || /^(p|div|section)$/i.test(el.tagName) });
    });
    doc.querySelectorAll('[data-gk-list]').forEach((list) => {
      const name = list.getAttribute('data-gk-list');
      if (!name || lists.has(name)) return;
      const items = [...list.querySelectorAll('[data-gk-item]')];
      if (!items.length) return;
      const fields = [];
      const fieldsOf = (item) => [...(item.matches('[data-gk-field]') ? [item] : []), ...item.querySelectorAll('[data-gk-field]')];
      fieldsOf(items[0]).forEach((el) => { const f = el.getAttribute('data-gk-field'); if (f && !fields.includes(f)) fields.push(f); });
      const rows = items.map((item) => Object.fromEntries(fields.map((f) => [f, (fieldsOf(item).find((el) => el.getAttribute('data-gk-field') === f)?.textContent || '').trim().replace(/\s+/g, ' ')])));
      lists.set(name, { name, label: list.getAttribute('data-gk-label') || name.replace(/[-_]/g, ' '), fields, rows });
    });
  }
  return { texts: [...texts.values()], lists: [...lists.values()] };
}

async function showContent() {
  if (!state.found) state.found = await findEditable();
  const saved = state.info.content || { texts: {}, lists: {} };
  const draft = {
    texts: Object.fromEntries(state.found.texts.map((t) => [t.key, Object.hasOwn(saved.texts, t.key) ? saved.texts[t.key] : t.value])),
    lists: Object.fromEntries(state.found.lists.map((l) => [l.name, (Array.isArray(saved.lists[l.name]) ? saved.lists[l.name] : l.rows).map((row) => ({ ...row }))])),
  };
  if (!state.found.texts.length && !state.found.lists.length) {
    panel().replaceChildren(h('div', { class: 'card' }, h('h2', { text: 'Nothing to change here yet' }),
      h('p', { text: 'Ask Grandpa in Build: "Let me change my prices, menu and opening hours from Manage." Then publish the update.' })));
    return;
  }
  const status = h('p', { class: 'msg', role: 'status' });
  const save = h('button', { type: 'button', class: 'primary full', text: 'Save changes to the website', onclick: async () => {
    save.disabled = true;
    try {
      const result = await api('/content', { method: 'PUT', body: { content: draft } });
      state.info.content = result.content;
      message(status, 'Saved. Visitors see the changes when they open or refresh the website.', true);
    } catch (error) { if (!error.quiet) message(status, error.message); } finally { save.disabled = false; }
  } });
  const listCard = (list) => {
    const box = h('div');
    const draw = () => {
      const rows = draft.lists[list.name];
      box.replaceChildren(...rows.map((row, i) => h('div', { class: 'list-row' },
        list.fields.map((f) => h('label', {}, f.replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase()), h('input', { placeholder: f, value: row[f] ?? '', oninput: (e) => { row[f] = e.target.value; } }))),
        h('div', { class: 'row' },
          h('button', { type: 'button', 'aria-label': 'Move up', text: '↑', disabled: i === 0, onclick: () => { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; draw(); } }),
          h('button', { type: 'button', 'aria-label': 'Move down', text: '↓', disabled: i === rows.length - 1, onclick: () => { [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; draw(); } }),
          h('button', { type: 'button', class: 'danger', text: 'Remove', onclick: () => { rows.splice(i, 1); draw(); } })))),
      h('button', { type: 'button', text: '+ Add', onclick: () => { rows.push(Object.fromEntries(list.fields.map((f) => [f, '']))); draw(); box.querySelector('.list-row:last-of-type input')?.focus(); } }));
    };
    draw();
    return h('div', { class: 'card' }, h('h2', { text: list.label.replace(/^./, (c) => c.toUpperCase()) }), box);
  };
  panel().replaceChildren(
    state.found.texts.length ? h('div', { class: 'card' }, h('h2', { text: 'Text' }), state.found.texts.map((t) => [
      h('label', { for: `t-${t.key}`, text: t.label.replace(/^./, (c) => c.toUpperCase()) }),
      h(t.long ? 'textarea' : 'input', { id: `t-${t.key}`, value: t.long ? null : draft.texts[t.key], oninput: (e) => { draft.texts[t.key] = e.target.value; } }, t.long ? draft.texts[t.key] : null),
    ]), h('p', { class: 'note', text: 'Leave a box empty to hide it on the website.' })) : null,
    state.found.lists.map(listCard),
    save, status,
  );
}

/* ---- visitors ------------------------------------------------------------ */
function showVisitors() {
  const visits = state.info.visits || {};
  const days = [];
  for (let i = 13; i >= 0; i--) { const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10); days.push([day, visits[day] || 0]); }
  const week = days.slice(-7).reduce((sum, [, n]) => sum + n, 0);
  const most = Math.max(1, ...days.map(([, n]) => n));
  panel().replaceChildren(h('div', { class: 'card' },
    h('div', { class: 'row' }, h('div', {}, h('div', { class: 'stat', text: String(days.at(-1)[1]) }), h('div', { class: 'note', text: 'pages opened today' })),
      h('div', {}, h('div', { class: 'stat', text: String(week) }), h('div', { class: 'note', text: 'in the last 7 days' }))),
    h('ul', { class: 'bars' }, days.slice().reverse().map(([day, n]) => h('li', {}, h('span', { text: new Date(`${day}T12:00:00Z`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) }),
      h('span', { class: 'bar', style: `width:${Math.round((n / most) * 100)}%` }), h('span', { text: String(n) })))),
    h('p', { class: 'note', text: 'Each time a page of your website is opened. No names, addresses or cookies are kept about visitors.' })));
}

/* ---- settings ------------------------------------------------------------ */
function showSettings() {
  const info = state.info;
  const parts = [];
  if (info.publisher) {
    const status = h('p', { class: 'msg', role: 'status' });
    const input = h('input', { type: 'password', id: 'new-passcode', autocomplete: 'new-password', minlength: 6, maxlength: 64 });
    const save = h('button', { type: 'submit', class: 'primary', text: info.hasPasscode ? 'Change passcode' : 'Set passcode' });
    parts.push(h('form', { class: 'card', onsubmit: async (event) => {
      event.preventDefault();
      if (input.value.length < 6) { message(status, 'Use at least 6 characters.'); return; }
      save.disabled = true;
      try { await api('/passcode', { method: 'PUT', body: { passcode: input.value } }); info.hasPasscode = true; input.value = ''; message(status, 'Saved. Give the passcode and this page\'s address to the business owner.', true); save.textContent = 'Change passcode'; }
      catch (error) { if (!error.quiet) message(status, error.message); } finally { save.disabled = false; }
    } }, h('h2', { text: 'Passcode for the business owner' }),
    h('p', { class: 'note', text: info.hasPasscode ? 'A passcode is set. Changing it signs everyone else out.' : 'Set a passcode so the business owner can open this page on their own phone.' }),
    h('label', { for: 'new-passcode', text: 'New passcode (at least 6 characters)' }), input, h('div', { class: 'row' }, save), status));
    const link = `${location.origin}/manage/${encodeURIComponent(slug)}`;
    parts.push(h('div', { class: 'card' }, h('h2', { text: 'Address of this page' }), h('p', { class: 'lead', text: link }),
      h('div', { class: 'row' },
        h('button', { type: 'button', text: 'Copy', onclick: async (e) => { try { await navigator.clipboard.writeText(link); e.target.textContent = 'Copied'; } catch { prompt('Copy this address', link); } } }),
        navigator.share ? h('button', { type: 'button', text: 'Share', onclick: () => navigator.share({ title: `Manage ${info.name}`, url: link }).catch(() => {}) }) : null,
        h('button', { type: 'button', class: 'danger', text: 'Sign everyone else out', onclick: async () => {
          if (!confirm('Everyone who signed in with the passcode will need to sign in again.')) return;
          try { await api('/sign-out-all', { method: 'POST' }); alert('Done. Everyone else is signed out.'); } catch (error) { if (!error.quiet) alert(error.message); }
        } }))));
  } else {
    parts.push(h('div', { class: 'card' }, h('p', { text: 'You signed in with the passcode. The person who made this website in Grandpa AI can change it.' })));
  }
  parts.push(h('button', { type: 'button', class: 'full', text: 'Sign out on this phone', onclick: async () => {
    if (!info.publisher) await api('/logout', { method: 'POST' }).catch(() => {});
    store.set(''); showLogin();
  } }));
  panel().replaceChildren(...parts);
}

start();
