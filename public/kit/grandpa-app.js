/* Grandpa Kit 11 — the app toolkit: state, screens, safe rendering, forms, tables, charts, CSV,
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
    if (el) el.innerHTML = content instanceof Raw ? content.text : App.escape(content);
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

  window.GrandpaApp = App;
})();
