/* Grandpa Kit 14 — the app toolkit: state, screens, safe rendering, forms, tables, charts, CSV,
   game loop, sounds, timers and formatting for web tools, quizzes, games, dashboards and phone-style
   apps. No build step, no outside services. window.GrandpaApp */
(function () {
  'use strict';
  if (window.GrandpaApp) return;
  var App = {};

  /* ---- safe HTML: values are escaped unless wrapped in App.raw() ---- */
  function Raw(text) { this.text = String(text); }
  App.raw = function (text) { return new Raw(text); };
  App.escape = function (value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };
  function piece(value) {
    if (value instanceof Raw) return value.text;
    if (Array.isArray(value)) return value.map(piece).join('');
    if (value === false || value == null) return '';
    return App.escape(value);
  }
  /** html`<p>${name}</p>` — every value is escaped; arrays are joined; App.raw() passes markup through. */
  App.html = function (strings) {
    var out = strings[0];
    for (var i = 1; i < arguments.length; i++) out += piece(arguments[i]) + strings[i];
    return new Raw(out);
  };
  /** Put html into an element (or a selector). */
  App.render = function (target, content) {
    var el = typeof target === 'string' ? document.querySelector(target) : target;
    var one = function (c) { return c instanceof Raw ? c.text : App.escape(c); };
    // A list of pieces (items.map(…App.html`…`)) is joined; anything else is shown as text.
    if (el) el.innerHTML = Array.isArray(content) ? content.map(one).join('') : one(content);
    return el;
  };

  /* ---- state: one store, listeners redraw from it ---- */
  // On the shared sites address every published site has the same origin, so saved keys carry the site's address.
  var parts = String((typeof location !== 'undefined' && location.pathname) || '').split('/');
  var SITE = (parts[1] === 's' ? parts[2] : parts[1]) || '';
  function memory(name) {
    var key = (SITE ? SITE + ':' : '') + name;
    // Published Grandpa sites run in a sandbox where localStorage is blocked; window.name keeps
    // data for this tab only. Elsewhere localStorage keeps it on this device.
    return {
      read: function () {
        try { var v = localStorage.getItem(key); if (v != null) return JSON.parse(v); } catch (e) { /* sandbox */ }
        try { var n = String(window.name || ''); var tag = 'gkapp:' + key + ':'; if (n.indexOf(tag) === 0) return JSON.parse(n.slice(tag.length)); } catch (e) { /* ignore */ }
        return undefined;
      },
      write: function (value) {
        var text = JSON.stringify(value);
        try { localStorage.setItem(key, text); return 'device'; } catch (e) { /* sandbox */ }
        try { window.name = 'gkapp:' + key + ':' + text; return 'tab'; } catch (e) { return 'none'; }
      },
    };
  }
  /** App.store(initial, { remember: 'key' }) → { get, set, subscribe, reset, kept } */
  App.store = function (initial, options) {
    var saved = options && options.remember ? memory(options.remember) : null;
    var start = JSON.parse(JSON.stringify(initial || {}));
    var stored = saved ? saved.read() : undefined;
    var state = stored && typeof stored === 'object' ? Object.assign({}, start, stored) : start;
    var listeners = [];
    var api = {
      kept: 'memory',
      get: function () { return state; },
      set: function (change) {
        var patch = typeof change === 'function' ? change(state) : change;
        state = Object.assign({}, state, patch || {});
        if (saved) api.kept = saved.write(state);
        listeners.slice().forEach(function (fn) { try { fn(state); } catch (e) { console.error(e); } });
        return state;
      },
      subscribe: function (fn) { listeners.push(fn); fn(state); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },
      reset: function () { return api.set(JSON.parse(JSON.stringify(initial || {}))); },
    };
    return api;
  };

  /* ---- screens: <section data-screen="home">, links to #home; the app bar marks the current one ---- */
  App.screens = function (options) {
    var opts = options || {};
    var all = function () { return Array.prototype.slice.call(document.querySelectorAll('[data-screen]')); };
    var first = (all()[0] || {}).getAttribute ? all()[0].getAttribute('data-screen') : '';
    function show() {
      var name = decodeURIComponent(location.hash.slice(1)) || opts.start || first;
      var found = all().some(function (s) { return s.getAttribute('data-screen') === name; });
      if (!found) name = opts.start || first;
      all().forEach(function (s) { s.hidden = s.getAttribute('data-screen') !== name; });
      document.querySelectorAll('a[href^="#"]').forEach(function (a) {
        if (a.closest('.gk-appbar, [data-screen-nav]')) { if (a.getAttribute('href') === '#' + name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
      });
      var screen = document.querySelector('[data-screen="' + name + '"]');
      var heading = screen && screen.querySelector('h1, h2');
      // App shell: the bar shows this screen's title; Back shows on screens that are not tabs.
      var title = screen && (screen.getAttribute('data-title') || (heading && heading.textContent) || '');
      if (title) document.querySelectorAll('[data-app-title]').forEach(function (t) { t.textContent = title; });
      var tab = document.querySelector('.gk-appbar a[href="#' + name + '"]') || name === (opts.start || first);
      document.querySelectorAll('[data-app-back]').forEach(function (b) {
        b.hidden = Boolean(tab);
        if (!b._gk) { b._gk = 1; b.addEventListener('click', function () { if (history.length > 1) history.back(); else location.hash = opts.start || first; }); }
      });
      if (heading && opts.focus !== false && App._shown) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
      App._shown = true;
      window.scrollTo(0, 0);
      if (opts.onShow) opts.onShow(name);
      if (opts[name]) opts[name](screen);
    }
    window.addEventListener('hashchange', show);
    show();
    return { go: function (name) { location.hash = name; } };
  };

  /* ---- forms: checks with friendly messages beside each field ---- */
  var MESSAGES = { required: 'Please fill this in.', email: 'Write an email like name@example.com.', number: 'Write a number.', min: 'The smallest allowed is {v}.', max: 'The largest allowed is {v}.', minLength: 'Write at least {v} characters.', pattern: 'This does not look right.' };
  /** App.form(form, { rules: { age: { required: true, number: true, min: 1 } }, onSubmit(values, form) }) */
  App.form = function (target, options) {
    var form = typeof target === 'string' ? document.querySelector(target) : target;
    if (!form) return null;
    var rules = (options && options.rules) || {};
    form.setAttribute('novalidate', '');
    // The message boxes exist (empty) from the start, so a message never moves the button being tapped.
    function errorBox(field, name) {
      var id = (field.id || ('gk-f-' + name)) + '-error';
      var box = document.getElementById(id);
      if (!box) { box = document.createElement('small'); box.id = id; box.className = 'gk-field-error'; box.setAttribute('aria-live', 'polite'); field.insertAdjacentElement('afterend', box); }
      return box;
    }
    Array.prototype.forEach.call(form.elements, function (field) { if (field.name && !/^(submit|button|reset|hidden)$/.test(field.type)) errorBox(field, field.name); });
    function check(name) {
      var field = form.elements.namedItem(name); if (!field || !field.tagName) return '';
      var value = String(field.value || '').trim(), r = rules[name] || {};
      var problem = '';
      if ((r.required || field.required) && !value) problem = r.message || MESSAGES.required;
      else if (value && (r.email || field.type === 'email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) problem = MESSAGES.email;
      else if (value && (r.number || field.type === 'number') && !isFinite(Number(value.replace(/,/g, '')))) problem = MESSAGES.number;
      else if (value && r.min != null && Number(value.replace(/,/g, '')) < r.min) problem = MESSAGES.min.replace('{v}', r.min);
      else if (value && r.max != null && Number(value.replace(/,/g, '')) > r.max) problem = MESSAGES.max.replace('{v}', r.max);
      else if (value && r.minLength && value.length < r.minLength) problem = MESSAGES.minLength.replace('{v}', r.minLength);
      else if (value && r.pattern && !new RegExp(r.pattern).test(value)) problem = r.message || MESSAGES.pattern;
      var box = errorBox(field, name);
      box.textContent = problem;
      field.setAttribute('aria-invalid', problem ? 'true' : 'false');
      field.setAttribute('aria-describedby', box.id);
      return problem;
    }
    Array.prototype.forEach.call(form.elements, function (field) { if (field.name) field.addEventListener('blur', function () { check(field.name); }); });
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var names = []; Array.prototype.forEach.call(form.elements, function (f) { if (f.name && names.indexOf(f.name) < 0) names.push(f.name); });
      var bad = names.filter(function (n) { return check(n); });
      if (bad.length) { form.elements.namedItem(bad[0]).focus(); return; }
      // namedItem, because a field called "item" or "length" would otherwise read the collection's own method.
      var values = {}; names.forEach(function (n) { var f = form.elements.namedItem(n); values[n] = f.type === 'checkbox' ? f.checked : f.value; });
      if (options && options.onSubmit) options.onSubmit(values, form);
    });
    return { check: check };
  };

  /* ---- formatting ---- */
  App.format = {
    number: function (n, digits) { return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: digits == null ? 2 : digits }); },
    money: function (n, currency) { return (currency || 'LRD') + ' ' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 }); },
    date: function (d) { var x = d instanceof Date ? d : new Date(d); return isNaN(x) ? '' : x.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); },
    percent: function (n) { return Math.round(Number(n || 0) * 100) + '%'; },
  };

  /* ---- tables: search and sort ---- */
  /** App.table(el, { columns: [{ key, label, format? }], rows, search: true }) → { update(rows) } */
  App.table = function (target, options) {
    var el = typeof target === 'string' ? document.querySelector(target) : target;
    var rows = options.rows || [], sortKey = '', ascending = true, query = '';
    function draw() {
      var shown = rows.filter(function (r) { return !query || options.columns.some(function (c) { return String(r[c.key] == null ? '' : r[c.key]).toLowerCase().indexOf(query) >= 0; }); });
      if (sortKey) shown = shown.slice().sort(function (a, b) { var x = a[sortKey], y = b[sortKey]; var cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true }); return ascending ? cmp : -cmp; });
      App.render(el, App.html`${options.search ? App.html`<input type="search" class="gk-search" placeholder="Search…" aria-label="Search the table" value="${query}">` : ''}
        <div class="gk-table-wrap"><table class="gk-table"><thead><tr>${options.columns.map(function (c) { return App.html`<th scope="col"><button type="button" data-sort="${c.key}" aria-sort="${sortKey === c.key ? (ascending ? 'ascending' : 'descending') : 'none'}">${c.label}${sortKey === c.key ? (ascending ? ' ▲' : ' ▼') : ''}</button></th>`; })}</tr></thead>
        <tbody>${shown.length ? shown.map(function (r) { return App.html`<tr>${options.columns.map(function (c) { return App.html`<td>${c.format ? c.format(r[c.key], r) : r[c.key]}</td>`; })}</tr>`; }) : App.html`<tr><td colspan="${options.columns.length}">Nothing to show yet.</td></tr>`}</tbody></table></div>`);
      var box = el.querySelector('input[type=search]');
      if (box) { box.addEventListener('input', function () { query = box.value.trim().toLowerCase(); var at = box.selectionStart; draw(); var again = el.querySelector('input[type=search]'); again.focus(); again.setSelectionRange(at, at); }); }
      el.querySelectorAll('[data-sort]').forEach(function (b) { b.addEventListener('click', function () { var k = b.getAttribute('data-sort'); ascending = sortKey === k ? !ascending : true; sortKey = k; draw(); }); });
    }
    draw();
    return { update: function (next) { rows = next || []; draw(); } };
  };

  /* ---- charts: accessible SVG (bar, line, pie) ---- */
  var COLOURS = ['var(--brand,#1a56db)', 'var(--accent,#f59e0b)', '#16a34a', '#db2777', '#7c3aed', '#0891b2', '#ea580c', '#64748b'];
  /** The chart as SVG text: { type: 'bar'|'line'|'pie', labels, values, title } */
  App.chartSvg = function (o) {
    var labels = o.labels || [], values = (o.values || []).map(Number), title = App.escape(o.title || 'Chart');
    var max = Math.max.apply(null, values.concat([1])), W = 320, H = 200, pad = 28;
    var summary = labels.map(function (l, i) { return App.escape(l) + ': ' + App.format.number(values[i]); }).join(', ');
    var body = '';
    if (o.type === 'pie') {
      var total = values.reduce(function (a, b) { return a + b; }, 0) || 1, angle = -Math.PI / 2;
      values.forEach(function (v, i) {
        var slice = (v / total) * Math.PI * 2, x1 = 100 + 80 * Math.cos(angle), y1 = 100 + 80 * Math.sin(angle);
        angle += slice; var x2 = 100 + 80 * Math.cos(angle), y2 = 100 + 80 * Math.sin(angle);
        body += '<path d="M100,100 L' + x1.toFixed(1) + ',' + y1.toFixed(1) + ' A80,80 0 ' + (slice > Math.PI ? 1 : 0) + ',1 ' + x2.toFixed(1) + ',' + y2.toFixed(1) + ' Z" fill="' + COLOURS[i % COLOURS.length] + '"><title>' + App.escape(labels[i]) + ': ' + App.format.number(v) + '</title></path>';
        body += '<rect x="200" y="' + (20 + i * 22) + '" width="12" height="12" fill="' + COLOURS[i % COLOURS.length] + '"/><text x="218" y="' + (31 + i * 22) + '" font-size="12" fill="currentColor">' + App.escape(labels[i]) + '</text>';
      });
    } else {
      var step = (W - pad * 2) / Math.max(1, values.length);
      var y = function (v) { return H - pad - (v / max) * (H - pad * 2); };
      body += '<line x1="' + pad + '" y1="' + (H - pad) + '" x2="' + (W - pad) + '" y2="' + (H - pad) + '" stroke="currentColor" stroke-opacity=".3"/>';
      if (o.type === 'line') {
        var pts = values.map(function (v, i) { return (pad + step * i + step / 2).toFixed(1) + ',' + y(v).toFixed(1); });
        body += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + COLOURS[0] + '" stroke-width="3" stroke-linejoin="round"/>';
        values.forEach(function (v, i) { body += '<circle cx="' + (pad + step * i + step / 2).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="4" fill="' + COLOURS[0] + '"><title>' + App.escape(labels[i]) + ': ' + App.format.number(v) + '</title></circle>'; });
      } else {
        values.forEach(function (v, i) { body += '<rect x="' + (pad + step * i + step * 0.15).toFixed(1) + '" y="' + y(v).toFixed(1) + '" width="' + (step * 0.7).toFixed(1) + '" height="' + (H - pad - y(v)).toFixed(1) + '" rx="4" fill="' + COLOURS[i % COLOURS.length] + '"><title>' + App.escape(labels[i]) + ': ' + App.format.number(v) + '</title></rect>'; });
      }
      labels.forEach(function (l, i) { body += '<text x="' + (pad + step * i + step / 2).toFixed(1) + '" y="' + (H - 8) + '" font-size="11" text-anchor="middle" fill="currentColor">' + App.escape(String(l).slice(0, 10)) + '</text>'; });
    }
    return '<svg class="gk-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + title + ': ' + summary + '"><title>' + title + '</title>' + body + '</svg>';
  };
  App.chart = function (target, options) { return App.render(target, App.raw(App.chartSvg(options))); };

  /* ---- CSV download (opens in Excel) ---- */
  App.csv = function (rows, filename) {
    var list = rows || []; var keys = list.length ? Object.keys(list[0]) : [];
    var cell = function (v) { var t = String(v == null ? '' : v); if (/^[=+\-@]/.test(t)) t = "'" + t; return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    var text = '﻿' + [keys.join(',')].concat(list.map(function (r) { return keys.map(function (k) { return cell(r[k]); }).join(','); })).join('\r\n');
    var url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    var a = document.createElement('a'); a.href = url; a.download = filename || 'data.csv'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  };

  /* ---- games: a loop that pauses when the page is hidden ---- */
  /** App.loop(update(dtSeconds), draw()) → { start, stop, running } */
  App.loop = function (update, draw) {
    var id = 0, last = 0, api = { running: false };
    function frame(t) { var dt = Math.min(0.1, (t - (last || t)) / 1000); last = t; update(dt); if (draw) draw(); if (api.running) id = requestAnimationFrame(frame); }
    api.start = function () { if (api.running) return; api.running = true; last = 0; id = requestAnimationFrame(frame); };
    api.stop = function () { api.running = false; cancelAnimationFrame(id); };
    document.addEventListener('visibilitychange', function () { if (document.hidden && api.running) { api.stop(); api.paused = true; } });
    return api;
  };
  var audio = null;
  /** A short beep (only after the person has tapped something): App.sound(440, 0.15, 'square') */
  App.sound = function (frequency, seconds, type) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      var osc = audio.createOscillator(), gain = audio.createGain();
      osc.type = type || 'sine'; osc.frequency.value = frequency || 440;
      gain.gain.setValueAtTime(0.15, audio.currentTime); gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + (seconds || 0.15));
      osc.connect(gain).connect(audio.destination); osc.start(); osc.stop(audio.currentTime + (seconds || 0.15));
    } catch (e) { /* no sound on this device */ }
  };
  /** App.timer(seconds, onTick(left), onDone) → { stop } */
  App.timer = function (seconds, onTick, onDone) {
    var left = seconds, id = setInterval(function () { left -= 1; if (onTick) onTick(left); if (left <= 0) { clearInterval(id); if (onDone) onDone(); } }, 1000);
    if (onTick) onTick(left);
    return { stop: function () { clearInterval(id); } };
  };
  /** A short message at the bottom of the screen. */
  App.toast = function (message) {
    var note = document.createElement('div'); note.className = 'gk-note'; note.setAttribute('role', 'status'); note.textContent = message;
    document.body.appendChild(note); setTimeout(function () { if (note.parentNode) note.parentNode.removeChild(note); }, 3000);
  };

  /* ---- database (Phase D1): App.db('sales').add(data) / list({ where, sort, limit, offset, q }) / get(id) /
     update(id, changes) / remove(id) / summary({ by, sum, where }); App.db.onChange(fn); App.db.ready().
     On a published app it is the app's own online database (shared by every phone and computer, kept on
     Grandpa AI's server); in Build's preview and in downloaded copies it is a test database on this device. ---- */
  var DB = { slug: '', mode: '', key: '', info: null, listeners: [], versions: null, local: null, schema: null, signing: null };
  function dbStore(name, value) { try { if (value === undefined) return JSON.parse(localStorage.getItem(name) || 'null'); if (value === null) localStorage.removeItem(name); else localStorage.setItem(name, JSON.stringify(value)); } catch (e) { return null; } return null; }
  function dbSetup() {
    if (DB.mode) return;
    var site = window.GrandpaSite;
    if (site && site.slug) {
      DB.mode = 'cloud'; DB.slug = site.slug;
      var m = /(?:^#|&)app-key=([A-Za-z0-9_-]{32,128})/.exec(location.hash || '');
      if (m) { dbStore('gk-db-key:' + DB.slug, m[1]); try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { location.hash = ''; } }
      DB.key = dbStore('gk-db-key:' + DB.slug) || '';
      window.addEventListener('online', function () { dbFlush(); });
    } else {
      DB.mode = 'local';
      var given = window.GrandpaPreviewData || {};
      DB.schema = given.schema || null;
      var saved = given.schema ? null : dbStore('gk-db-local:' + location.pathname);
      DB.local = saved || { seq: 0, tables: {} };
      if (!saved && given.sample) Object.keys(given.sample).forEach(function (t) { (given.sample[t] || []).forEach(function (r) { try { dbLocalAdd(t, r); } catch (e) { if (window.console) console.warn('Sample data for ' + t + ': ' + e.message); } }); });
    }
  }
  function dbError(message) { var e = new Error(message || 'Something went wrong. Try again.'); return e; }

  // Test database on this device (Build's preview and downloaded copies).
  function dbLocalCheck(table, data, partial) {
    var t = DB.schema && DB.schema.tables && DB.schema.tables[table];
    if (DB.schema && !t) throw dbError('This app has no table called "' + table + '". Add it to data/schema.json.');
    if (!t) return data;
    var out = {};
    Object.keys(data || {}).forEach(function (k) { if (!t.fields[k] && ['id', 'created', 'updated'].indexOf(k) < 0) throw dbError('There is no field "' + k + '" in the ' + table + ' table.'); });
    Object.keys(t.fields).forEach(function (k) {
      var f = typeof t.fields[k] === 'string' ? { type: t.fields[k] } : t.fields[k], v = data[k], label = f.label || k.replace(/_/g, ' ');
      if (!(k in data)) { if (f.required && !partial) throw dbError(label + ' is required.'); return; }
      if (v === '' || v == null) { if (f.required) throw dbError(label + ' is required.'); out[k] = null; return; }
      if (['number', 'integer', 'money'].indexOf(f.type) >= 0) { v = Number(String(v).replace(/[, ]/g, '')); if (!isFinite(v)) throw dbError(label + ': write a number.'); if (f.min != null && v < f.min) throw dbError(label + ': the smallest allowed is ' + f.min + '.'); if (f.max != null && v > f.max) throw dbError(label + ': the largest allowed is ' + f.max + '.'); }
      if (f.type === 'choice' && (f.options || []).indexOf(String(v)) < 0) throw dbError(label + ': one of ' + (f.options || []).join(', ') + '.');
      if (f.type === 'boolean') v = v === true || v === 'true' || v === 'yes' || v === 1;
      out[k] = v;
    });
    return out;
  }
  function dbLocalSave() { if (!(window.GrandpaPreviewData && window.GrandpaPreviewData.schema)) dbStore('gk-db-local:' + location.pathname, DB.local); }
  function dbLocalAdd(table, data) {
    var rows = DB.local.tables[table] || (DB.local.tables[table] = []), at = new Date(Date.now() + DB.local.seq).toISOString();
    var record = Object.assign({}, dbLocalCheck(table, data, false), { id: 'local-' + (++DB.local.seq), created: at, updated: at, by: null });
    var t = DB.schema && DB.schema.tables && DB.schema.tables[table];
    if (t) Object.keys(t.fields).forEach(function (k) {
      var f = t.fields[k];
      if (f && f.type === 'autonumber') { var key = table + '.' + k, counters = DB.local.counters || (DB.local.counters = {}), n = counters[key] != null ? counters[key] : (f.start != null ? f.start : 1); record[k] = (f.prefix || '') + String(n).padStart(f.digits || 4, '0'); counters[key] = n + 1; }
    });
    rows.push(record); return record;
  }
  // Phase D3 in the preview: links must exist, effects change linked numbers (never below their minimum), alerts are raised.
  function localEffects(table, before, after) {
    var t = DB.schema && DB.schema.tables && DB.schema.tables[table], out = [];
    if (!t) return out;
    Object.keys(t.fields).forEach(function (k) {
      var f = t.fields[k];
      if (f && f.type === 'link' && after && after[k] && after[k] !== (before && before[k]) && !(DB.local.tables[f.table] || []).some(function (r) { return r.id === after[k]; })) throw dbError((f.label || k) + ': that record is not there any more.');
    });
    (t.effects || []).forEach(function (e) {
      var target = t.fields[e.link] && t.fields[e.link].table, m = /^([+-])\s*(.+)$/.exec(String(e.change || '')); if (!target || !m) return;
      var amount = function (r) { return r && r[e.link] ? (/^[a-z]/.test(m[2]) ? Number(r[m[2]]) || 0 : Number(m[2])) * (m[1] === '-' ? -1 : 1) : 0; };
      [[before, -1], [after, 1]].forEach(function (pair) { var r = pair[0]; if (r && r[e.link]) out.push({ table: target, id: r[e.link], field: e.field, delta: pair[1] * amount(r) }); });
    });
    var planned = out.filter(function (c) { return c.delta; }).map(function (c) {
      var r = (DB.local.tables[c.table] || []).filter(function (x) { return x.id === c.id; })[0]; if (!r) return null;
      var f = DB.schema.tables[c.table].fields[c.field], min = f && typeof f === 'object' ? f.min : null, next = (Number(r[c.field]) || 0) + c.delta;
      if (min != null && next < min && c.delta < 0) throw dbError('Not enough ' + ((f && f.label) || c.field) + ': ' + (Number(r[c.field]) || 0) + ' left.');
      return { r: r, field: c.field, next: next, table: c.table };
    }).filter(Boolean);
    return function () { planned.forEach(function (p) { var was = Object.assign({}, p.r); p.r[p.field] = p.next; localAlerts(p.table, was, p.r, 'change'); }); };
  }
  function localAlerts(table, before, after, how) {
    ((DB.schema || {}).alerts || []).forEach(function (a) {
      if (a.table !== table || !after || (a.on && a.on !== 'any' && a.on !== how)) return;
      var hit = function (r) { return Boolean(r) && dbLocalList(table, { where: a.when || {}, limit: 1 }, null, [r]).length > 0; };
      if (!hit(after) || (how === 'change' && a.when && hit(before))) return;
      var alert = { id: 'alert-' + (++DB.local.seq), at: new Date().toISOString(), message: String(a.message).replace(/\{([a-z][a-z0-9_]*)\}/g, function (_, k) { return k === 'by' ? (DB.localUser ? DB.localUser.name : 'Owner') : after[k] == null ? '' : String(after[k]); }), table: table, record: after.id };
      (DB.localAlerts = DB.localAlerts || []).unshift(alert);
      ALERTS.listeners.forEach(function (fn) { fn([alert]); });
    });
  }
  function dbLocalList(table, opts, mine, source) {
    var rows = (source || DB.local.tables[table] || []).filter(mine || function () { return true; }), where = opts.where || {}, q = String(opts.q || '').toLowerCase();
    rows = rows.filter(function (r) {
      return Object.keys(where).every(function (k) {
        var c = where[k], pairs = c !== null && typeof c === 'object' && !Array.isArray(c) ? c : { eq: c };
        return Object.keys(pairs).every(function (op) {
          var have = r[k], want = pairs[op], n = typeof have === 'number';
          var a = n ? have : String(have == null ? '' : have), b = n ? Number(want) : String(want == null ? '' : want);
          return op === 'eq' ? String(have == null ? '' : have) === String(want) : op === 'ne' ? String(have == null ? '' : have) !== String(want) : op === 'contains' ? String(have || '').toLowerCase().indexOf(String(want).toLowerCase()) >= 0
            : op === 'in' ? want.map(String).indexOf(String(have)) >= 0 : have == null ? false : op === 'gt' ? a > b : op === 'gte' ? a >= b : op === 'lt' ? a < b : a <= b;
        });
      }) && (!q || JSON.stringify(r).toLowerCase().indexOf(q) >= 0);
    });
    var s = /^(-)?(.+)$/.exec(opts.sort || '-created');
    rows.sort(function (x, y) { var a = x[s[2]], b = y[s[2]]; var c = a == null ? 1 : b == null ? -1 : typeof a === 'number' ? a - b : String(a).localeCompare(String(b)); return s[1] ? -c : c; });
    var page = rows.slice(opts.offset || 0, (opts.offset || 0) + (opts.limit || 100)), t = DB.schema && DB.schema.tables && DB.schema.tables[table];
    String(opts.expand || '').split(',').forEach(function (k) {
      k = k.trim(); var f = t && t.fields[k]; if (!f || f.type !== 'link') return;
      page = page.map(function (r) { var linked = Object.assign({}, r.linked); linked[k] = (DB.local.tables[f.table] || []).filter(function (x) { return x.id === r[k]; })[0] || null; return Object.assign({}, r, { linked: linked }); });
    });
    page.total = rows.length; return page;
  }
  /** In the preview: what the signed-in test account may do ('all', 'own' or 'none'); the owner may do everything. */
  function localMay(table, action) {
    var t = DB.schema && DB.schema.tables && DB.schema.tables[table], u = DB.localUser;
    if (!t || !u) return 'all';
    var access = t.access || 'team', from = { team: ['team'], 'public-read': action === 'read' ? ['anyone'] : ['team'], 'public-add': action === 'add' ? ['anyone'] : ['team'], public: ['anyone'] }[access];
    var list = t.rules ? [].concat(t.rules[action] || ['team']) : from;
    if (list.indexOf('anyone') >= 0 || list.indexOf('signed-in') >= 0 || list.indexOf(u.role) >= 0) return 'all';
    return list.indexOf('own') >= 0 ? 'own' : 'none';
  }
  function dbLocal(table, op, a, b) {
    var may = localMay(table, op === 'list' || op === 'get' || op === 'summary' ? 'read' : op === 'update' ? 'change' : op);
    if (may === 'none') throw dbError('Your account is not allowed to do that here. Ask the app\'s owner.');
    var mine = function (r) { return may !== 'own' || (r && DB.localUser && r.by === DB.localUser.id); };
    var rows = (DB.local.tables[table] || (DB.local.tables[table] = [])).filter(mine), all = DB.local.tables[table], find = function (id) { return rows.filter(function (r) { return r.id === id; })[0]; }, result;
    if (op === 'add') { var applyAdd = localEffects(table, null, a); result = dbLocalAdd(table, a); result.by = DB.localUser ? DB.localUser.id : null; applyAdd(); localAlerts(table, null, result, 'add'); }
    else if (op === 'list') return dbLocalList(table, a || {}, mine);
    else if (op === 'get') return find(a) || null;
    else if (op === 'update') { var r = find(a); if (!r) throw dbError('That record is not there any more.'); var was = Object.assign({}, r), changes = dbLocalCheck(table, b, true), applyChange = localEffects(table, was, Object.assign({}, r, changes)); Object.assign(r, changes, { updated: new Date().toISOString() }); applyChange(); localAlerts(table, was, r, 'change'); result = r; }
    else if (op === 'remove') { var gone = find(a), i = all.indexOf(gone); if (i >= 0) { localEffects(table, gone, null)(); all.splice(i, 1); } result = i >= 0; }
    else if (op === 'summary') {
      var groups = {}, o = a || {}, by = String(o.by || '').split(':');
      dbLocalList(table, { where: o.where, limit: 1e9 }, mine).forEach(function (r) {
        var v = by[0] ? r[by[0]] : '', key = v == null ? '' : by[1] === 'day' ? String(v).slice(0, 10) : by[1] === 'month' ? String(v).slice(0, 7) : by[1] === 'year' ? String(v).slice(0, 4) : String(v);
        var g = groups[key] || (groups[key] = { key: key, count: 0, sum: 0 }); g.count += 1; if (o.sum) g.sum += Number(r[o.sum]) || 0;
      });
      return Object.keys(groups).sort().map(function (k) { groups[k].sum = Math.round(groups[k].sum * 100) / 100; return groups[k]; });
    }
    dbLocalSave(); dbNotify([table]); return result;
  }

  // The app's online database.
  function dbFetch(method, path, body) {
    return fetch('/api/app-db/' + DB.slug + path, { method: method, headers: Object.assign({ 'X-App-Key': DB.key }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (data) { return { ok: r.ok, status: r.status, data: data }; }); });
  }
  function dbCall(method, path, body) {
    return dbFetch(method, path, body).then(function (r) {
      if (r.status === 401 && r.data.signIn) return dbSignIn().then(function () { return dbCall(method, path, body); });
      if (!r.ok) throw dbError(r.data.error);
      return r.data;
    });
  }
  function dbQueue(list) { if (list === undefined) return dbStore('gk-db-queue:' + DB.slug) || []; dbStore('gk-db-queue:' + DB.slug, list.length ? list : null); return list; }
  function dbFlush() {
    var queue = dbQueue();
    if (!queue.length || DB.flushing) return Promise.resolve();
    DB.flushing = true;
    var next = function () {
      var item = queue[0];
      if (!item) { DB.flushing = false; dbQueue([]); dbNotify(null); return Promise.resolve(); }
      return dbCall(item.method, item.path, item.body).then(function () { queue.shift(); dbQueue(queue); return next(); }, function (e) {
        DB.flushing = false;
        if (e instanceof TypeError) return;   // still offline: keep the rest for later
        queue.shift(); dbQueue(queue); App.toast('A change made offline could not be saved: ' + e.message); return next();
      });
    };
    return next();
  }
  function dbCache(key, value) { var all = dbStore('gk-db-cache:' + DB.slug) || {}; if (value === undefined) return all[key]; all[key] = value; var keys = Object.keys(all); if (keys.length > 30) delete all[keys[0]]; dbStore('gk-db-cache:' + DB.slug, all); return value; }
  function dbCloud(table, op, a, b) {
    var base = '/t/' + encodeURIComponent(table), q = function (o) { var p = []; Object.keys(o || {}).forEach(function (k) { if (o[k] != null && o[k] !== '') p.push(k + '=' + encodeURIComponent(k === 'where' ? JSON.stringify(o[k]) : o[k])); }); return p.length ? '?' + p.join('&') : ''; };
    if (op === 'list' || op === 'summary' || op === 'get') {
      var path = op === 'get' ? base + '/' + encodeURIComponent(a) : op === 'summary' ? base + '/summary' + q(a) : base + q(a);
      return dbFlush().then(function () { return dbCall('GET', path); }).then(function (data) {
        var value = op === 'list' ? data.records : op === 'summary' ? data.groups : data.record;
        if (op === 'list') value.total = data.total;
        dbCache(path, { value: value, total: data.total });
        return value;
      }, function (e) {
        var kept = e instanceof TypeError && dbCache(path);
        if (!kept) throw e instanceof TypeError ? dbError('No internet connection. Connect and try again.') : e;
        var value = kept.value; if (op === 'list') { value.total = kept.total; value.offline = true; }
        return value;
      });
    }
    var method = op === 'add' ? 'POST' : op === 'update' ? 'PATCH' : 'DELETE', path2 = op === 'add' ? base : base + '/' + encodeURIComponent(a), body = op === 'add' ? a : op === 'update' ? b : undefined;
    return dbCall(method, path2, body).then(function (data) { dbNotify([table]); return op === 'remove' ? data.removed : data.record; }, function (e) {
      if (!(e instanceof TypeError)) throw e;
      // Offline: kept on this device and sent when the internet is back.
      dbQueue(dbQueue().concat([{ method: method, path: path2, body: body }]));
      App.toast('Saved on this phone. It will be sent when the internet is back.');
      return op === 'remove' ? true : Object.assign({ id: op === 'add' ? 'offline-' + Date.now() : a, pending: true }, body || {});
    });
  }
  /** Signing in to a private app: the account screen when the app has accounts, otherwise the team passcode. */
  function dbSignIn() {
    if (DB.signing) return DB.signing;
    DB.signing = new Promise(function (resolve) {
      authInfo(true).then(function (info) { if (info.accounts) authScreen(info, resolve); else teamScreen(resolve); }, function () { teamScreen(resolve); });
    });
    return DB.signing;
  }
  /** The team passcode the owner set in Manage (staff phones). */
  function teamScreen(resolve) {
    (function () {
      var box = document.createElement('div'); box.className = 'gk-lock'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
      box.innerHTML = '<form class="gk-lock-card"><h2></h2><p>This app is private. Enter the team passcode the owner gave you.</p><label>Team passcode <input type="password" autocomplete="current-password" required minlength="6"></label><p class="gk-lock-error" role="alert" hidden></p><button class="gk-btn" type="submit">Open the app</button><small>Owner: open the app from Manage → App data to use it on this phone.</small></form>';
      box.querySelector('h2').textContent = document.title || 'Sign in';
      var form = box.querySelector('form'), input = box.querySelector('input'), error = box.querySelector('.gk-lock-error');
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        dbFetch('POST', '/session', { passcode: input.value }).then(function (r) {
          if (!r.ok) { error.textContent = r.data.error || 'That passcode is not right.'; error.hidden = false; return; }
          DB.key = r.data.key; dbStore('gk-db-key:' + DB.slug, DB.key); DB.info = null; box.parentNode.removeChild(box); DB.signing = null; resolve();
        }, function () { error.textContent = 'No internet connection. Connect and try again.'; error.hidden = false; });
      });
      document.body.appendChild(box); input.focus();
    })();
  }
  function dbNotify(tables) { DB.listeners.forEach(function (fn) { try { fn(tables); } catch (e) { /* the app's own problem */ } }); }
  function dbWatch() {
    if (DB.watching || DB.mode !== 'cloud') return;
    DB.watching = true;
    var check = function () {
      if (document.hidden || !DB.listeners.length) return;
      dbFetch('GET', '/versions').then(function (r) {
        if (!r.ok) return;
        var now = r.data.versions || {}, before = DB.versions, changed = before ? Object.keys(now).filter(function (t) { return now[t] !== before[t]; }) : [];
        DB.versions = now;
        if (changed.length) dbNotify(changed);
      }, function () { /* offline */ });
    };
    setInterval(check, 5000); document.addEventListener('visibilitychange', check); check();
  }

  App.db = function (table) {
    dbSetup();
    var run = function (op, a, b) {
      if (DB.mode === 'local') { try { return Promise.resolve(dbLocal(table, op, a, b)); } catch (e) { return Promise.reject(e); } }
      return dbCloud(table, op, a, b);
    };
    return {
      add: function (data) { return run('add', data); },
      list: function (options) { return run('list', options || {}); },
      get: function (id) { return run('get', id); },
      update: function (id, changes) { return run('update', id, changes); },
      remove: function (id) { return run('remove', id); },
      summary: function (options) { return run('summary', options || {}); },
    };
  };
  /** Calls fn(changedTables) when data changes here or on another phone (checked every few seconds). */
  App.db.onChange = function (fn) { dbSetup(); DB.listeners.push(fn); dbWatch(); return function () { DB.listeners = DB.listeners.filter(function (f) { return f !== fn; }); }; };
  /** { mode: 'cloud' | 'local', role: 'owner' | 'team' | 'visitor', tables } */
  App.db.ready = function () {
    dbSetup();
    if (DB.mode === 'local') return Promise.resolve({ mode: 'local', role: DB.localUser ? DB.localUser.role : 'owner', user: DB.localUser || { id: 'owner', name: 'Owner (preview)', login: '', role: 'owner' }, accounts: (DB.schema || {}).accounts || null, tables: (DB.schema || {}).tables || {} });
    return authInfo(true).then(function (info) { return Object.assign({ mode: 'cloud' }, info); });
  };
  App.db.signOut = function () { return App.auth.signOut(); };

  /* ---- Phase D3: photos and files, alerts, the activity log ---- */
  var ALERTS = { listeners: [], seen: '' };
  /** A photo is made smaller on the phone first (at most 1600 pixels, JPEG), so it uploads quickly and saves space. */
  function shrink(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 350000 || typeof createImageBitmap !== 'function') return Promise.resolve(file);
    return createImageBitmap(file).then(function (bitmap) {
      var scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height)), canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return new Promise(function (resolve) { canvas.toBlob(function (blob) { resolve(blob && blob.size < file.size ? new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }) : file); }, 'image/jpeg', 0.85); });
    }, function () { return file; });
  }
  /** App.db.upload(file, { table }) → { id, url }: keep the id in an image or file field of that table. */
  App.db.upload = function (file, options) {
    dbSetup();
    var table = (options && options.table) || '';
    if (!file) return Promise.reject(dbError('Choose a file first.'));
    return shrink(file).then(function (f) {
      if (f.size > 2 * 1024 * 1024) throw dbError('Files must be under 2 MB.');
      if (DB.mode === 'local') {
        return new Promise(function (resolve) {
          var reader = new FileReader();
          reader.onload = function () { var id = 'f_' + ('preview' + Date.now().toString(36) + Math.random().toString(36).slice(2) + 'xxxxxxxxxxxxxxxxxxxxxxxx').slice(0, 24); (DB.localFiles = DB.localFiles || {})[id] = reader.result; resolve({ id: id, url: reader.result, name: f.name, type: f.type, size: f.size }); };
          reader.readAsDataURL(f);
        });
      }
      var send = function () { return fetch('/api/app-db/' + DB.slug + '/files?table=' + encodeURIComponent(table) + '&name=' + encodeURIComponent(f.name || 'file'), { method: 'POST', headers: { 'X-App-Key': DB.key, 'Content-Type': f.type || 'application/octet-stream' }, body: f }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (data) { return { ok: r.ok, status: r.status, data: data }; }); }); };
      return send().then(function (r) {
        if (r.status === 401 && r.data.signIn) return dbSignIn().then(send).then(function (again) { if (!again.ok) throw dbError(again.data.error); return again.data; });
        if (!r.ok) throw dbError(r.data.error);
        return r.data;
      });
    });
  };
  /** The address to show or download a file whose id is in a record. */
  App.db.fileUrl = function (id) {
    dbSetup();
    if (!id) return '';
    if (DB.mode === 'local') return (DB.localFiles || {})[id] || '';
    return '/api/app-db/' + DB.slug + '/files/' + encodeURIComponent(id);
  };
  /** The owner's and team's activity log: [{ at, who, action, table, summary }]. */
  App.db.activity = function () {
    dbSetup();
    if (DB.mode === 'local') return Promise.resolve([]);
    return dbCall('GET', '/activity').then(function (r) { return r.activity; });
  };
  App.alerts = {
    /** Recent alerts for this person ("Stock low: Rice", "New order"). */
    list: function () {
      dbSetup();
      if (DB.mode === 'local') return Promise.resolve((DB.localAlerts || []).slice(0, 50));
      return dbCall('GET', '/alerts').then(function (r) { return r.alerts; });
    },
    /** Calls fn(newAlerts) when new alerts arrive (checked every few seconds); without fn each is shown as a message. */
    watch: function (fn) {
      dbSetup();
      var show = fn || function (list) { list.slice(0, 3).forEach(function (a) { App.toast('🔔 ' + a.message); }); };
      ALERTS.listeners.push(show);
      if (DB.mode === 'local') return function () { ALERTS.listeners = ALERTS.listeners.filter(function (f) { return f !== show; }); };
      App.alerts.list().then(function (list) { ALERTS.seen = list[0] ? list[0].at : new Date().toISOString(); }, function () { ALERTS.seen = new Date().toISOString(); });
      var stop = App.db.onChange(function (tables) {
        if (tables && tables.indexOf('_alerts') < 0) return;
        dbCall('GET', '/alerts?since=' + encodeURIComponent(ALERTS.seen || '')).then(function (r) {
          if (!r.alerts.length) return;
          ALERTS.seen = r.alerts[0].at;
          ALERTS.listeners.forEach(function (f) { f(r.alerts); });
        }, function () { /* offline */ });
      });
      return function () { stop(); ALERTS.listeners = ALERTS.listeners.filter(function (f) { return f !== show; }); };
    },
  };
  /* ---- accounts (Phase D2): App.auth.user() / require() / signIn({ login, password }) / signUp({ name, login, password, code }) /
     signOut() / changePassword(old, new) / onChange(fn). Apps with "accounts" in data/schema.json; the kit shows the
     sign-in and create-account screen itself. In Build's preview you start as the owner and test accounts stay on this device. ---- */
  var AUTH = { listeners: [] };
  function authInfo(fresh) {
    dbSetup();
    // In Build's preview you are the owner until you sign in as a test account.
    if (DB.mode === 'local') return Promise.resolve({ accounts: (DB.schema || {}).accounts || null, user: DB.localUser || { id: 'owner', name: 'Owner (preview)', login: '', role: 'owner' }, role: DB.localUser ? DB.localUser.role : 'owner' });
    if (DB.info && !fresh) return Promise.resolve(DB.info);
    return dbFetch('GET', '/info').then(function (r) { if (!r.ok) throw dbError(r.data.error); DB.info = r.data; return r.data; });
  }
  function authChanged(user) { DB.info = null; AUTH.listeners.forEach(function (fn) { try { fn(user); } catch (e) { /* the app's own problem */ } }); dbNotify(null); }
  function authKeep(result) { DB.key = result.token; dbStore('gk-db-key:' + DB.slug, DB.key); authChanged(result.user); return result.user; }
  function authPost(path, body) { return dbFetch('POST', path, body).then(function (r) { if (!r.ok) throw dbError(r.data.error); return r.data; }); }
  // Test accounts in Build's preview (never sent anywhere).
  function localAccounts() { return DB.localAccounts || (DB.localAccounts = []); }
  App.auth = {
    user: function () { return authInfo().then(function (i) { return i.user || null; }); },
    signIn: function (o) {
      dbSetup(); o = o || {};
      if (DB.mode === 'local') {
        var found = localAccounts().filter(function (u) { return u.login === String(o.login || '').trim().toLowerCase() && u.password === o.password; })[0];
        if (!found) return Promise.reject(dbError('That phone number or username and password do not match.'));
        DB.localUser = found.user; authChanged(found.user); return Promise.resolve(found.user);
      }
      return authPost('/signin', { login: o.login, password: o.password }).then(authKeep);
    },
    signUp: function (o) {
      dbSetup(); o = o || {};
      if (DB.mode === 'local') {
        var acc = (DB.schema || {}).accounts || { defaultRole: 'member' }, login = String(o.login || '').trim().toLowerCase();
        if (String(o.name || '').trim().length < 2) return Promise.reject(dbError('Write your name.'));
        if (login.length < 3) return Promise.reject(dbError('Use your phone number, or a username of 3 to 40 letters and numbers.'));
        if (String(o.password || '').length < 6) return Promise.reject(dbError('Choose a password of 6 to 72 characters.'));
        if (localAccounts().some(function (u) { return u.login === login; })) return Promise.reject(dbError('An account with that phone number or username already exists. Sign in instead.'));
        var user = { id: 'preview-' + (localAccounts().length + 1), name: String(o.name).trim(), login: login, role: acc.defaultRole };
        localAccounts().push({ login: login, password: o.password, user: user });
        DB.localUser = user; authChanged(user); return Promise.resolve(user);
      }
      return authPost('/signup', { name: o.name, login: o.login, password: o.password, code: o.code }).then(authKeep);
    },
    signOut: function () {
      dbSetup();
      if (DB.mode === 'local') { DB.localUser = null; authChanged(null); return Promise.resolve(); }
      // Signing out clears this phone's copy and starts the app afresh, so nothing private stays on the screen.
      var done = function () { DB.key = ''; dbStore('gk-db-key:' + DB.slug, null); dbStore('gk-db-cache:' + DB.slug, null); dbStore('gk-db-queue:' + DB.slug, null); location.reload(); };
      return authPost('/signout').then(done, done);
    },
    changePassword: function (old, password) {
      dbSetup();
      if (DB.mode === 'local') return Promise.resolve();
      return authPost('/password', { old: old, password: password }).then(function (r) { DB.key = r.token; dbStore('gk-db-key:' + DB.slug, DB.key); });
    },
    /** Resolves with the signed-in person, showing the sign-in screen first if nobody is. */
    require: function () { return App.auth.user().then(function (user) { return user || dbSignIn().then(function () { return App.auth.user(); }); }); },
    onChange: function (fn) { AUTH.listeners.push(fn); return function () { AUTH.listeners = AUTH.listeners.filter(function (f) { return f !== fn; }); }; },
  };

  /** The account screen: sign in, or create an account (when the app allows), or the staff team passcode. */
  function authScreen(info, resolve) {
    var acc = info.accounts, canJoin = acc.signup !== 'off';
    var box = document.createElement('div'); box.className = 'gk-lock'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    box.innerHTML = '<div class="gk-lock-card"><h2></h2>'
      + (canJoin ? '<div class="gk-segmented" role="group"><button type="button" data-auth="in" aria-pressed="true">Sign in</button><button type="button" data-auth="up" aria-pressed="false">Create account</button></div>' : '')
      + '<form><label data-only="up" hidden>Your name <input name="name" autocomplete="name"></label>'
      + '<label>Phone number or username <input name="login" autocomplete="username" required></label>'
      + '<label>Password <input name="password" type="password" autocomplete="current-password" required minlength="6"></label>'
      + '<label data-only="up" hidden>Invite code<span class="gk-auth-optional"> (only if the owner gave you one)</span> <input name="code" autocapitalize="characters" autocomplete="off"></label>'
      + '<p class="gk-lock-error" role="alert" hidden></p><button class="gk-btn" type="submit">Sign in</button></form>'
      + '<small>Forgot your password? Ask the app\'s owner to reset it.' + (info.teamPasscode ? ' Staff with the team passcode: <a href="#" data-auth="team">use it here</a>.' : '') + '</small></div>';
    box.querySelector('h2').textContent = document.title || 'Sign in';
    var form = box.querySelector('form'), error = box.querySelector('.gk-lock-error'), button = form.querySelector('button'), mode = 'in';
    if (acc.signup === 'invite') box.querySelector('.gk-auth-optional').textContent = ' (from the app\'s owner)';
    var setMode = function (m) {
      mode = m; error.hidden = true;
      box.querySelectorAll('[data-only="up"]').forEach(function (el) { el.hidden = m !== 'up'; });
      box.querySelectorAll('[data-auth="in"],[data-auth="up"]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-auth') === m)); });
      form.name.required = m === 'up'; form.code.required = m === 'up' && acc.signup === 'invite';
      form.password.setAttribute('autocomplete', m === 'up' ? 'new-password' : 'current-password');
      button.textContent = m === 'up' ? 'Create account' : 'Sign in';
    };
    box.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('[data-auth]'); if (!t) return;
      e.preventDefault();
      if (t.getAttribute('data-auth') === 'team') { box.parentNode.removeChild(box); teamScreen(resolve); } else setMode(t.getAttribute('data-auth'));
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault(); button.disabled = true;
      var o = { name: form.name.value, login: form.login.value, password: form.password.value, code: form.code.value };
      (mode === 'up' ? App.auth.signUp(o) : App.auth.signIn(o)).then(function () { box.parentNode.removeChild(box); DB.signing = null; resolve(); }, function (err) {
        error.textContent = err instanceof TypeError ? 'No internet connection. Connect and try again.' : err.message; error.hidden = false; button.disabled = false;
      });
    });
    document.body.appendChild(box); form.login.focus();
  }


  window.GrandpaApp = App;
})();
