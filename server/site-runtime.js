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
        .then(function (response) { return response.json().catch(function () { return {}; }).then(function (body) { if (!response.ok) throw new Error(body.error || 'It could not be sent.'); }); })
        .then(function () {
          box.className = 'gk-form-status is-sent';
          box.textContent = form.getAttribute('data-gk-success') || SUCCESS[kind] || SUCCESS.other;
          form.reset();
        })
        .catch(function (error) {
          box.className = 'gk-form-status is-error';
          box.textContent = (error && error.message ? error.message : 'It could not be sent.') + ' Please try again.';
        })
        .then(function () { form.removeAttribute('data-gk-sending'); if (button) button.disabled = false; });
    });
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
