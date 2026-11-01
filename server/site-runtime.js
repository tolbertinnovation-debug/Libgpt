// The small script every published page gets from Grandpa (Phases C and D):
//  - forms marked data-gk-form are saved to Grandpa Data, so the owner sees
//    them on the Manage page;
//  - text marked data-gk-text="key" and lists marked data-gk-list="name" show
//    what the owner last saved on the Manage page (prices, menu, hours, notices).
// Published pages run in a sandbox with an opaque origin, so this script talks
// to the app only through the public send-only address, never with cookies.

const RUNTIME = String.raw`(function () {
  'use strict';
  if (window.GrandpaSite) return;
  var SLUG = __SLUG__, CONTENT = __CONTENT__, started = Date.now();
  window.GrandpaSite = { slug: SLUG };
  var SUCCESS = {
    message: 'Thank you. Your message was sent.',
    booking: 'Thank you. Your booking request was sent. We will confirm it soon.',
    order: 'Thank you. Your order was sent. We will contact you to confirm it.',
    signup: 'Thank you for signing up.',
    other: 'Thank you. It was sent.'
  };

  function applyContent() {
    var texts = (CONTENT && CONTENT.texts) || {}, lists = (CONTENT && CONTENT.lists) || {};
    Array.prototype.forEach.call(document.querySelectorAll('[data-gk-text]'), function (el) {
      var key = el.getAttribute('data-gk-text');
      if (!Object.prototype.hasOwnProperty.call(texts, key)) return;
      if (texts[key] === '') { el.hidden = true; return; }
      el.hidden = false; el.textContent = texts[key];
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-gk-list]'), function (list) {
      var rows = lists[list.getAttribute('data-gk-list')];
      if (!Array.isArray(rows)) return;
      var items = list.querySelectorAll('[data-gk-item]');
      if (!items.length) return;
      var template = items[0], parent = template.parentNode, marker = document.createComment('gk-list');
      parent.insertBefore(marker, template);
      Array.prototype.forEach.call(items, function (item) { item.parentNode.removeChild(item); });
      rows.forEach(function (row) {
        var copy = template.cloneNode(true);
        var fields = copy.matches('[data-gk-field]') ? [copy] : [];
        fields = fields.concat(Array.prototype.slice.call(copy.querySelectorAll('[data-gk-field]')));
        fields.forEach(function (el) {
          var name = el.getAttribute('data-gk-field'), value = row[name];
          if (value === undefined) return;
          el.textContent = value; el.hidden = value === '';
        });
        if (copy.classList.contains('gk-reveal')) copy.classList.add('is-visible');
        Array.prototype.forEach.call(copy.querySelectorAll('.gk-reveal'), function (el) { el.classList.add('is-visible'); });
        parent.insertBefore(copy, marker);
      });
      parent.removeChild(marker);
    });
  }

  function statusFor(form) {
    var box = form.querySelector('[data-gk-form-status]');
    if (!box) { box = document.createElement('p'); box.className = 'gk-form-status'; box.setAttribute('data-gk-form-status', ''); form.appendChild(box); }
    box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
    return box;
  }

  function wireForm(form) {
    var trap = document.createElement('input');
    trap.type = 'text'; trap.name = '_gotcha'; trap.tabIndex = -1; trap.autocomplete = 'off'; trap.setAttribute('aria-hidden', 'true');
    trap.style.cssText = 'position:absolute;left:-10000px;width:1px;height:1px;opacity:0';
    form.appendChild(trap);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (form.getAttribute('data-gk-sending') === '1') return;
      var kind = form.getAttribute('data-gk-form') || 'message';
      var data = { _kind: kind, _page: location.pathname.replace(/^\/s\/[^/]+\/?/, '') || 'index.html', _t: Date.now() - started };
      var named = 0;
      Array.prototype.forEach.call(form.elements, function (el) {
        if (!el.name || el.disabled || el.type === 'file' || el.type === 'submit' || el.type === 'button' || el.type === 'reset') return;
        if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) return;
        var value = el.type === 'checkbox' && el.value === 'on' ? 'Yes' : el.value;
        if (el.tagName === 'SELECT' && el.multiple) value = Array.prototype.filter.call(el.options, function (o) { return o.selected; }).map(function (o) { return o.value; }).join(', ');
        if (el.name !== '_gotcha') named++;
        data[el.name] = data[el.name] && el.name !== '_gotcha' ? data[el.name] + ', ' + value : value;
      });
      var box = statusFor(form), button = form.querySelector('[type=submit], button:not([type])');
      if (!named) { box.textContent = 'This form has no named fields to send.'; return; }
      form.setAttribute('data-gk-sending', '1'); if (button) button.disabled = true;
      box.className = 'gk-form-status is-sending'; box.textContent = 'Sending…';
      fetch('/api/site-data/' + encodeURIComponent(SLUG), { method: 'POST', body: JSON.stringify(data), credentials: 'omit' })
        .then(function (response) { return response.json().catch(function () { return {}; }).then(function (body) { if (!response.ok) throw new Error(body.error || 'It could not be sent.'); return body.ref || ''; }); })
        .then(function (ref) {
          box.className = 'gk-form-status is-sent';
          box.textContent = (form.getAttribute('data-gk-success') || SUCCESS[kind] || SUCCESS.other) + (ref ? ' Your reference is ' + ref + '.' : '');
          if (ref && (kind === 'order' || kind === 'booking' || form.hasAttribute('data-gk-receipt'))) {
            var copy = document.createElement('button');
            copy.type = 'button'; copy.className = 'gk-btn is-ghost gk-receipt-button'; copy.textContent = 'Save a copy (PDF)';
            copy.style.marginLeft = '8px';
            var sentData = data;
            copy.addEventListener('click', function () { printReceipt(kind, ref, sentData); });
            box.appendChild(document.createTextNode(' ')); box.appendChild(copy);
          }
          form.reset();
        })
        .catch(function (error) {
          box.className = 'gk-form-status is-error';
          box.textContent = (error && error.message ? error.message : 'It could not be sent.') + ' Please try again.';
        })
        .then(function () { form.removeAttribute('data-gk-sending'); if (button) button.disabled = false; });
    });
  }

  // A copy of what the visitor sent, printed on its own page (the print screen can save it as a PDF).
  function esc(text) { return String(text).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function printReceipt(kind, ref, data) {
    var site = (document.querySelector('meta[property="og:site_name"]') || {}).content || document.title || SLUG;
    var rows = Object.keys(data).filter(function (k) { return k.charAt(0) !== '_' && String(data[k]).trim(); })
      .map(function (k) { return '<tr><th>' + esc(k.replace(/[-_]/g, ' ')) + '</th><td>' + esc(data[k]) + '</td></tr>'; }).join('');
    var title = { order: 'Order', booking: 'Booking request' }[kind] || 'Copy of your form';
    var area = document.createElement('div');
    area.className = 'gk-print-area gk-receipt';
    area.innerHTML = '<style>.gk-receipt{font:15px/1.5 system-ui,sans-serif;color:#111;background:#fff;max-width:720px;margin:0 auto;padding:32px}.gk-receipt h1{font-size:22px;margin:0}.gk-receipt .gk-r-top{display:flex;justify-content:space-between;gap:16px;border-bottom:2px solid #111;padding-bottom:12px;margin-bottom:16px}.gk-receipt table{width:100%;border-collapse:collapse}.gk-receipt th,.gk-receipt td{text-align:left;vertical-align:top;padding:8px;border-bottom:1px solid #ddd}.gk-receipt th{width:35%;text-transform:capitalize;color:#444}.gk-receipt p{color:#444}@media screen{.gk-receipt{display:none}}@media print{body.gk-printing>*:not(.gk-print-area){display:none!important}.gk-receipt{display:block!important}}</style>' +
      '<div class="gk-r-top"><div><h1>' + esc(site) + '</h1><div>' + esc(title) + '</div></div><div style="text-align:right"><strong>Reference ' + esc(ref) + '</strong><br>' + esc(new Date().toLocaleString()) + '</div></div>' +
      '<table>' + rows + '</table><p>This is a copy of what you sent. The business will contact you to confirm.</p><p>' + esc(location.origin + location.pathname) + '</p>';
    document.body.appendChild(area); document.body.classList.add('gk-printing');
    var done = function () { document.body.classList.remove('gk-printing'); if (area.parentNode) area.parentNode.removeChild(area); removeEventListener('afterprint', done); };
    addEventListener('afterprint', done);
    window.print();
    setTimeout(done, 60000);
  }

  function start() {
    try { applyContent(); } catch (e) { /* the page's own text stays */ }
    Array.prototype.forEach.call(document.querySelectorAll('form[data-gk-form]'), wireForm);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();`;

const json = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/** The script for one site, with its saved content inside (one request per page). */
export function siteRuntime(slug, content) {
  return RUNTIME.replace('__SLUG__', () => json(slug)).replace('__CONTENT__', () => json(content || { texts: {}, lists: {} }));
}

/** A published page with the Grandpa script added first in <head>, so content is in place before other scripts run. */
export function withRuntime(html, slug) {
  const tag = `<script src="/s/${slug}/_grandpa/site.js" defer></script>`;
  const text = String(html);
  const head = /<head\b[^>]*>/i.exec(text);
  if (head) return text.slice(0, head.index + head[0].length) + tag + text.slice(head.index + head[0].length);
  const body = /<body\b[^>]*>/i.exec(text);
  if (body) return text.slice(0, body.index + body[0].length) + tag + text.slice(body.index + body[0].length);
  return tag + text;
}
