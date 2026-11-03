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
    if (state.info.appData && state.tab === 'inbox') state.tab = 'data';
    render();
    await loadTab();
  } catch (error) { if (!error.quiet) root.replaceChildren(h('h1', { text: 'Manage your website' }), h('p', { class: 'msg error', role: 'alert', text: error.message })); }
}

function render() {
  const info = state.info;
  const tabs = [...(info.appData ? [['data', 'App data']] : []), ['inbox', `Inbox${info.newEntries ? ` (${info.newEntries})` : ''}`], ['content', 'Prices & text'], ['shop', 'Shop & bookings'], ['visitors', 'Visitors'], ['settings', 'Settings']];
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
    else if (state.tab === 'shop') { state.entries = (await api('/entries?kind=booking')).entries; showShop(); }
    else if (state.tab === 'data') { state.data = await api('/app-data'); await showData(); }
    else showSettings();
  } catch (error) { if (!error.quiet) panel().replaceChildren(h('p', { class: 'msg error', role: 'alert', text: error.message })); }
}

/* ---- inbox --------------------------------------------------------------- */
const FILTERS = [['all', 'All'], ['new', 'New'], ['message', 'Messages'], ['booking', 'Bookings'], ['order', 'Orders'], ['signup', 'Sign-ups'], ['cancelled', 'Cancelled']];
const phoneOf = (fields) => {
  for (const [key, value] of Object.entries(fields)) if (/phone|tel|mobile|whats|number|contact/i.test(key) && /\d{6,}/.test(value.replace(/[\s()-]/g, ''))) return value;
  return Object.values(fields).find((value) => /^\+?[\d\s()-]{7,20}$/.test(value)) || '';
};
const emailOf = (fields) => Object.values(fields).find((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) || '';
const when = (iso) => { try { return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); } catch { return iso; } };

function showInbox() {
  const shown = state.entries.filter((e) => state.filter === 'all' || (state.filter === 'new' || state.filter === 'cancelled' ? e.status === state.filter : e.kind === state.filter));
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
  const setStatus = async (next) => {
    try { await api(`/entries/${entry.id}`, { method: 'PATCH', body: { status: next } }); entry.status = next;
      state.info.newEntries = state.entries.filter((e) => e.status === 'new').length; render(); if (state.tab === 'shop') showShop(); else showInbox(); } catch (error) { if (!error.quiet) message(status, error.message); }
  };
  const card = h('article', { class: `card entry${entry.status !== 'new' ? ' done' : ''}` },
    h('div', { class: 'top' },
      h('span', {}, h('span', { class: `badge${entry.status === 'new' ? ' new' : ''}`, text: `${KIND_NAMES[entry.kind] || 'Form'}${entry.status === 'new' ? ' · new' : entry.status === 'cancelled' ? ' · cancelled' : ''}` })),
      h('span', { class: 'when', text: `${when(entry.createdAt)} · Ref ${entry.id.slice(0, 8).toUpperCase()}` })),
    h('dl', {}, Object.entries(entry.fields).flatMap(([key, value]) => [h('dt', { text: key }), h('dd', { text: value })])),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: entry.status === 'new' ? 'primary' : '', text: entry.status === 'new' ? (entry.kind === 'booking' ? '✓ Confirm' : '✓ Mark done') : '↺ Mark new', onclick: () => setStatus(entry.status === 'new' ? 'done' : 'new') }),
      entry.kind === 'booking' && entry.status !== 'cancelled' ? h('button', { type: 'button', text: 'Cancel booking', onclick: () => { if (confirm('Cancel this booking? Its time becomes free again.')) setStatus('cancelled'); } }) : null,
      digits.length >= 7 ? h('a', { class: 'button', href: `https://wa.me/${digits}`, target: '_blank', rel: 'noopener', text: 'WhatsApp' }) : null,
      digits.length >= 7 ? h('a', { class: 'button', href: `tel:${phone.replace(/[^\d+]/g, '')}`, text: 'Call' }) : null,
      email ? h('a', { class: 'button', href: `mailto:${encodeURIComponent(email).replace(/%40/g, '@')}`, text: 'Email' }) : null,
      h('button', { type: 'button', text: 'Invoice / receipt', onclick: () => showDocument(entry) }),
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

/* ---- invoices and receipts ---------------------------------------------- */
// Made in this browser and printed; the phone's print screen saves it as a PDF.
const BUSINESS_KEY = `gp-doc-business:${slug}`;
const number = (text) => { const n = Number(String(text ?? '').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : 0; };
const money = (n) => n.toLocaleString(undefined, { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });

// An order from the website's cart: "Jollof rice × 2 = LRD 700; Fufu × 1 = LRD 250".
function cartLines(items) {
  if (!items || !/ × \d/.test(items)) return null;
  const lines = items.split('; ').map((part) => {
    const m = /^(.*) × (\d+)(?: = (.*))?$/.exec(part.trim());
    if (!m) return null;
    const qty = Number(m[2]), amount = number(m[3] || '');
    return { item: m[1], qty: String(qty), price: amount && qty ? String(Math.round((amount / qty) * 100) / 100) : '' };
  }).filter(Boolean);
  return lines.length ? lines : null;
}

function showDocument(entry) {
  const ref = entry.id.slice(0, 8).toUpperCase();
  const f = entry.fields;
  const pick = (re) => Object.entries(f).find(([k]) => re.test(k))?.[1] || '';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(BUSINESS_KEY) || '{}'); } catch { saved = {}; }
  const doc = {
    type: 'Invoice', number: `INV-${ref}`, date: new Date().toISOString().slice(0, 10),
    business: saved.business || state.info.name || '', contact: saved.contact || '', currency: saved.currency || 'LRD',
    billTo: [pick(/name/i), phoneOf(f), emailOf(f), pick(/address|location/i)].filter(Boolean).join('\n'),
    lines: cartLines(f.items) || [{ item: pick(/item|order|product|service|menu/i) || `${KIND_NAMES[entry.kind] || 'Order'} ${ref}`, qty: pick(/qty|quantity|people|number of/i).replace(/[^\d.]/g, '') || '1', price: '' }],
    notes: 'Thank you for your business.',
  };
  const sheet = h('article', { class: 'doc-sheet' });
  const draw = () => {
    const total = doc.lines.reduce((sum, l) => sum + number(l.qty) * number(l.price), 0);
    sheet.replaceChildren(
      h('header', { class: 'doc-head' },
        h('div', {}, h('h2', { text: doc.business || 'Your business' }), h('p', { class: 'doc-contact', text: doc.contact })),
        h('div', { class: 'doc-meta' }, h('strong', { class: 'doc-type', text: doc.type.toUpperCase() }), h('div', { text: `No. ${doc.number}` }), h('div', { text: doc.date }))),
      h('div', { class: 'doc-to' }, h('div', { class: 'note', text: doc.type === 'Receipt' ? 'Received from' : 'Bill to' }), h('p', { text: doc.billTo })),
      h('table', {}, h('thead', {}, h('tr', {}, h('th', { text: 'Item' }), h('th', { text: 'Qty' }), h('th', { text: `Price (${doc.currency})` }), h('th', { text: `Amount (${doc.currency})` }))),
        h('tbody', {}, doc.lines.filter((l) => l.item || l.price).map((l) => h('tr', {}, h('td', { text: l.item }), h('td', { text: l.qty }), h('td', { text: money(number(l.price)) }), h('td', { text: money(number(l.qty) * number(l.price)) })))),
        h('tfoot', {}, h('tr', {}, h('td', { colspan: 3, text: doc.type === 'Receipt' ? 'Total paid' : 'Total due' }), h('td', { text: `${doc.currency} ${money(total)}` })))),
      doc.notes ? h('p', { class: 'doc-notes', text: doc.notes }) : null,
      h('p', { class: 'note', text: `Reference ${ref}` }));
  };
  const field = (label, key, attrs = {}) => h('label', {}, label, h(attrs.multiline ? 'textarea' : 'input', { value: attrs.multiline ? null : doc[key], type: attrs.type || null,
    oninput: (e) => { doc[key] = e.target.value; if (['business', 'contact', 'currency'].includes(key)) { try { localStorage.setItem(BUSINESS_KEY, JSON.stringify({ business: doc.business, contact: doc.contact, currency: doc.currency })); } catch { /* private mode */ } } draw(); } }, attrs.multiline ? doc[key] : null));
  const linesBox = h('div');
  const drawLines = () => linesBox.replaceChildren(...doc.lines.map((l, i) => h('div', { class: 'list-row' },
    h('label', {}, 'Item', h('input', { value: l.item, oninput: (e) => { l.item = e.target.value; draw(); } })),
    h('div', { class: 'doc-pair' },
      h('label', {}, 'Qty', h('input', { value: l.qty, inputmode: 'decimal', oninput: (e) => { l.qty = e.target.value; draw(); } })),
      h('label', {}, 'Price', h('input', { value: l.price, inputmode: 'decimal', oninput: (e) => { l.price = e.target.value; draw(); } }))),
    doc.lines.length > 1 ? h('div', { class: 'row' }, h('button', { type: 'button', class: 'danger', text: 'Remove', onclick: () => { doc.lines.splice(i, 1); drawLines(); draw(); } })) : null)),
    h('button', { type: 'button', text: '+ Add a line', onclick: () => { doc.lines.push({ item: '', qty: '1', price: '' }); drawLines(); draw(); } }));
  const typeSelect = h('select', { onchange: (e) => {
    doc.type = e.target.value;
    doc.number = `${doc.type === 'Receipt' ? 'RCT' : 'INV'}-${ref}`; numberInput.value = doc.number;
    if (/^(Thank you for your business\.|Paid in full\. Thank you\.)$/.test(doc.notes)) { doc.notes = doc.type === 'Receipt' ? 'Paid in full. Thank you.' : 'Thank you for your business.'; notesInput.value = doc.notes; }
    draw();
  } }, h('option', { text: 'Invoice' }), h('option', { text: 'Receipt' }));
  const numberField = field('Number', 'number'), numberInput = numberField.querySelector('input');
  const notesField = field('Notes', 'notes', { multiline: true }), notesInput = notesField.querySelector('textarea');
  drawLines(); draw();
  root.replaceChildren(
    h('div', { class: 'no-print' },
      h('button', { type: 'button', text: '← Back to the inbox', onclick: () => { render(); loadTab(); } }),
      h('h1', { text: 'Invoice or receipt', style: 'margin-top:12px' }),
      h('div', { class: 'card' },
        h('label', {}, 'Document', typeSelect), numberField, field('Date', 'date', { type: 'date' }),
        field('Your business name', 'business'), field('Your phone, address (shown at the top)', 'contact'), field('Customer', 'billTo', { multiline: true }), field('Currency', 'currency'),
        h('h2', { text: 'Items', style: 'margin-top:12px' }), linesBox, notesField),
      h('button', { type: 'button', class: 'primary full', text: '🖨 Print or save as PDF', onclick: () => window.print() }),
      h('p', { class: 'note', text: 'On a phone, choose "Save as PDF" in the print screen, then share it on WhatsApp.' }),
      h('h2', { text: 'Preview', style: 'margin-top:18px' })),
    sheet);
  scrollTo(0, 0);
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

/* ---- shop and bookings --------------------------------------------------- */
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function showShop() {
  const saved = state.info.settings || {};
  const b = { on: false, days: [1, 2, 3, 4, 5, 6], open: '08:00', close: '17:00', slot: 30, capacity: 1, ahead: 60, closed: [], offset: 0, ...(saved.booking || {}) };
  const shop = { currency: 'LRD', payment: '', delivery: '', ...(saved.shop || {}) };
  const status = h('p', { class: 'msg', role: 'status' });
  const input = (label, value, attrs, set) => h('label', {}, label, h('input', { value, ...attrs, oninput: (e) => set(e.target.value) }));
  const closedBox = h('textarea', { 'aria-label': 'Closed dates', placeholder: '2026-12-25, 2027-01-01' }, b.closed.join(', '));
  const save = h('button', { type: 'button', class: 'primary full', text: 'Save shop and booking settings', onclick: async () => {
    save.disabled = true;
    b.closed = closedBox.value.split(/[\s,]+/).filter(Boolean);
    try { const result = await api('/settings', { method: 'PUT', body: { settings: { booking: b, shop } } }); state.info.settings = result.settings; message(status, 'Saved. The website uses these settings straight away.', true); }
    catch (error) { if (!error.quiet) message(status, error.message); } finally { save.disabled = false; }
  } });
  const todayText = new Date().toISOString().slice(0, 10);
  const upcoming = state.entries.filter((e) => e.status !== 'cancelled' && (e.fields.date || '') >= todayText)
    .sort((x, y) => `${x.fields.date} ${x.fields.time || ''}`.localeCompare(`${y.fields.date} ${y.fields.time || ''}`));
  let lastDate = '';
  panel().replaceChildren(
    h('div', { class: 'card' }, h('h2', { text: 'Bookings' }),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: b.on, onchange: (e) => { b.on = e.target.checked; } }), ' Take bookings at set times'),
      h('p', { class: 'note', text: 'Visitors see only the free times. A full time cannot be booked twice.' }),
      h('div', { class: 'chips', style: 'margin-top:10px' }, DAY_NAMES.map((name, d) => h('button', { type: 'button', 'aria-pressed': String(b.days.includes(d)), text: name,
        onclick: (e) => { b.days = b.days.includes(d) ? b.days.filter((x) => x !== d) : [...b.days, d].sort(); e.target.setAttribute('aria-pressed', String(b.days.includes(d))); } }))),
      h('div', { class: 'doc-pair' }, input('Opens', b.open, { type: 'time' }, (v) => { b.open = v; }), input('Closes', b.close, { type: 'time' }, (v) => { b.close = v; })),
      h('div', { class: 'doc-pair' },
        h('label', {}, 'Each booking', h('select', { onchange: (e) => { b.slot = Number(e.target.value); } }, [15, 20, 30, 45, 60, 90, 120].map((m) => h('option', { value: m, selected: b.slot === m, text: m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? 's' : ''}` })))),
        input('People per time', b.capacity, { type: 'number', min: 1, max: 50, inputmode: 'numeric' }, (v) => { b.capacity = Number(v); })),
      input('How many days ahead', b.ahead, { type: 'number', min: 1, max: 365, inputmode: 'numeric' }, (v) => { b.ahead = Number(v); }),
      h('label', {}, 'Closed dates (holidays)', closedBox)),
    h('div', { class: 'card' }, h('h2', { text: 'Shop' }),
      h('p', { class: 'note', text: 'Used by "Add to cart" buttons on your website.' }),
      input('Currency', shop.currency, { maxlength: 12 }, (v) => { shop.currency = v; }),
      h('label', {}, 'How customers pay', h('textarea', { placeholder: 'Pay on delivery, or send Orange Money / MTN MoMo to 0886 000 000 with your reference.', oninput: (e) => { shop.payment = e.target.value; } }, shop.payment)),
      h('label', {}, 'Delivery or pick-up', h('textarea', { placeholder: 'Free delivery in Monrovia. Pick-up on Broad Street.', oninput: (e) => { shop.delivery = e.target.value; } }, shop.delivery))),
    save, status,
    h('h2', { text: 'Upcoming bookings', style: 'margin-top:20px' }),
    upcoming.length ? upcoming.flatMap((entry) => {
      const head = entry.fields.date !== lastDate ? h('h3', { class: 'agenda-day', text: new Date(`${entry.fields.date}T12:00:00Z`).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }) }) : null;
      lastDate = entry.fields.date;
      return [head, entryCard(entry)];
    }) : h('p', { class: 'empty', text: 'No upcoming bookings.' }));
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

/* ---- app data (Phase D1): the app's own database --------------------------- */
async function db(path, { method = 'GET', body } = {}) {
  const response = await fetch(`/api/app-db/${encodeURIComponent(slug)}${path}`, { method, headers: { 'X-App-Key': store.get(), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'That did not work. Try again.');
  return result;
}
const shown = (field, value) => (value == null || value === '' ? '' : field.type === 'boolean' ? (value ? 'Yes' : 'No') : field.type === 'money' ? Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : field.type === 'datetime' ? when(value) : String(value));
const csvCell = (value) => { const text = value == null ? '' : String(value); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
function saveFile(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = h('a', { href: url, download: name }); document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function showData() {
  const { schema, usage, problem, teamPasscode } = state.data;
  if (!schema) { panel().replaceChildren(h('p', { class: 'msg error', role: 'alert', text: problem ? `This app's data design has a mistake: ${problem}. Ask Grandpa to fix data/schema.json, then publish again.` : 'This app has no database.' })); return; }
  const tables = Object.entries(schema.tables);
  state.table = schema.tables[state.table] ? state.table : tables[0][0];
  const percent = (a, b) => `${Math.min(100, Math.round((a / b) * 100))}%`;
  const mb = (n) => `${(n / 1048576).toFixed(n < 10_485_760 ? 1 : 0)} MB`;
  const status = h('p', { class: 'msg', role: 'status' });
  const owner = `${state.info.url}#app-key=${store.get()}`;
  const passInput = h('input', { type: 'password', id: 'team-passcode', autocomplete: 'new-password', minlength: 6, maxlength: 64 });
  const parts = [
    h('div', { class: 'card' }, h('h2', { text: 'Use the app' }),
      h('p', { class: 'note', text: 'Open the app as its owner on this phone or computer. Its data is shared by everyone who uses the app.' }),
      h('div', { class: 'row' }, h('a', { class: 'button primary', href: owner, target: '_blank', rel: 'noopener', text: 'Open the app as owner' }))),
    h('div', { class: 'card' }, h('h2', { text: 'How full the database is' }),
      h('ul', { class: 'bars' },
        h('li', {}, h('span', { text: 'Records' }), h('span', { class: 'bar', style: `width:${percent(usage.records, usage.limits.records)}` }), h('span', { text: `${usage.records.toLocaleString()} of ${usage.limits.records.toLocaleString()}` })),
        h('li', {}, h('span', { text: 'Space' }), h('span', { class: 'bar', style: `width:${percent(usage.bytes, usage.limits.bytes)}` }), h('span', { text: `${mb(usage.bytes)} of ${mb(usage.limits.bytes)}` })),
        h('li', {}, h('span', { text: 'Saves today' }), h('span', { class: 'bar', style: `width:${percent(usage.writesToday, usage.limits.writesPerDay)}` }), h('span', { text: `${usage.writesToday.toLocaleString()} of ${usage.limits.writesPerDay.toLocaleString()}` })))),
    h('form', { class: 'card', onsubmit: async (event) => {
      event.preventDefault();
      if (passInput.value.length < 6) { message(status, 'Use at least 6 characters.'); return; }
      try { await api('/team-passcode', { method: 'POST', body: { passcode: passInput.value } }); state.data.teamPasscode = true; passInput.value = ''; message(status, 'Saved. Give the passcode to your staff: the app asks for it the first time they open it.', true); }
      catch (error) { if (!error.quiet) message(status, error.message); }
    } }, h('h2', { text: 'Team passcode' }),
    h('p', { class: 'note', text: teamPasscode ? 'Staff sign in to the app with this passcode. Changing it signs every staff phone out.' : 'Private tables can only be opened by you until you set a passcode for your staff.' }),
    h('label', { for: 'team-passcode', text: teamPasscode ? 'New team passcode' : 'Team passcode (at least 6 characters)' }), passInput,
    h('div', { class: 'row' }, h('button', { type: 'submit', class: 'primary', text: teamPasscode ? 'Change' : 'Set passcode' }),
      teamPasscode ? h('button', { type: 'button', class: 'danger', text: 'Remove and sign staff out', onclick: async () => {
        if (!confirm('Staff will no longer be able to open the private parts of the app.')) return;
        try { await api('/team-passcode', { method: 'POST', body: { passcode: '' } }); state.data.teamPasscode = false; await showData(); } catch (error) { if (!error.quiet) message(status, error.message); }
      } }) : null), status),
    h('nav', { class: 'tabs', 'aria-label': 'Tables' }, tables.map(([name, t]) => h('button', { type: 'button', 'aria-selected': String(state.table === name), text: t.label, onclick: () => { state.table = name; state.search = ''; state.page = 0; showData(); } }))),
    h('div', { id: 'records', class: 'card' }, h('p', { class: 'note', text: 'Loading…' })),
    h('div', { class: 'card' }, h('h2', { text: 'Download' }), h('div', { class: 'row' },
      h('button', { type: 'button', text: `⬇ ${schema.tables[state.table].label} as a spreadsheet (CSV)`, onclick: () => downloadTable(schema) }),
      h('button', { type: 'button', text: '⬇ Everything (backup)', onclick: async () => {
        try { const all = await api('/app-data/export'); saveFile(`${slug}-data-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(all, null, 1), 'application/json'); } catch (error) { if (!error.quiet) alert(error.message); }
      } }))),
  ];
  if (state.data.accounts) parts.splice(3, 0, h('div', { id: 'accounts', class: 'card' }, h('p', { class: 'note', text: 'Loading accounts…' })));
  parts.push(h('div', { id: 'code', class: 'card', hidden: true }));
  parts.push(h('div', { id: 'messages', class: 'card' }, h('p', { class: 'note', text: 'Loading messages…' })));
  parts.push(h('div', { id: 'payments', class: 'card' }, h('p', { class: 'note', text: 'Loading payments…' })));
  parts.push(h('div', { id: 'activity', class: 'card' }, h('p', { class: 'note', text: 'Loading activity…' })));
  panel().replaceChildren(...parts);
  if (state.data.accounts) await showAccounts();
  showCode();
  showMessages();
  showPayments();
  showActivity();
  await showRecords(schema);
}

/* ---- the app's accounts (Phase D2) ---------------------------------------- */
async function showAccounts() {
  const box = document.getElementById('accounts');
  try {
    const { accounts, users, invites } = await api('/app-users');
    state.users = Object.fromEntries(users.map((u) => [u.id, u.name]));
    const status = h('p', { class: 'msg', role: 'status' });
    const roleChoice = (value, onchange, label) => h('select', { 'aria-label': label, onchange }, accounts.roles.map((r) => h('option', { value: r, text: r, selected: r === value })));
    const change = async (id, body, done) => { try { await api(`/app-users/${encodeURIComponent(id)}`, { method: 'PATCH', body }); message(status, done, true); await showAccounts(); } catch (error) { if (!error.quiet) message(status, error.message); } };
    let inviteRole = accounts.roles[0];
    box.replaceChildren(
      h('h2', { text: `App users (${users.length})` }),
      h('p', { class: 'note', text: accounts.signup === 'open' ? `Anyone can create an account; new accounts are "${accounts.defaultRole}". Give staff an invite code to make them staff.` : accounts.signup === 'invite' ? 'People need an invite code from you to create an account.' : 'Only people you invite can join.' }),
      users.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', { text: 'Name' }), h('th', { text: 'Phone or username' }), h('th', { text: 'Role' }), h('th', { text: 'Joined' }), h('th', {}))),
        h('tbody', {}, users.map((u) => h('tr', {},
          h('td', { text: `${u.name}${u.disabled ? ' (switched off)' : ''}` }), h('td', { text: u.login }),
          h('td', {}, roleChoice(u.role, (e) => change(u.id, { role: e.target.value }, `${u.name} is now ${e.target.value}.`), `Role of ${u.name}`)),
          h('td', { text: when(u.created) }),
          h('td', {},
            h('button', { type: 'button', text: 'Reset password', onclick: () => {
              const password = prompt(`New password for ${u.name} (at least 6 characters). Tell them, and they can change it in the app.`);
              if (password) change(u.id, { password }, `Password reset. Give ${u.name} the new password.`);
            } }),
            h('button', { type: 'button', text: u.disabled ? 'Switch on' : 'Switch off', onclick: () => change(u.id, { disabled: !u.disabled }, u.disabled ? `${u.name} can sign in again.` : `${u.name} is signed out and cannot sign in.`) }),
            h('button', { type: 'button', class: 'danger', text: 'Delete', onclick: async () => {
              if (!confirm(`Delete ${u.name}'s account? What they added stays in the app.`)) return;
              try { await api(`/app-users/${encodeURIComponent(u.id)}`, { method: 'DELETE' }); await showAccounts(); } catch (error) { if (!error.quiet) message(status, error.message); }
            } }))))))) : h('p', { class: 'note', text: 'No accounts yet. They appear here when people create one in the app.' }),
      h('h3', { text: 'Invite codes' }),
      h('p', { class: 'note', text: 'Someone who creates an account with a code gets its role. Delete a code to stop it working.' }),
      invites.length ? h('ul', { class: 'invites' }, invites.map((i) => h('li', {}, h('strong', { text: i.code }), ` → ${i.role} `,
        h('button', { type: 'button', text: 'Copy', onclick: async (e) => { try { await navigator.clipboard.writeText(i.code); e.target.textContent = 'Copied'; } catch { prompt('Copy this code', i.code); } } }),
        h('button', { type: 'button', class: 'danger', text: 'Delete', onclick: async () => { try { await api(`/app-invites/${encodeURIComponent(i.code)}`, { method: 'DELETE' }); await showAccounts(); } catch (error) { if (!error.quiet) message(status, error.message); } } })))) : null,
      h('div', { class: 'row' }, roleChoice(inviteRole, (e) => { inviteRole = e.target.value; }, 'Role for the new invite code'),
        h('button', { type: 'button', class: 'primary', text: 'Make an invite code', onclick: async () => {
          try { const { invite } = await api('/app-invites', { method: 'POST', body: { role: inviteRole } }); message(status, `New code ${invite.code} for ${invite.role}. Share it with the person.`, true); await showAccounts(); } catch (error) { if (!error.quiet) message(status, error.message); }
        } })),
      status);
  } catch (error) { if (!error.quiet) box.replaceChildren(h('p', { class: 'msg error', role: 'alert', text: error.message })); }
}

async function showRecords(schema) {
  const box = document.getElementById('records');
  const table = schema.tables[state.table], fields = Object.entries(table.fields);
  const page = state.page || 0;
  try {
    const query = new URLSearchParams({ limit: '50', offset: String(page * 50), sort: '-created', ...(state.search ? { q: state.search } : {}) });
    const links = fields.filter(([, f]) => f.type === 'link').map(([k]) => k);
    if (links.length) query.set('expand', links.join(','));
    const { records, total } = await db(`/t/${state.table}?${query}`);
    if (state.data.accounts && !state.users) state.users = Object.fromEntries(((await api('/app-users').catch(() => ({ users: [] }))).users || []).map((u) => [u.id, u.name]));
    const search = h('input', { type: 'search', placeholder: `Search ${table.label}`, 'aria-label': `Search ${table.label}`, value: state.search || '', onchange: (e) => { state.search = e.target.value; state.page = 0; showRecords(schema); } });
    box.replaceChildren(...[
      h('div', { class: 'row' }, h('h2', { text: `${table.label} (${total})` }), h('button', { type: 'button', class: 'primary', text: '+ Add', onclick: () => editRecord(schema, null) }),
        h('button', { type: 'button', text: '⬆ Import from a spreadsheet', onclick: () => importTable(schema) })), search,
      records.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, fields.map(([, f]) => h('th', { text: f.label })), h('th', { text: 'Added' }), state.users ? h('th', { text: 'By' }) : null, h('th', {}))),
        h('tbody', {}, records.map((r) => h('tr', {}, fields.map(([k, f]) => h('td', {}, cell(schema, f, k, r))), h('td', { text: when(r.created) }), state.users ? h('td', { text: state.users[r.by] || '' }) : null,
          h('td', {}, h('button', { type: 'button', text: 'Edit', onclick: () => editRecord(schema, r) }), h('button', { type: 'button', class: 'danger', text: 'Delete', onclick: async () => {
            if (!confirm('Delete this record? This cannot be undone.')) return;
            try { await db(`/t/${state.table}/${encodeURIComponent(r.id)}`, { method: 'DELETE' }); await showRecords(schema); } catch (error) { alert(error.message); }
          } }))))))) : h('p', { class: 'note', text: state.search ? 'Nothing matches.' : 'No records yet. They appear here as people use the app.' }),
      total > 50 ? h('div', { class: 'row' },
        h('button', { type: 'button', text: '← Newer', disabled: page === 0, onclick: () => { state.page = page - 1; showRecords(schema); } }),
        h('span', { class: 'note', text: `${page * 50 + 1}–${Math.min(total, page * 50 + 50)} of ${total}` }),
        h('button', { type: 'button', text: 'Older →', disabled: (page + 1) * 50 >= total, onclick: () => { state.page = page + 1; showRecords(schema); } })) : null].filter(Boolean));
  } catch (error) { box.replaceChildren(h('p', { class: 'msg error', role: 'alert', text: error.message })); }
}

const fileUrl = (id) => `/api/app-db/${encodeURIComponent(slug)}/files/${encodeURIComponent(id)}`;
/** A record's name: its first text, number or choice field. */
const nameOf = (table, r) => { const k = Object.entries(table?.fields || {}).find(([key, f]) => ['text', 'autonumber', 'choice'].includes(f.type) && r?.[key]); return k ? String(r[k[0]]) : r?.id || ''; };
function cell(schema, f, k, r) {
  const value = r[k];
  if (value == null || value === '') return '';
  if (f.type === 'image') return h('a', { href: fileUrl(value), target: '_blank', rel: 'noopener' }, h('img', { src: fileUrl(value), alt: f.label, width: 56, height: 56, class: 'thumb', loading: 'lazy' }));
  if (f.type === 'file') return h('a', { href: fileUrl(value), target: '_blank', rel: 'noopener', text: 'Open file' });
  if (f.type === 'link') return r.linked?.[k] ? nameOf(schema.tables[f.table], r.linked[k]) : '(removed)';
  return shown(f, value);
}
async function uploadFile(file) {
  const response = await fetch(`/api/app-db/${encodeURIComponent(slug)}/files?table=${encodeURIComponent(state.table)}&name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'X-App-Key': store.get(), 'Content-Type': file.type || 'application/octet-stream' }, body: file });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'The file could not be added.');
  return result.id;
}

/** Add or change one record, with an input for each field of its type. */
function editRecord(schema, record) {
  const box = document.getElementById('records'), table = schema.tables[state.table];
  const status = h('p', { class: 'msg', role: 'status' });
  const inputs = Object.entries(table.fields).filter(([, f]) => f.type !== 'autonumber').map(([k, f]) => {
    const value = record?.[k] ?? '';
    if (f.type === 'image' || f.type === 'file') {
      const pick = h('input', { id: `f-${k}`, type: 'file', accept: f.type === 'image' ? 'image/*' : '' });
      pick.keep = value;
      return [k, f, pick];
    }
    if (f.type === 'link') {
      const choose = h('select', { id: `f-${k}` }, h('option', { value: '', text: 'Loading…' }));
      db(`/t/${f.table}?limit=500&sort=created`).then(({ records }) => choose.replaceChildren(h('option', { value: '', text: '—' }), records.map((r) => h('option', { value: r.id, text: nameOf(schema.tables[f.table], r), selected: r.id === value })))).catch(() => {});
      return [k, f, choose];
    }
    const input = f.type === 'choice' ? h('select', { id: `f-${k}` }, h('option', { value: '', text: '—' }), f.options.map((o) => h('option', { value: o, text: o, selected: o === value })))
      : f.type === 'boolean' ? h('select', { id: `f-${k}` }, h('option', { value: '', text: '—' }), h('option', { value: 'true', text: 'Yes', selected: value === true }), h('option', { value: 'false', text: 'No', selected: value === false }))
      : f.type === 'longtext' ? h('textarea', { id: `f-${k}`, rows: 3, text: String(value) })
      : h('input', { id: `f-${k}`, value: f.type === 'datetime' && value ? String(value).slice(0, 16) : String(value),
        type: { number: 'number', integer: 'number', money: 'number', date: 'date', datetime: 'datetime-local', time: 'time', email: 'email', phone: 'tel', url: 'url' }[f.type] || 'text',
        step: f.type === 'money' ? '0.01' : f.type === 'number' ? 'any' : undefined });
    return [k, f, input];
  });
  box.replaceChildren(h('form', { onsubmit: async (event) => {
    event.preventDefault();
    const body = {};
    try {
      for (const [k, f, input] of inputs) {
        if (f.type === 'image' || f.type === 'file') { body[k] = input.files?.[0] ? await uploadFile(input.files[0]) : (input.keep || null); continue; }
        const v = input.value; body[k] = v === '' ? null : f.type === 'boolean' ? v === 'true' : ['number', 'integer', 'money'].includes(f.type) ? Number(v) : f.type === 'datetime' ? new Date(v).toISOString() : v;
      }
      await db(record ? `/t/${state.table}/${encodeURIComponent(record.id)}` : `/t/${state.table}`, { method: record ? 'PATCH' : 'POST', body });
      await showRecords(schema);
    } catch (error) { message(status, error.message); }
  } }, h('h2', { text: record ? `Change ${table.label}` : `Add to ${table.label}` }),
  inputs.map(([k, f, input]) => [h('label', { for: `f-${k}`, text: `${f.label}${f.required ? ' *' : ''}` }), input]),
  status, h('div', { class: 'row' }, h('button', { type: 'submit', class: 'primary', text: 'Save' }), h('button', { type: 'button', text: 'Cancel', onclick: () => showRecords(schema) }))));
}

/** Spreadsheet rows (CSV) into this table: columns are matched to fields by name or label; links by the linked record's name. */
function csvRows(text) {
  const rows = []; let row = [], cellText = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { cellText += '"'; i += 1; } else if (c === '"') quoted = false; else cellText += c; continue; }
    if (c === '"') quoted = true; else if (c === ',' || c === ';' || c === '\t') { row.push(cellText); cellText = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i += 1; row.push(cellText); rows.push(row); row = []; cellText = ''; } else cellText += c;
  }
  if (cellText || row.length) { row.push(cellText); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim()));
}
function importTable(schema) {
  const box = document.getElementById('records'), table = schema.tables[state.table];
  const status = h('p', { class: 'msg', role: 'status' });
  const pick = h('input', { type: 'file', accept: '.csv,text/csv', 'aria-label': 'Spreadsheet file (CSV)' });
  const go = h('button', { type: 'button', class: 'primary', text: 'Import', onclick: async () => {
    const file = pick.files?.[0];
    if (!file) { message(status, 'Choose a CSV file first. In Excel or Google Sheets: File → Download → CSV.'); return; }
    go.disabled = true;
    try {
      const [head, ...lines] = csvRows((await file.text()).replace(/^\ufeff/, ''));
      const norm = (t) => String(t).trim().toLowerCase().replace(/[\s_-]+/g, ' ');
      const columns = head.map((name) => Object.entries(table.fields).find(([k, f]) => norm(k) === norm(name) || norm(f.label) === norm(name))?.[0] || null);
      if (!columns.some(Boolean)) throw new Error(`None of the columns match ${table.label}'s fields: ${Object.values(table.fields).map((f) => f.label).join(', ')}.`);
      const lookups = {};
      for (const k of columns.filter(Boolean)) if (table.fields[k].type === 'link') {
        const { records } = await db(`/t/${table.fields[k].table}?limit=500&sort=created`);
        lookups[k] = new Map(records.flatMap((r) => [[norm(nameOf(schema.tables[table.fields[k].table], r)), r.id], [r.id, r.id]]));
      }
      const rows = lines.map((line) => Object.fromEntries(columns.map((k, i) => [k, line[i]]).filter(([k, v]) => k && v != null && v.trim() !== '' && !['image', 'file', 'autonumber'].includes(table.fields[k].type))
        .map(([k, v]) => [k, table.fields[k].type === 'link' ? (lookups[k].get(norm(v)) || v.trim()) : v.trim()])));
      let added = 0; const problems = [];
      for (let i = 0; i < rows.length; i += 500) {
        const result = await db(`/t/${state.table}/import`, { method: 'POST', body: { rows: rows.slice(i, i + 500) } });
        added += result.added; problems.push(...result.problems.map((p) => ({ ...p, row: p.row + i + 1 })));
      }
      message(status, `${added} added.${problems.length ? ` ${problems.length} could not be added: ${problems.slice(0, 5).map((p) => `row ${p.row}: ${p.error}`).join('; ')}` : ''}`, !problems.length);
      if (added) setTimeout(() => showRecords(schema), problems.length ? 6000 : 1200);
    } catch (error) { message(status, error.message); } finally { go.disabled = false; }
  } });
  box.replaceChildren(h('h2', { text: `Import into ${table.label}` }),
    h('p', { class: 'note', text: `Use a spreadsheet saved as CSV. The first row names the columns: ${Object.values(table.fields).filter((f) => !['image', 'file', 'autonumber'].includes(f.type)).map((f) => f.label).join(', ')}. Every row is checked; rows with a mistake are listed and the rest are added.` }),
    pick, h('div', { class: 'row' }, go, h('button', { type: 'button', text: 'Cancel', onclick: () => showRecords(schema) })), status);
}

/** Who added, changed and removed what, and the alerts the app raised. */
async function showActivity() {
  const box = document.getElementById('activity');
  if (!box) return;
  try {
    const { activity, alerts } = await api('/app-activity');
    box.replaceChildren(...[h('h2', { text: 'Activity' }),
      ...(alerts.length ? [h('h3', { text: 'Alerts' }), h('ul', { class: 'activity' }, alerts.slice(0, 10).map((a) => h('li', {}, h('span', { class: 'note', text: when(a.at) }), ` 🔔 ${a.message}`)))] : []),
      ...(activity.length && alerts.length ? [h('h3', { text: 'Recent changes' })] : []),
      activity.length ? h('ul', { class: 'activity' }, activity.slice(0, 60).map((a) => h('li', {}, h('span', { class: 'note', text: when(a.at) }), ` ${a.who} ${a.action} `, h('strong', { text: a.summary || a.table }), ` (${state.data.schema.tables[a.table]?.label || a.table})`)))
        : h('p', { class: 'note', text: 'Nothing yet. Every addition, change and removal in the app is listed here.' })]);
  } catch (error) { if (!error.quiet) box.replaceChildren(h('p', { class: 'msg error', role: 'alert', text: error.message })); }
}

/* ---- the app's server code and its secret keys (Phase D5) ------------------ */
async function showCode() {
  const box = document.getElementById('code');
  if (!box) return;
  try {
    const { actions, secrets, runsToday, runsPerDay } = await api('/app-code');
    if (!actions.length && !secrets.length) { box.hidden = true; return; }
    const status = h('p', { class: 'msg', role: 'status' });
    const name = h('input', { id: 'secret-name', autocomplete: 'off', maxlength: 40, placeholder: 'PAYMENT_KEY', pattern: '[A-Z][A-Z0-9_]*', required: true });
    const value = h('input', { id: 'secret-value', type: 'password', autocomplete: 'off', maxlength: 4000, required: true });
    box.hidden = false;
    box.replaceChildren(h('h2', { text: 'Server code' }),
      h('p', { class: 'note', text: `Parts of the app that run on Grandpa's server, in a sandbox. Used ${runsToday.toLocaleString()} of ${runsPerDay.toLocaleString()} times today. Mistakes are listed under Activity.` }),
      actions.length ? h('ul', { class: 'activity' }, actions.map((a) => h('li', {}, h('strong', { text: a.name }), ` — can be used by ${a.who}`))) : h('p', { class: 'note', text: 'This version of the app has no server code.' }),
      h('h3', { text: 'Secret keys' }),
      h('p', { class: 'note', text: 'Keys for other services (for example a payment or SMS service). Only the app\'s server code can read them: they are never shown again, here or in the app. Only add keys from services you trust, and never your own passwords.' }),
      secrets.length ? h('ul', { class: 'activity' }, secrets.map((k) => h('li', {}, h('code', { text: k }), ' ', h('button', { type: 'button', class: 'danger', text: 'Remove', onclick: async () => {
        if (!confirm(`Remove ${k}? Server code that uses it will stop working.`)) return;
        try { await api(`/app-secrets/${encodeURIComponent(k)}`, { method: 'DELETE' }); await showCode(); } catch (error) { if (!error.quiet) message(status, error.message); }
      } })))) : h('p', { class: 'note', text: 'No keys yet.' }),
      h('form', { onsubmit: async (event) => {
        event.preventDefault();
        const key = name.value.trim().toUpperCase();
        try { await api(`/app-secrets/${encodeURIComponent(key)}`, { method: 'PUT', body: { value: value.value } }); value.value = ''; name.value = ''; await showCode(); message(document.querySelector('#code .msg'), `Saved ${key}. The server code reads it as app.secrets.${key}.`, true); }
        catch (error) { if (!error.quiet) message(status, error.message); }
      } }, h('label', { for: 'secret-name', text: 'Name (capital letters, like PAYMENT_KEY)' }), name, h('label', { for: 'secret-value', text: 'Key' }), value,
        h('div', { class: 'row' }, h('button', { type: 'submit', class: 'primary', text: 'Save key' }))), status);
  } catch (error) { if (!error.quiet) box.replaceChildren(h('p', { class: 'msg error', role: 'alert', text: error.message })); }
}

/* ---- SMS and email through the owner's own account (Twilio / Resend) ------- */
async function showMessages() {
  const box = document.getElementById('messages');
  if (!box) return;
  try {
    const { connected, settings, sentToday } = await api('/messages');
    const status = h('p', { class: 'msg', role: 'status' });
    const say = (text, ok = false) => message(box.querySelector('.msg') || status, text, ok);
    const field = (id, label, attrs = {}) => [h('label', { for: id, text: label }), h('input', { id, autocomplete: 'off', ...attrs })];
    const value = (id) => document.getElementById(id)?.value || '';
    const channel = (kind, title, help, inputs, body) => h('details', { class: 'connect', open: !connected[kind] },
      h('summary', {}, h('strong', { text: title }), ` — ${connected[kind] ? 'connected ✓' : 'not connected'}`),
      h('p', { class: 'note', text: help }),
      h('form', { onsubmit: async (event) => {
        event.preventDefault();
        try { await api(`/messages/${kind}`, { method: 'PUT', body: body() }); await showMessages(); say(`${title} is connected. Send a test to check it.`, true); } catch (error) { if (!error.quiet) say(error.message); }
      } }, ...inputs, h('div', { class: 'row' }, h('button', { type: 'submit', class: 'primary', text: connected[kind] ? 'Replace the keys' : 'Connect' }),
        connected[kind] ? h('button', { type: 'button', class: 'danger', text: 'Disconnect', onclick: async () => {
          if (!confirm(`Disconnect ${title}? The app stops sending ${kind === 'sms' ? 'SMS' : 'emails'}.`)) return;
          try { await api(`/messages/${kind}`, { method: 'DELETE' }); await showMessages(); } catch (error) { if (!error.quiet) say(error.message); }
        } }) : null)));
    box.replaceChildren(h('h2', { text: 'Messages (SMS and email)' }),
      h('p', { class: 'note', text: `The app sends SMS and email from your own account with the provider, and you pay the provider directly (Grandpa AI does not charge for messages). Sent today: ${sentToday.toLocaleString()} of your limit of ${settings.messagesPerDay.toLocaleString()}.` }),
      channel('sms', 'SMS with Twilio', 'Make a Twilio account (twilio.com), add credit, and copy the Account SID and Auth Token from the Twilio Console. For Liberia, MTN numbers need a sender name (letters, up to 11) rather than a number.',
        [...field('twilio-sid', 'Account SID (starts with AC)', { maxlength: 34 }), ...field('twilio-token', 'Auth Token', { type: 'password', maxlength: 200 }), ...field('twilio-from', 'Sender: your Twilio number (+…) or a name like MamaShop', { maxlength: 16 })],
        () => ({ accountSid: value('twilio-sid'), authToken: value('twilio-token'), from: value('twilio-from') })),
      channel('email', 'Email with Resend', 'Make a Resend account (resend.com; its free plan sends 3,000 emails a month), verify your domain there, and create an API key.',
        [...field('resend-key', 'API key (starts with re_)', { type: 'password', maxlength: 200 }), ...field('resend-from', 'Send from, like orders@yourshop.com', { maxlength: 120 })],
        () => ({ apiKey: value('resend-key'), from: value('resend-from') })),
      h('form', { onsubmit: async (event) => {
        event.preventDefault();
        try { await api('/messages/settings', { method: 'PUT', body: { alertSms: value('alert-sms'), alertEmail: value('alert-email'), country: value('msg-country'), messagesPerDay: value('msg-limit') } }); await showMessages(); say('Saved.', true); } catch (error) { if (!error.quiet) say(error.message); }
      } }, h('h3', { text: 'Send the app\'s alerts to' }),
        h('p', { class: 'note', text: 'Every alert (for example "Stock low" or "New order") is also sent to these people, up to 5 of each. Leave empty to show alerts only in the app.' }),
        h('label', { for: 'alert-sms', text: 'Phone numbers (one per line)' }), h('textarea', { id: 'alert-sms', rows: 2, text: settings.alertSms.join('\n') }),
        h('label', { for: 'alert-email', text: 'Email addresses (one per line)' }), h('textarea', { id: 'alert-email', rows: 2, text: settings.alertEmail.join('\n') }),
        h('label', { for: 'msg-country', text: 'Country code for numbers starting with 0' }), h('input', { id: 'msg-country', inputmode: 'numeric', maxlength: 4, value: settings.country }),
        h('label', { for: 'msg-limit', text: 'Most messages a day (protects your bill)' }), h('input', { id: 'msg-limit', type: 'number', min: 0, max: 5000, value: settings.messagesPerDay }),
        h('div', { class: 'row' }, h('button', { type: 'submit', class: 'primary', text: 'Save' }))),
      (connected.sms || connected.email) ? h('form', { onsubmit: async (event) => {
        event.preventDefault();
        const kind = value('test-channel');
        try { const r = await api('/messages/test', { method: 'POST', body: { channel: kind, to: value('test-to') } }); say(`Test sent to ${r.to}.`, true); } catch (error) { if (!error.quiet) say(error.message); }
      } }, h('h3', { text: 'Send a test' }),
        h('select', { id: 'test-channel', 'aria-label': 'SMS or email' }, connected.sms ? h('option', { value: 'sms', text: 'SMS' }) : null, connected.email ? h('option', { value: 'email', text: 'Email' }) : null),
        h('input', { id: 'test-to', 'aria-label': 'Send the test to', placeholder: '+231… or you@example.com', required: true }),
        h('div', { class: 'row' }, h('button', { type: 'submit', text: 'Send test' }))) : null,
      status);
  } catch (error) { if (!error.quiet) box.replaceChildren(h('p', { class: 'msg error', role: 'alert', text: error.message })); }
}

/* ---- Mobile money through the owner's own MTN MoMo account ---------------- */
async function showPayments() {
  const box = document.getElementById('payments');
  if (!box) return;
  try {
    const { connected, settings, payments } = await api('/payments');
    const status = h('p', { class: 'msg pay-status', role: 'status' });
    const say = (text, ok = false) => { const target = box.querySelector('.pay-status') || status; message(target, text, ok); target.classList.add('pay-status'); }
    const value = (id) => document.getElementById(id)?.value || '';
    const field = (id, label, attrs = {}) => [h('label', { for: id, text: label }), h('input', { id, autocomplete: 'off', ...attrs })];
    const live = settings.momoEnv === 'live';
    box.replaceChildren(h('h2', { text: 'Payments (MTN MoMo)' }),
      h('p', { class: 'note', text: 'Customers pay with MTN Mobile Money and approve on their own phone. The money goes straight to your MoMo merchant account: Grandpa AI never holds it and takes nothing. MTN\'s own fees apply.' }),
      h('p', { class: `msg ${live ? 'ok' : ''}`, text: connected ? (live ? `Connected: LIVE payments in ${settings.currency} (real money).` : 'Connected to MTN\'s TEST system: no real money moves (amounts are in euros there).') : 'Not connected.' }),
      h('details', { open: !connected }, h('summary', { text: connected ? 'Replace the keys' : 'Connect your MoMo account' }),
        h('p', { class: 'note', text: 'Start with the test system: make a free account at momodeveloper.mtn.com, subscribe to "Collections", and make a test API user and key. For real payments you need a MoMo merchant account approved by MTN Liberia (Lonestar); they give you live keys.' }),
        h('form', { onsubmit: async (event) => {
          event.preventDefault();
          try { await api('/payments/momo', { method: 'PUT', body: { subscriptionKey: value('momo-sub'), apiUser: value('momo-user'), apiKey: value('momo-key') } }); await showPayments(); say('Connected. Try a payment in the app.', true); } catch (error) { if (!error.quiet) say(error.message); }
        } }, ...field('momo-sub', 'Collections subscription key (Primary Key, 32 characters)', { type: 'password', maxlength: 32 }), ...field('momo-user', 'API user (id like 1f2e3d4c-…)', { maxlength: 36 }), ...field('momo-key', 'API key', { type: 'password', maxlength: 200 }),
          h('div', { class: 'row' }, h('button', { type: 'submit', class: 'primary', text: 'Save keys' }),
            connected ? h('button', { type: 'button', class: 'danger', text: 'Disconnect', onclick: async () => {
              if (!confirm('Disconnect MoMo? The app stops taking payments.')) return;
              try { await api('/payments/momo', { method: 'DELETE' }); await showPayments(); } catch (error) { if (!error.quiet) say(error.message); }
            } }) : null))),
      h('form', { onsubmit: async (event) => {
        event.preventDefault();
        if (value('momo-env') === 'live' && !live && !confirm('Switch to LIVE payments? Customers will pay real money into your MoMo account. Use the live keys MTN Liberia gave you.')) return;
        try { await api('/payments/settings', { method: 'PUT', body: { momoEnv: value('momo-env'), currency: value('momo-currency'), paymentsPerDay: value('momo-limit') } }); await showPayments(); say('Saved.', true); } catch (error) { if (!error.quiet) say(error.message); }
      } }, h('label', { for: 'momo-env', text: 'Payments' }),
        h('select', { id: 'momo-env' }, h('option', { value: 'sandbox', text: 'Test system (no real money)', selected: !live }), h('option', { value: 'live', text: 'Live — MTN Liberia (real money)', selected: live })),
        h('label', { for: 'momo-currency', text: 'Currency for live payments' }),
        h('select', { id: 'momo-currency' }, ['LRD', 'USD'].map((c) => h('option', { value: c, text: c, selected: settings.currency === c }))),
        h('label', { for: 'momo-limit', text: 'Most payment requests a day' }), h('input', { id: 'momo-limit', type: 'number', min: 0, max: 10000, value: settings.paymentsPerDay }),
        h('div', { class: 'row' }, h('button', { type: 'submit', class: 'primary', text: 'Save' }))),
      h('h3', { text: 'Recent payments' }),
      payments.length ? h('ul', { class: 'activity' }, payments.map((p) => h('li', {}, h('span', { class: 'note', text: when(p.created) }), ` ${p.currency} ${Number(p.amount).toLocaleString()} from ${p.phone} — `,
        h('strong', { text: p.status === 'successful' ? 'paid ✓' : p.status === 'failed' ? `failed${p.reason ? ` (${p.reason})` : ''}` : 'waiting for the customer' }), p.env === 'sandbox' ? ' (test)' : '', p.note ? ` · ${p.note}` : '',
        p.status === 'pending' ? h('button', { type: 'button', text: 'Check', onclick: async () => { try { await api(`/payments/${p.id}/check`, { method: 'POST' }); await showPayments(); } catch (error) { if (!error.quiet) say(error.message); } } }) : null)))
        : h('p', { class: 'note', text: 'No payments yet.' }),
      status);
  } catch (error) { if (!error.quiet) box.replaceChildren(h('p', { class: 'msg error', role: 'alert', text: error.message })); }
}

async function downloadTable(schema) {
  const table = schema.tables[state.table], fields = Object.entries(table.fields);
  try {
    const rows = [];
    for (let offset = 0; offset < 20_000; offset += 500) { const { records, total } = await db(`/t/${state.table}?limit=500&offset=${offset}&sort=created`); rows.push(...records); if (rows.length >= total || !records.length) break; }
    const csv = [['id', ...fields.map(([, f]) => f.label), 'created', 'updated'], ...rows.map((r) => [r.id, ...fields.map(([k, f]) => (['image', 'file'].includes(f.type) && r[k] ? `${location.origin}${fileUrl(r[k])}` : r[k])), r.created, r.updated])].map((line) => line.map(csvCell).join(',')).join('\n');
    saveFile(`${slug}-${state.table}-${new Date().toISOString().slice(0, 10)}.csv`, `﻿${csv}`, 'text/csv');
  } catch (error) { alert(error.message); }
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
  // Backups: everything in one file, and the owner's prices, text and settings back from it.
  const backupStatus = h('p', { class: 'msg', role: 'status' });
  const download = h('button', { type: 'button', text: '⬇ Download all website data', onclick: async () => {
    download.disabled = true;
    try {
      const response = await fetch(`/api/manage/${encodeURIComponent(slug)}/export`, { headers: { 'X-Site-Key': store.get() } });
      if (!response.ok) throw new Error('The backup could not be made. Try again.');
      const url = URL.createObjectURL(await response.blob());
      const link = h('a', { href: url, download: `${slug}-backup-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      message(backupStatus, 'Saved. Keep the file somewhere safe, such as your email or Google Drive.', true);
    } catch (error) { message(backupStatus, error.message); } finally { download.disabled = false; }
  } });
  const restoreInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      if (backup?.kind !== 'grandpa-site-backup') throw new Error('That file is not a backup from Manage.');
      if (!confirm(`Put back the prices, text and settings from ${backup.exportedAt ? new Date(backup.exportedAt).toLocaleDateString() : 'this backup'}? What visitors sent is not changed.`)) return;
      if (backup.content) state.info.content = (await api('/content', { method: 'PUT', body: { content: backup.content } })).content;
      if (backup.settings) state.info.settings = (await api('/settings', { method: 'PUT', body: { settings: backup.settings } })).settings;
      message(backupStatus, 'Restored. The website shows it straight away.', true);
    } catch (error) { if (!error.quiet) message(backupStatus, error instanceof SyntaxError ? 'That file could not be read.' : error.message); }
  } });
  parts.push(h('div', { class: 'card' }, h('h2', { text: 'Backup' }),
    h('p', { class: 'note', text: 'One file with everything visitors sent, your prices and text, booking and shop settings, and visitor counts.' }),
    h('div', { class: 'row' }, download, h('button', { type: 'button', text: 'Restore prices, text and settings', onclick: () => restoreInput.click() })), restoreInput, backupStatus));
  parts.push(h('button', { type: 'button', class: 'full', text: 'Sign out on this phone', onclick: async () => {
    if (!info.publisher) await api('/logout', { method: 'POST' }).catch(() => {});
    store.set(''); showLogin();
  } }));
  panel().replaceChildren(...parts);
}

start();
